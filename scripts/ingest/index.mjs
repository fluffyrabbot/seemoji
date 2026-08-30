import { resolve } from 'node:path';
import {
  BLOBMOJI_LICENSE,
  EMOJITWO_LICENSE,
  FLUENT_LICENSE,
  FXEMOJI_LICENSE,
  NOTO_LICENSE,
  OPENMOJI_LICENSE,
  REPOSITORY_ROOT,
  SERENITY_LICENSE,
  TWEMOJI_LICENSE,
  readJson,
  writeGeneratedJson,
} from './canonical.mjs';

const check = process.argv.includes('--check');
const pins = await readJson(resolve(REPOSITORY_ROOT, 'scripts/ingest/pins.json'));

const index = {
  version: 1,
  packs: [
    {
      id: 'twemoji',
      name: 'Twemoji',
      versions: [{
        version: pins.packs.twemoji.snapshotVersion,
        styles: [],
        defaultStyle: null,
      }],
      defaultVersion: pins.packs.twemoji.snapshotVersion,
      license: TWEMOJI_LICENSE,
      unicodeLevel: '15.1',
    },
    {
      id: 'noto',
      name: 'Noto Emoji',
      versions: [{
        version: pins.packs.noto.snapshotVersion,
        styles: [],
        defaultStyle: null,
      }],
      defaultVersion: pins.packs.noto.snapshotVersion,
      license: NOTO_LICENSE,
      unicodeLevel: '15.1',
    },
    {
      id: 'fluent',
      name: 'Fluent Emoji',
      versions: pins.packs.fluent.versions.map((version) => ({
        version: version.snapshotVersion,
        styles: version.styles,
        defaultStyle: version.defaultStyle,
      })),
      defaultVersion: pins.packs.fluent.defaultVersion,
      license: FLUENT_LICENSE,
      unicodeLevel: '15.1',
    },
    {
      id: 'openmoji',
      name: 'OpenMoji',
      versions: [{
        version: pins.packs.openmoji.snapshotVersion,
        styles: pins.packs.openmoji.styles,
        defaultStyle: pins.packs.openmoji.defaultStyle,
      }],
      defaultVersion: pins.packs.openmoji.snapshotVersion,
      license: OPENMOJI_LICENSE,
      unicodeLevel: '17.0',
    },
    {
      id: 'fxemoji',
      name: 'FxEmoji',
      versions: [{ version: pins.packs.fxemoji.snapshotVersion, styles: [], defaultStyle: null }],
      defaultVersion: pins.packs.fxemoji.snapshotVersion,
      license: FXEMOJI_LICENSE,
      unicodeLevel: '8.0',
    },
    {
      id: 'emojitwo',
      name: 'EmojiTwo',
      versions: [{ version: pins.packs.emojitwo.snapshotVersion, styles: [], defaultStyle: null }],
      defaultVersion: pins.packs.emojitwo.snapshotVersion,
      license: EMOJITWO_LICENSE,
      unicodeLevel: '9.0',
    },
    {
      id: 'blobmoji',
      name: 'Blobmoji',
      versions: [{ version: pins.packs.blobmoji.snapshotVersion, styles: [], defaultStyle: null }],
      defaultVersion: pins.packs.blobmoji.snapshotVersion,
      license: BLOBMOJI_LICENSE,
      unicodeLevel: '13.1',
    },
    {
      id: 'serenity',
      name: 'SerenityOS Emoji',
      versions: [{ version: pins.packs.serenity.snapshotVersion, styles: [], defaultStyle: null }],
      defaultVersion: pins.packs.serenity.snapshotVersion,
      license: SERENITY_LICENSE,
      unicodeLevel: '17.0',
    },
  ],
};

await writeGeneratedJson(resolve(REPOSITORY_ROOT, 'public/packs/index.json'), index, { check });
console.log(`Emoji pack index: ${index.packs.length} packs`);
