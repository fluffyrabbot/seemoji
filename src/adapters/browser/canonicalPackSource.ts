import type { EmojiAssetRef } from '../../domain/emoji';
import type { PackManifest } from '../../domain/pack';
import type { EmojiAssetSource } from '../../ports/emojiAssetSource';
import type { EmojiPackCatalog } from '../../ports/emojiPackCatalog';

export type EmojiAssetFailureKind =
  | 'invalid-ref'
  | 'missing'
  | 'network'
  | 'content-type'
  | 'too-large'
  | 'decode';

export class EmojiAssetError extends Error {
  readonly kind: EmojiAssetFailureKind;
  readonly ref: EmojiAssetRef;

  constructor(
    kind: EmojiAssetFailureKind,
    message: string,
    ref: EmojiAssetRef,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'EmojiAssetError';
    this.kind = kind;
    this.ref = ref;
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type DecodeImage = (blob: Blob, ref: EmojiAssetRef) => Promise<CanvasImageSource>;

const cacheKey = (ref: EmojiAssetRef): string =>
  `${ref.pack}@${ref.packVersion}/${ref.style ?? ''}/${ref.codepoint}`;

const expectedContentType = (manifest: PackManifest): string =>
  manifest.format === 'svg' ? 'image/svg+xml' : 'image/png';

const decodeBrowserImage: DecodeImage = async (blob, ref) => {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not decode artwork for ${ref.grapheme}`));
    });
    image.src = objectUrl;
    return await loaded;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

export class CanonicalPackSource implements EmojiAssetSource {
  readonly #catalog: EmojiPackCatalog;
  readonly #fetch: FetchLike;
  readonly #decodeImage: DecodeImage;
  readonly #cache = new Map<string, Promise<CanvasImageSource>>();

  constructor(options: {
    readonly catalog: EmojiPackCatalog;
    readonly fetchImpl?: FetchLike;
    readonly decodeImage?: DecodeImage;
  }) {
    this.#catalog = options.catalog;
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#decodeImage = options.decodeImage ?? decodeBrowserImage;
  }

  load(ref: EmojiAssetRef): Promise<CanvasImageSource> {
    const key = cacheKey(ref);
    const existing = this.#cache.get(key);
    if (existing) return existing;

    const pending = this.#load(ref).catch((cause: unknown) => {
      this.#cache.delete(key);
      if (cause instanceof EmojiAssetError) throw cause;
      throw new EmojiAssetError('network', `Could not load artwork for ${ref.grapheme}`, ref, {
        cause,
      });
    });
    this.#cache.set(key, pending);
    return pending;
  }

  async #load(ref: EmojiAssetRef): Promise<CanvasImageSource> {
    const manifestResult = await this.#catalog.get({
      pack: ref.pack,
      packVersion: ref.packVersion,
      ...(ref.style === undefined ? {} : { style: ref.style }),
    });
    if (!manifestResult.ok) {
      throw new EmojiAssetError('missing', manifestResult.error, ref);
    }

    const urlResult = await this.#catalog.assetUrl(ref);
    if (!urlResult.ok) {
      const kind = urlResult.error.includes('invalid') ? 'invalid-ref' : 'missing';
      throw new EmojiAssetError(kind, urlResult.error, ref);
    }

    let response: Response;
    try {
      response = await this.#fetch(urlResult.value, { mode: 'cors', credentials: 'omit' });
    } catch (cause) {
      throw new EmojiAssetError('network', `Could not fetch artwork for ${ref.grapheme}`, ref, {
        cause,
      });
    }
    if (response.status !== 200) {
      throw new EmojiAssetError(
        response.status === 404 ? 'missing' : 'network',
        `Artwork returned HTTP ${response.status}`,
        ref,
      );
    }

    const contentType = ((response.headers.get('content-type') ?? '').split(';', 1)[0] ?? '')
      .trim()
      .toLowerCase();
    const expected = expectedContentType(manifestResult.value);
    if (contentType !== expected) {
      throw new EmojiAssetError(
        'content-type',
        `Artwork returned ${contentType || 'no content type'}; expected ${expected}`,
        ref,
      );
    }

    const blob = await response.blob();
    if (blob.size > manifestResult.value.maxAssetBytes) {
      throw new EmojiAssetError(
        'too-large',
        `Artwork is ${blob.size} bytes; limit is ${manifestResult.value.maxAssetBytes}`,
        ref,
      );
    }
    try {
      return await this.#decodeImage(blob, ref);
    } catch (cause) {
      throw new EmojiAssetError('decode', `Could not decode artwork for ${ref.grapheme}`, ref, {
        cause,
      });
    }
  }
}
