import type { DecodeResult } from '../../domain/designCodec';
import type { EmojiAssetRef } from '../../domain/emoji';
import {
  decodePackIndex,
  decodePackManifest,
} from '../../domain/packCodec';
import type {
  PackId,
  PackManifest,
  PackSnapshot,
  PackSummary,
  PackVersionSummary,
} from '../../domain/pack';
import type { EmojiPackCatalog, CatalogResult, CatalogFailureKind } from '../../ports/emojiPackCatalog';

const SAFE_VERSION = /^\d+\.\d+\.\d+$/;
const SAFE_CODEPOINT = /^[0-9a-f]+(?:-[0-9a-f]+)*$/;
const SAFE_STYLE = /^[a-z0-9-]+$/;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

class CatalogLoadError extends Error {
  readonly kind: CatalogFailureKind;
  constructor(kind: CatalogFailureKind, message: string) { super(message); this.kind = kind; }
}
const decodedResult = <T>(result: DecodeResult<T>): CatalogResult<T> => result.ok ? result : { ...result, kind: 'invalid' };
const failure = <T>(cause: unknown): CatalogResult<T> => ({
  ok: false,
  kind: cause instanceof CatalogLoadError ? cause.kind : cause instanceof SyntaxError ? 'invalid' : 'unavailable',
  error: cause instanceof Error ? cause.message : String(cause),
});

const snapshotKey = (snapshot: PackSnapshot): string =>
  `${snapshot.pack}@${snapshot.packVersion}/${snapshot.style ?? ''}`;

export class HttpEmojiPackCatalog implements EmojiPackCatalog {
  readonly #indexUrl: URL;
  readonly #catalogRoot: URL;
  readonly #fetch: FetchLike;
  readonly #manifests = new Map<string, Promise<CatalogResult<PackManifest>>>();
  readonly #glyphs = new Map<string, ReadonlySet<string>>();
  #listRequest: Promise<CatalogResult<readonly PackSummary[]>> | null = null;
  #summaries: ReadonlyMap<PackId, PackSummary> = new Map();

