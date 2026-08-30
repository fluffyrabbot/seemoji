import type { DecodeResult } from './designCodec';
import {
  isPackId,
  isPackStyle,
  type PackLicense,
  type PackManifest,
  type PackSnapshot,
  type PackSummary,
  type PackVersionSummary,
} from './pack';

const PACK_VERSION = /^\d+\.\d+\.\d+$/;
const CODEPOINT = /^[0-9a-f]+(?:-[0-9a-f]+)*$/;
const DEFAULT_MAX_ASSET_BYTES = 524_288;

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const nonEmptyString = (value: unknown, path: string): DecodeResult<string> =>
  typeof value === 'string' && value.trim()
    ? { ok: true, value }
    : { ok: false, error: `${path} must be a non-empty string` };

function decodeLicense(value: unknown, path: string): DecodeResult<PackLicense> {
  const license = record(value);
  if (!license) return { ok: false, error: `${path} must be an object` };
  const spdx = nonEmptyString(license.spdx, `${path}.spdx`);
  const attribution = nonEmptyString(license.attribution, `${path}.attribution`);
  const noticeUrl = nonEmptyString(license.noticeUrl, `${path}.noticeUrl`);
  if (!spdx.ok) return spdx;
  if (!attribution.ok) return attribution;
  if (typeof license.shareAlike !== 'boolean') {
    return { ok: false, error: `${path}.shareAlike must be a boolean` };
  }
  if (!noticeUrl.ok) return noticeUrl;
  return {
    ok: true,
    value: {
      spdx: spdx.value,
      attribution: attribution.value,
      shareAlike: license.shareAlike,
      noticeUrl: noticeUrl.value,
    },
  };
}

function decodeVersionSummary(value: unknown, path: string): DecodeResult<PackVersionSummary> {
  const summary = record(value);
  if (!summary) return { ok: false, error: `${path} must be an object` };
  if (typeof summary.version !== 'string' || !PACK_VERSION.test(summary.version)) {
    return { ok: false, error: `${path}.version must be a semantic version` };
  }
  if (!Array.isArray(summary.styles) || !summary.styles.every(isPackStyle)) {
    return { ok: false, error: `${path}.styles contains an unrecognized style` };
  }
  const styles = [...new Set(summary.styles)];
  if (summary.defaultStyle !== null && !isPackStyle(summary.defaultStyle)) {
    return { ok: false, error: `${path}.defaultStyle is invalid` };
  }
  if (summary.defaultStyle !== null && !styles.includes(summary.defaultStyle)) {
    return { ok: false, error: `${path}.defaultStyle must be listed in styles` };
  }
  return {
    ok: true,
    value: {
      version: summary.version,
      styles,
      defaultStyle: summary.defaultStyle,
    },
  };
}

function decodeSummary(value: unknown, path: string): DecodeResult<PackSummary> {
  const summary = record(value);
  if (!summary) return { ok: false, error: `${path} must be an object` };
  if (!isPackId(summary.id)) {
    return { ok: false, error: `${path}.id is not an allowlisted pack` };
  }
  const name = nonEmptyString(summary.name, `${path}.name`);
  const unicodeLevel = nonEmptyString(summary.unicodeLevel, `${path}.unicodeLevel`);
  const license = decodeLicense(summary.license, `${path}.license`);
  if (!name.ok) return name;
  if (!unicodeLevel.ok) return unicodeLevel;
  if (!license.ok) return license;
  if (!Array.isArray(summary.versions) || summary.versions.length === 0) {
    return { ok: false, error: `${path}.versions must be a non-empty array` };
  }
  const versions: PackVersionSummary[] = [];
  for (const [index, rawVersion] of summary.versions.entries()) {
    const version = decodeVersionSummary(rawVersion, `${path}.versions[${index}]`);
    if (!version.ok) return version;
    if (versions.some((candidate) => candidate.version === version.value.version)) {
      return { ok: false, error: `${path}.versions must be unique` };
    }
    versions.push(version.value);
  }
  if (typeof summary.defaultVersion !== 'string'
      || !versions.some((version) => version.version === summary.defaultVersion)) {
    return { ok: false, error: `${path}.defaultVersion must be listed in versions` };
  }
  return {
    ok: true,
    value: {
      id: summary.id,
      name: name.value,
      versions,
      defaultVersion: summary.defaultVersion,
      license: license.value,
      unicodeLevel: unicodeLevel.value,
    },
  };
}

