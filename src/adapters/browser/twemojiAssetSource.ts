import type { EmojiAssetRef } from '../../domain/emoji';
import type { EmojiAssetSource } from '../../ports/emojiAssetSource';

const CDN_ROOT = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji';
const SAFE_CODEPOINT = /^[0-9a-f]+(?:-[0-9a-f]+)*$/;
const SAFE_VERSION = /^\d+\.\d+\.\d+$/;

export class TwemojiAssetError extends Error {
  readonly ref: EmojiAssetRef;

  constructor(
    message: string,
    ref: EmojiAssetRef,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'TwemojiAssetError';
    this.ref = ref;
  }
}

export function twemojiSvgUrl(ref: EmojiAssetRef): string {
  if (
    ref.pack !== 'twemoji' ||
    !SAFE_VERSION.test(ref.packVersion) ||
    !SAFE_CODEPOINT.test(ref.codepoint)
  ) {
    throw new TwemojiAssetError('Invalid or unsupported emoji asset reference', ref);
  }
  return `${CDN_ROOT}@${ref.packVersion}/assets/svg/${ref.codepoint}.svg`;
}

const decodeSvg = async (svg: Blob, ref: EmojiAssetRef): Promise<HTMLImageElement> => {
  const objectUrl = URL.createObjectURL(svg);
  try {
    const image = new Image();
    image.decoding = 'async';
    const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(new TwemojiAssetError(`Could not decode artwork for ${ref.grapheme}`, ref));
    });
    image.src = objectUrl;
    return await loaded;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

export class TwemojiCdnAssetSource implements EmojiAssetSource {
  readonly #cache = new Map<string, Promise<HTMLImageElement>>();

  load(ref: EmojiAssetRef): Promise<HTMLImageElement> {
    const url = twemojiSvgUrl(ref);
    const existing = this.#cache.get(url);
    if (existing) return existing;

    const request = fetch(url, { mode: 'cors', credentials: 'omit' })
      .then(async (response) => {
        if (!response.ok) {
          throw new TwemojiAssetError(
            `No Twemoji ${ref.packVersion} artwork exists for ${ref.grapheme}`,
            ref,
          );
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('svg')) {
          throw new TwemojiAssetError('Emoji source returned a non-SVG response', ref);
        }
        return decodeSvg(await response.blob(), ref);
      })
      .catch((cause: unknown) => {
        this.#cache.delete(url);
        if (cause instanceof TwemojiAssetError) throw cause;
        throw new TwemojiAssetError(`Could not load artwork for ${ref.grapheme}`, ref, {
          cause,
        });
      });

    this.#cache.set(url, request);
    return request;
  }
}
