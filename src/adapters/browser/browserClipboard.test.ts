import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserClipboard } from './browserClipboard';

const originalClipboardItem = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

const restore = (target: object, key: string, descriptor: PropertyDescriptor | undefined) => {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
};

afterEach(() => {
  restore(globalThis, 'ClipboardItem', originalClipboardItem);
  restore(navigator, 'clipboard', originalClipboard);
});

const installClipboardItem = () => {
  class TestClipboardItem {
    static supports(type: string) {
      return type === 'image/png';
    }

    constructor(_items: Record<string, Blob>) {}
  }
  Object.defineProperty(globalThis, 'ClipboardItem', {
    configurable: true,
    value: TestClipboardItem,
  });
};

describe('browser clipboard adapter', () => {
  it('reports unsupported capabilities without downloading anything', async () => {
    Reflect.deleteProperty(globalThis, 'ClipboardItem');
    const outcome = await new BrowserClipboard().writePng(new Blob());
    expect(outcome).toEqual({ kind: 'unsupported' });
  });

  it('returns a typed copied outcome', async () => {
    installClipboardItem();
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write },
    });
    const outcome = await new BrowserClipboard().writePng(
      new Blob(['png'], { type: 'image/png' }),
    );
    expect(outcome).toEqual({ kind: 'copied' });
    expect(write).toHaveBeenCalledOnce();
  });

  it('distinguishes permission denial from other failures', async () => {
    installClipboardItem();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')),
      },
    });
    const outcome = await new BrowserClipboard().writePng(new Blob());
    expect(outcome.kind).toBe('denied');
  });
});