export function decodePackIndex(
  value: unknown,
): DecodeResult<readonly PackSummary[]> {
  const index = record(value);
  if (!index || index.version !== 1 || !Array.isArray(index.packs)) {
    return { ok: false, error: 'pack index must be a version 1 object with a packs array' };
  }
  const packs: PackSummary[] = [];
  for (const [position, rawPack] of index.packs.entries()) {
    const rawId = record(rawPack)?.id;
    if (!isPackId(rawId)) continue;
    const pack = decodeSummary(rawPack, `packs[${position}]`);
    if (!pack.ok) return pack;
    if (packs.some((candidate) => candidate.id === pack.value.id)) {
      return { ok: false, error: 'pack index ids must be unique' };
    }
    packs.push(pack.value);
  }
  return { ok: true, value: packs };
}

export function decodePackManifest(value: unknown): DecodeResult<PackManifest> {
  const manifest = record(value);
  if (!manifest) return { ok: false, error: 'pack manifest must be an object' };
  if (!isPackId(manifest.id)) {
    return { ok: false, error: 'manifest.id is not an allowlisted pack' };
  }
  const name = nonEmptyString(manifest.name, 'manifest.name');
  const unicodeLevel = nonEmptyString(manifest.unicodeLevel, 'manifest.unicodeLevel');
  const assetRoot = nonEmptyString(manifest.assetRoot, 'manifest.assetRoot');
  const license = decodeLicense(manifest.license, 'manifest.license');
  if (!name.ok) return name;
  if (!unicodeLevel.ok) return unicodeLevel;
  if (!assetRoot.ok) return assetRoot;
  if (!license.ok) return license;
  try {
    const parsedAssetRoot = new URL(assetRoot.value);
    if (!parsedAssetRoot.pathname.endsWith('/')) {
      return { ok: false, error: 'manifest.assetRoot must be a directory URL' };
    }
  } catch {
    return { ok: false, error: 'manifest.assetRoot must be an absolute URL' };
  }
  if (typeof manifest.version !== 'string' || !PACK_VERSION.test(manifest.version)) {
    return { ok: false, error: 'manifest.version must be a semantic version' };
  }
  if (manifest.style !== null && !isPackStyle(manifest.style)) {
    return { ok: false, error: 'manifest.style is invalid' };
  }
  if (manifest.format !== 'svg' && manifest.format !== 'png') {
    return { ok: false, error: 'manifest.format must be svg or png' };
  }
  if (!Array.isArray(manifest.glyphs) || !manifest.glyphs.every(
    (glyph): glyph is string => typeof glyph === 'string' && CODEPOINT.test(glyph),
  )) {
    return { ok: false, error: 'manifest.glyphs contains an invalid codepoint' };
  }
  const glyphs = [...new Set(manifest.glyphs)];
  if (glyphs.length !== manifest.glyphs.length) {
    return { ok: false, error: 'manifest.glyphs must be unique' };
  }
  const maxAssetBytes = manifest.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES;
  if (!Number.isSafeInteger(maxAssetBytes) || (maxAssetBytes as number) <= 0) {
    return { ok: false, error: 'manifest.maxAssetBytes must be a positive integer' };
  }
  const upstream = record(manifest.upstream);
  if (!upstream) return { ok: false, error: 'manifest.upstream must be an object' };
  const repository = nonEmptyString(upstream.repository, 'manifest.upstream.repository');
  const ref = nonEmptyString(upstream.ref, 'manifest.upstream.ref');
  if (!repository.ok) return repository;
  if (!ref.ok) return ref;
  return {
    ok: true,
    value: {
      id: manifest.id,
      name: name.value,
      version: manifest.version,
      style: manifest.style,
      format: manifest.format,
      license: license.value,
      unicodeLevel: unicodeLevel.value,
      glyphs,
      assetRoot: assetRoot.value,
      maxAssetBytes: maxAssetBytes as number,
      upstream: { repository: repository.value, ref: ref.value },
    },
  };
}

export function decodePackPreference(value: unknown): DecodeResult<PackSnapshot> {
  const preference = record(value);
  if (!preference || preference.version !== 1) {
    return { ok: false, error: 'pack preference must be a version 1 object' };
  }
  if (!isPackId(preference.pack)) {
    return { ok: false, error: 'pack preference names an unknown pack' };
  }
  if (typeof preference.packVersion !== 'string'
      || !PACK_VERSION.test(preference.packVersion)) {
    return { ok: false, error: 'pack preference version is invalid' };
  }
  if (preference.style !== undefined && !isPackStyle(preference.style)) {
    return { ok: false, error: 'pack preference style is invalid' };
  }
  const snapshot: PackSnapshot = {
    pack: preference.pack,
    packVersion: preference.packVersion,
  };
  return {
    ok: true,
    value: preference.style === undefined
      ? snapshot
      : { ...snapshot, style: preference.style },
  };
}
