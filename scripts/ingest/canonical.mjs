import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

export const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

export const writeGeneratedJson = async (path, value, { check = false } = {}) => {
  const encoded = stableJson(value);
  if (check) {
    const current = await readFile(path, 'utf8').catch(() => null);
    if (current !== encoded) throw new Error(`${path} is stale; run the ingest script`);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, encoded);
};

export const TWEMOJI_LICENSE = Object.freeze({
  spdx: 'CC-BY-4.0',
  attribution: 'Emoji artwork by Twemoji',
  shareAlike: false,
  noticeUrl: 'https://creativecommons.org/licenses/by/4.0/',
});

export const NOTO_LICENSE = Object.freeze({
  spdx: 'Apache-2.0',
  attribution: 'Emoji artwork by Noto Emoji',
  shareAlike: false,
  noticeUrl: 'https://github.com/googlefonts/noto-emoji/blob/v2.042/LICENSE',
});

export const FLUENT_LICENSE = Object.freeze({
  spdx: 'MIT',
  attribution: 'Emoji artwork by Microsoft Fluent Emoji',
  shareAlike: false,
  noticeUrl: 'https://github.com/microsoft/fluentui-emoji/blob/1ffb34c752ecf5d402f04cfb4b392c77f57c54bc/LICENSE',
});

export const OPENMOJI_LICENSE = Object.freeze({
  spdx: 'CC-BY-SA-4.0',
  attribution: 'Emoji artwork by OpenMoji',
  shareAlike: true,
  noticeUrl: 'https://github.com/hfg-gmuend/openmoji/blob/17.0.0/LICENSE.txt',
});

export const FXEMOJI_LICENSE = Object.freeze({
  spdx: 'CC-BY-4.0',
  attribution: 'Emoji artwork by Mozilla FxEmoji',
  shareAlike: false,
  noticeUrl: 'https://github.com/mozilla/fxemoji/blob/1.7.9/LICENSE.md',
});

export const EMOJITWO_LICENSE = Object.freeze({
  spdx: 'CC-BY-4.0',
  attribution: 'Emoji artwork by EmojiTwo',
  shareAlike: false,
  noticeUrl: 'https://github.com/EmojiTwo/emojitwo/blob/v2.2.7/LICENSE.md',
});

export const BLOBMOJI_LICENSE = Object.freeze({
  spdx: 'Apache-2.0',
  attribution: 'Emoji artwork by Blobmoji',
  shareAlike: false,
  noticeUrl: 'https://github.com/C1710/blobmoji/blob/7dd14d2b0141693485fd26bc35817bd290352a79/LICENSE',
});

export const SERENITY_LICENSE = Object.freeze({
  spdx: 'BSD-2-Clause',
  attribution: 'SerenityOS emoji artwork, Copyright © 2018–2026 the SerenityOS developers',
  shareAlike: false,
  noticeUrl: 'https://github.com/SerenityOS/serenity/blob/a36d1178c205070fa8d3aea62156dc769b01bcae/LICENSE',
});
