import type { WorkspaceChange, WorkspaceSync } from '../../ports/workspaceSync';

const CHANNEL_NAME = 'seemoji:project-workspace:v1';
const STORAGE_KEY = 'seemoji:workspace-invalidation:v1';
const MESSAGE_VERSION = 1;
const MAX_PROJECT_IDS = 100;

interface WorkspaceInvalidation {
  readonly version: typeof MESSAGE_VERSION;
  readonly nonce: string;
  readonly projectIds: readonly string[];
}

type WorkspaceBroadcastChannel = EventTarget & Pick<BroadcastChannel, 'postMessage' | 'close'>;
type WorkspaceStorage = Pick<Storage, 'setItem'>;

export interface BrowserWorkspaceSyncOptions {
  readonly channel?: WorkspaceBroadcastChannel | null;
  readonly eventTarget?: EventTarget | null;
  readonly storage?: WorkspaceStorage | null;
  readonly createNonce?: () => string;
}

const isWorkspaceInvalidation = (value: unknown): value is WorkspaceInvalidation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return message.version === MESSAGE_VERSION
    && typeof message.nonce === 'string'
    && message.nonce.length > 0
    && Array.isArray(message.projectIds)
    && message.projectIds.length > 0
    && message.projectIds.length <= MAX_PROJECT_IDS
    && message.projectIds.every((id) => typeof id === 'string' && id.length > 0);
};

const createDefaultChannel = (): WorkspaceBroadcastChannel | null => {
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    return new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
};

const defaultStorage = (): WorkspaceStorage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

const defaultNonce = () => globalThis.crypto?.randomUUID?.()
  ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export class BrowserWorkspaceSync implements WorkspaceSync {
  readonly #channel: WorkspaceBroadcastChannel | null;
  readonly #eventTarget: EventTarget | null;
  readonly #storage: WorkspaceStorage | null;
  readonly #createNonce: () => string;
  readonly #listeners = new Set<(change: WorkspaceChange) => void>();

  constructor(options: BrowserWorkspaceSyncOptions = {}) {
    this.#channel = 'channel' in options ? options.channel ?? null : createDefaultChannel();
    this.#eventTarget = options.eventTarget === undefined
      ? (typeof window === 'undefined' ? null : window)
      : options.eventTarget;
    this.#storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.#createNonce = options.createNonce ?? defaultNonce;
    if (this.#channel) this.#channel.addEventListener('message', this.#onMessage);
    else this.#eventTarget?.addEventListener('storage', this.#onStorage);
  }

  publish(change: WorkspaceChange): void {
    const message: WorkspaceInvalidation = {
      version: MESSAGE_VERSION,
      nonce: this.#createNonce(),
      projectIds: [...new Set(change.projectIds)].slice(0, MAX_PROJECT_IDS),
    };
    if (!isWorkspaceInvalidation(message)) return;
    if (this.#channel) {
      this.#channel.postMessage(message);
      return;
    }
    try {
      this.#storage?.setItem(STORAGE_KEY, JSON.stringify(message));
    } catch {
      // Revision CAS remains authoritative when browser invalidation is unavailable.
    }
  }

  subscribe(listener: (change: WorkspaceChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  close(): void {
    this.#channel?.removeEventListener('message', this.#onMessage);
    this.#channel?.close();
    this.#eventTarget?.removeEventListener('storage', this.#onStorage);
    this.#listeners.clear();
  }

  readonly #onMessage: EventListener = (event) => {
    this.#receive((event as MessageEvent<unknown>).data);
  };

  readonly #onStorage: EventListener = (event) => {
    const storageEvent = event as StorageEvent;
    if (storageEvent.key !== STORAGE_KEY || storageEvent.newValue === null) return;
    try {
      this.#receive(JSON.parse(storageEvent.newValue) as unknown);
    } catch {
      // Ignore invalidation data written by unrelated or older clients.
    }
  };

  #receive(value: unknown): void {
    if (!isWorkspaceInvalidation(value)) return;
    const change: WorkspaceChange = { projectIds: value.projectIds };
    for (const listener of this.#listeners) listener(change);
  }
}
