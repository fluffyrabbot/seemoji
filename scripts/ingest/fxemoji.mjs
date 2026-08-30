import { FXEMOJI_LICENSE } from './canonical.mjs';
import { canonicalSequence, ingestFlatPack } from './flat-pack.mjs';

await ingestFlatPack({
  id: 'fxemoji',
  name: 'FxEmoji',
  format: 'svg',
  assetDirectory: 'svgs/FirefoxEmoji',
  minimumGlyphs: 1_000,
  maxAssetBytes: 524_288,
  unicodeLevel: '8.0',
  license: FXEMOJI_LICENSE,
  codepointFor: (filename) => {
    const match = /^u([0-9a-f]+)-.+\.svg$/i.exec(filename);
    return match ? canonicalSequence([match[1]]) : null;
  },
});
