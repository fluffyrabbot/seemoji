export const PACK_IDS = [
  'twemoji',
  'noto',
  'fluent',
  'openmoji',
  'fxemoji',
  'emojitwo',
  'blobmoji',
  'serenity',
] as const;

export type PackId = (typeof PACK_IDS)[number];

export const PACK_STYLES = [
  'color',
  'flat',
  'high-contrast',
  '3d',
  'black',
] as const;

export type PackStyle = (typeof PACK_STYLES)[number];

export interface PackSnapshot {
  readonly pack: PackId;
  readonly packVersion: string;
  readonly style?: PackStyle;
}

export interface PackLicense {
  readonly spdx: string;
  readonly attribution: string;
  readonly shareAlike: boolean;
  readonly noticeUrl: string;
}

export interface PackVersionSummary {
  readonly version: string;
  readonly styles: readonly PackStyle[];
  readonly defaultStyle: PackStyle | null;
}

export interface PackSummary {
  readonly id: PackId;
  readonly name: string;
  readonly versions: readonly PackVersionSummary[];
  readonly defaultVersion: string;
  readonly license: PackLicense;
  readonly unicodeLevel: string;
}

export interface PackManifest {
  readonly id: PackId;
  readonly name: string;
  readonly version: string;
  readonly style: PackStyle | null;
  readonly format: 'svg' | 'png';
  readonly license: PackLicense;
  readonly unicodeLevel: string;
  readonly glyphs: readonly string[];
  readonly assetRoot: string;
  readonly maxAssetBytes: number;
  readonly upstream: {
    readonly repository: string;
    readonly ref: string;
  };
}

export const DEFAULT_PACK_SNAPSHOT: PackSnapshot = {
  pack: 'twemoji',
  packVersion: '15.1.0',
};

export const isPackId = (value: unknown): value is PackId =>
  typeof value === 'string' && (PACK_IDS as readonly string[]).includes(value);

export const isPackStyle = (value: unknown): value is PackStyle =>
  typeof value === 'string' && (PACK_STYLES as readonly string[]).includes(value);
