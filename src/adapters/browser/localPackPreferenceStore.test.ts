import { beforeEach, describe, expect, it } from 'vitest';
import { LocalPackPreferenceStore, PACK_PREFERENCE_KEY } from './localPackPreferenceStore';

describe('LocalPackPreferenceStore', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a versioned snapshot and omits absent style', async () => {
    const store = new LocalPackPreferenceStore(localStorage);
    await store.write({ pack: 'twemoji', packVersion: '15.1.0' });
    expect(JSON.parse(localStorage.getItem(PACK_PREFERENCE_KEY)!)).toEqual({
      version: 1,
      pack: 'twemoji',
      packVersion: '15.1.0',
    });
    await expect(store.read()).resolves.toEqual({
      pack: 'twemoji',
      packVersion: '15.1.0',
    });
  });

  it('persists the explicit default style of a styled pack', async () => {
    const store = new LocalPackPreferenceStore(localStorage);
    await store.write({ pack: 'fluent', packVersion: '1.0.0', style: 'color' });
    await expect(store.read()).resolves.toEqual({
      pack: 'fluent',
      packVersion: '1.0.0',
      style: 'color',
    });
  });

  it('fails open for corrupt or unknown preferences', async () => {
    const store = new LocalPackPreferenceStore(localStorage);
    localStorage.setItem(PACK_PREFERENCE_KEY, '{broken');
    await expect(store.read()).resolves.toBeNull();
    localStorage.setItem(PACK_PREFERENCE_KEY, JSON.stringify({
      version: 1,
      pack: 'unknown',
      packVersion: '1.0.0',
    }));
    await expect(store.read()).resolves.toBeNull();
  });
});
