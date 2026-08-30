import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceSync } from '../../ports/workspaceSync';
import { BrowserWorkspaceSync } from './browserWorkspaceSync';

class FakeBroadcastHub {
  readonly channels = new Set<FakeBroadcastChannel>();

  create(): FakeBroadcastChannel {
    const channel = new FakeBroadcastChannel(this);
    this.channels.add(channel);
    return channel;
  }

  send(sender: FakeBroadcastChannel | null, data: unknown): void {
    for (const channel of this.channels) {
      if (channel !== sender) channel.dispatchEvent(new MessageEvent('message', { data }));
    }
  }
}

class FakeBroadcastChannel extends EventTarget {
  readonly #hub: FakeBroadcastHub;

  constructor(hub: FakeBroadcastHub) {
    super();
    this.#hub = hub;
  }

  postMessage(data: unknown): void {
    this.#hub.send(this, data);
  }

  close(): void {
    this.#hub.channels.delete(this);
  }
}

class FakeStorageHub {
  readonly #targets = new Set<EventTarget>();

  connect(target: EventTarget): Pick<Storage, 'setItem'> {
    this.#targets.add(target);
    return {
      setItem: (key, value) => {
        for (const peer of this.#targets) {
          if (peer !== target) {
            peer.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
          }
        }
      },
    };
  }
}

interface SyncPair {
  readonly first: WorkspaceSync;
  readonly second: WorkspaceSync;
  malformedSecond(): void;
}

const defineTransportConformance = (name: string, createPair: () => SyncPair) => {
  describe(`${name} transport`, () => {
    it('delivers invalidations to peers but never to the publisher', () => {
      const pair = createPair();
      const firstMessages: unknown[] = [];
      const secondMessages: unknown[] = [];
      pair.first.subscribe((change) => firstMessages.push(change));
      pair.second.subscribe((change) => secondMessages.push(change));

      pair.first.publish({ projectIds: ['project-1', 'project-1'] });

      expect(firstMessages).toEqual([]);
      expect(secondMessages).toEqual([{ projectIds: ['project-1'] }]);
      pair.first.close();
      pair.second.close();
    });

    it('ignores malformed messages and stops delivery after unsubscribe or close', () => {
      const pair = createPair();
      const listener = vi.fn();
      const unsubscribe = pair.second.subscribe(listener);
      pair.malformedSecond();
      expect(listener).not.toHaveBeenCalled();

      unsubscribe();
      pair.first.publish({ projectIds: ['project-1'] });
      expect(listener).not.toHaveBeenCalled();

      pair.second.subscribe(listener);
      pair.second.close();
      pair.first.publish({ projectIds: ['project-2'] });
      expect(listener).not.toHaveBeenCalled();
      pair.first.close();
    });
  });
};

defineTransportConformance('BroadcastChannel', () => {
  const hub = new FakeBroadcastHub();
  const firstChannel = hub.create();
  const secondChannel = hub.create();
  return {
    first: new BrowserWorkspaceSync({ channel: firstChannel, createNonce: () => 'first' }),
    second: new BrowserWorkspaceSync({ channel: secondChannel, createNonce: () => 'second' }),
    malformedSecond: () => hub.send(firstChannel, {
      version: 1,
      nonce: '',
      projectIds: ['project-1'],
    }),
  };
});

defineTransportConformance('storage event', () => {
  const hub = new FakeStorageHub();
  const firstTarget = new EventTarget();
  const secondTarget = new EventTarget();
  const firstStorage = hub.connect(firstTarget);
  const secondStorage = hub.connect(secondTarget);
  return {
    first: new BrowserWorkspaceSync({
      channel: null,
      eventTarget: firstTarget,
      storage: firstStorage,
      createNonce: () => 'first',
    }),
    second: new BrowserWorkspaceSync({
      channel: null,
      eventTarget: secondTarget,
      storage: secondStorage,
      createNonce: () => 'second',
    }),
    malformedSecond: () => secondTarget.dispatchEvent(new StorageEvent('storage', {
      key: 'seemoji:workspace-invalidation:v1',
      newValue: '{invalid',
    })),
  };
});

describe('BrowserWorkspaceSync transport selection', () => {
  it('prefers BroadcastChannel and does not touch storage', () => {
    const hub = new FakeBroadcastHub();
    const storage = { setItem: vi.fn() };
    const sync = new BrowserWorkspaceSync({ channel: hub.create(), storage });
    sync.publish({ projectIds: ['project-1'] });
    expect(storage.setItem).not.toHaveBeenCalled();
    sync.close();
  });

  it('keeps publishing safe when fallback storage is unavailable', () => {
    const sync = new BrowserWorkspaceSync({
      channel: null,
      eventTarget: new EventTarget(),
      storage: { setItem: () => { throw new DOMException('denied'); } },
    });
    expect(() => sync.publish({ projectIds: ['project-1'] })).not.toThrow();
    sync.close();
  });

  it('writes only a versioned invalidation envelope to fallback storage', () => {
    const storage = { setItem: vi.fn() };
    const sync = new BrowserWorkspaceSync({
      channel: null,
      eventTarget: new EventTarget(),
      storage,
      createNonce: () => 'nonce-1',
    });
    sync.publish({ projectIds: ['project-1'] });
    expect(storage.setItem).toHaveBeenCalledOnce();
    const [key, value] = storage.setItem.mock.calls[0]!;
    expect(key).toBe('seemoji:workspace-invalidation:v1');
    expect(JSON.parse(value)).toEqual({
      version: 1,
      nonce: 'nonce-1',
      projectIds: ['project-1'],
    });
    sync.close();
  });
});
