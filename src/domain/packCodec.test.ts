import { describe, expect, it } from 'vitest';
import {
  decodePackIndex,
  decodePackManifest,
  decodePackPreference,
} from './packCodec';

const LICENSE = {
  spdx: 'CC-BY-4.0',
  attribution: 'Emoji artwork by Twemoji',
  shareAlike: false,
  noticeUrl: 'https://creativecommons.org/licenses/by/4.0/',
};

describe('pack codecs', () => {
  it('decodes version-scoped style availability and drops unknown packs', () => {
    expect(decodePackIndex({
      version: 1,
      packs: [
        {
          id: 'future-pack',
          name: 'Future',
          versions: [],
        },
        {
          id: 'twemoji',
          name: 'Twemoji',
          versions: [{ version: '15.1.0', styles: [], defaultStyle: null }],
          defaultVersion: '15.1.0',
          license: LICENSE,
          unicodeLevel: '15.1',
          ignored: true,
        },
      ],
    })).toEqual({
      ok: true,
      value: [{
        id: 'twemoji',
        name: 'Twemoji',
        versions: [{ version: '15.1.0', styles: [], defaultStyle: null }],
        defaultVersion: '15.1.0',
        license: LICENSE,
        unicodeLevel: '15.1',
      }],
    });
  });

  it('rejects a default style or version that is not listed', () => {
    const base = {
      version: 1,
      packs: [{
        id: 'twemoji',
        name: 'Twemoji',
        versions: [{ version: '15.1.0', styles: [], defaultStyle: null }],
        defaultVersion: '15.1.0',
        license: LICENSE,
        unicodeLevel: '15.1',
      }],
    };
    expect(decodePackIndex({
      ...base,
      packs: [{ ...base.packs[0], defaultVersion: '16.0.0' }],
    }).ok).toBe(false);
    expect(decodePackIndex({
      ...base,
      packs: [{
        ...base.packs[0],
        versions: [{ version: '15.1.0', styles: [], defaultStyle: 'flat' }],
      }],
    }).ok).toBe(false);
  });

  it('decodes a manifest, defaults its byte cap, and rejects duplicate glyphs', () => {
    const manifest = {
      id: 'twemoji',
      name: 'Twemoji',
      version: '15.1.0',
      style: null,
      format: 'svg',
      license: LICENSE,
      unicodeLevel: '15.1',
      glyphs: ['1f600', '1f44d'],
      assetRoot: 'https://cdn.jsdelivr.net/gh/fluffyrabbot/seemoji-packs@v1.0.0/packs/twemoji/15.1.0/',
      upstream: { repository: 'https://github.com/jdecked/twemoji', ref: 'v15.1.0' },
    };
    const decoded = decodePackManifest(manifest);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value.maxAssetBytes).toBe(524_288);
    expect(decodePackManifest({ ...manifest, glyphs: ['1f600', '1f600'] }).ok).toBe(false);
  });

  it('decodes preferences while rejecting null and unknown styles', () => {
    expect(decodePackPreference({
      version: 1,
      pack: 'twemoji',
      packVersion: '15.1.0',
    })).toEqual({
      ok: true,
      value: { pack: 'twemoji', packVersion: '15.1.0' },
    });
    expect(decodePackPreference({
      version: 1,
      pack: 'twemoji',
      packVersion: '15.1.0',
      style: null,
    }).ok).toBe(false);
  });
});