  constructor(options: {
    readonly indexUrl?: string;
    readonly baseUrl?: string;
    readonly fetchImpl?: FetchLike;
  } = {}) {
    const baseUrl = options.baseUrl
      ?? globalThis.location?.origin
      ?? 'http://127.0.0.1';
    this.#indexUrl = new URL(options.indexUrl ?? '/packs/index.json', baseUrl);
    this.#catalogRoot = new URL('./', this.#indexUrl);
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  list(): Promise<CatalogResult<readonly PackSummary[]>> {
    if (this.#listRequest) return this.#listRequest;
    this.#listRequest = this.#fetchJson(this.#indexUrl)
      .then((value) => decodedResult(decodePackIndex(value)))
      .then((decoded) => {
        if (decoded.ok) {
          this.#summaries = new Map(decoded.value.map((summary) => [summary.id, summary]));
        }
        return decoded;
      })
      .catch((cause: unknown) => failure<readonly PackSummary[]>(cause))
      .then((result) => { if (!result.ok) this.#listRequest = null; return result; });
    return this.#listRequest;
  }

  get(snapshot: PackSnapshot): Promise<CatalogResult<PackManifest>> {
    const key = snapshotKey(snapshot);
    const existing = this.#manifests.get(key);
    if (existing) return existing;
    const pending = this.#get(snapshot)
      .catch((cause: unknown) => failure<PackManifest>(cause))
      .then((result) => {
        if (!result.ok) this.#manifests.delete(key);
        return result;
      });
    this.#manifests.set(key, pending);
    return pending;
  }

  async hasGlyph(snapshot: PackSnapshot, codepoint: string): Promise<CatalogResult<boolean>> {
    if (!SAFE_CODEPOINT.test(codepoint)) return { ok: false, kind: 'invalid', error: 'Invalid emoji codepoint.' };
    const manifest = await this.get(snapshot);
    return manifest.ok ? { ok: true, value: this.#glyphs.get(snapshotKey(snapshot))?.has(codepoint) ?? false } : manifest;
  }

  async assetUrl(ref: EmojiAssetRef): Promise<CatalogResult<URL>> {
    if (!SAFE_VERSION.test(ref.packVersion)
        || !SAFE_CODEPOINT.test(ref.codepoint)
        || (ref.style !== undefined && !SAFE_STYLE.test(ref.style))) {
      return { ok: false, kind: 'invalid', error: 'invalid emoji asset reference' };
    }
    const manifest = await this.get({
      pack: ref.pack,
      packVersion: ref.packVersion,
      ...(ref.style === undefined ? {} : { style: ref.style }),
    });
    if (!manifest.ok) return manifest;
    if (ref.style !== undefined
        && manifest.value.style !== null
        && manifest.value.style !== ref.style) {
      return { ok: false, kind: 'invalid', error: 'emoji style does not match its manifest' };
    }
    if (!manifest.value.glyphs.includes(ref.codepoint)) {
      return { ok: false, kind: 'missing', error: 'emoji is not covered by this snapshot' };
    }
    if (manifest.value.assetRoot.includes('..')
        || manifest.value.assetRoot.includes('@latest')) {
      return { ok: false, kind: 'invalid', error: 'manifest asset root is not pinned safely' };
    }
    let root: URL;
    try {
      root = new URL(manifest.value.assetRoot);
    } catch {
      return { ok: false, kind: 'invalid', error: 'manifest asset root is not a URL' };
    }
    const sameOrigin = root.origin === this.#indexUrl.origin;
    const allowedRemote = root.protocol === 'https:' && root.hostname === 'cdn.jsdelivr.net';
    const allowedLocal = root.protocol === 'http:' && root.hostname === '127.0.0.1';
    if ((!sameOrigin && !allowedRemote && !allowedLocal)
        || (root.protocol !== 'https:' && !allowedLocal)
        || root.username !== ''
        || root.password !== ''
        || root.search !== ''
        || root.hash !== ''
        || (allowedRemote && !/@v?\d+\.\d+\.\d+\//.test(root.pathname))) {
      return { ok: false, kind: 'invalid', error: 'manifest asset host is not allowed' };
    }
    return {
      ok: true,
      value: new URL(
        `${manifest.value.format}/${ref.codepoint}.${manifest.value.format}`,
        root,
      ),
    };
  }

  summaryFor(pack: PackId): PackSummary | null {
    return this.#summaries.get(pack) ?? null;
  }

  async #get(snapshot: PackSnapshot): Promise<CatalogResult<PackManifest>> {
    if (!SAFE_VERSION.test(snapshot.packVersion)
        || (snapshot.style !== undefined && !SAFE_STYLE.test(snapshot.style))) {
      return { ok: false, kind: 'invalid', error: 'invalid pack snapshot' };
    }
    const summary = this.#summaries.get(snapshot.pack);
    const version = summary?.versions.find(
      (candidate) => candidate.version === snapshot.packVersion,
    );
    if (summary && !version) return { ok: false, kind: 'missing', error: 'pack version is not listed' };
    if (snapshot.style !== undefined && version && !version.styles.includes(snapshot.style)) {
      return { ok: false, kind: 'missing', error: 'pack style is not listed for this version' };
    }
    const basePath = `${snapshot.pack}/${snapshot.packVersion}/`;
    const firstPath = snapshot.style === undefined
      ? `${basePath}manifest.json`
      : `${basePath}${snapshot.style}/manifest.json`;
    let response = await this.#fetch(new URL(firstPath, this.#catalogRoot), {
      credentials: 'same-origin',
    });
    let requestedStyle = snapshot.style;
    if (response.status === 404 && snapshot.style === undefined && version?.defaultStyle) {
      requestedStyle = version.defaultStyle;
      response = await this.#fetch(
        new URL(`${basePath}${version.defaultStyle}/manifest.json`, this.#catalogRoot),
        { credentials: 'same-origin' },
      );
    }
    if (!response.ok) {
      return { ok: false, kind: response.status === 404 ? 'missing' : 'unavailable', error: `pack manifest returned HTTP ${response.status}` };
    }
    const decoded = decodedResult(decodePackManifest(await response.json()));
    if (!decoded.ok) return decoded;
    if (decoded.value.id !== snapshot.pack
        || decoded.value.version !== snapshot.packVersion
        || (requestedStyle !== undefined && decoded.value.style !== requestedStyle)
        || (requestedStyle === undefined && decoded.value.style !== null)) {
      return { ok: false, kind: 'invalid', error: 'pack manifest identity does not match its path' };
    }
    this.#glyphs.set(snapshotKey(snapshot), new Set(decoded.value.glyphs));
    return decoded;
  }

  async #fetchJson(url: URL): Promise<unknown> {
    const response = await this.#fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new CatalogLoadError(response.status === 404 ? 'missing' : 'unavailable', `pack index returned HTTP ${response.status}`);
    return response.json();
  }
}

export const findPackVersion = (
  summary: PackSummary,
  version: string,
): PackVersionSummary | null =>
  summary.versions.find((candidate) => candidate.version === version) ?? null;
