import { emojiStyleSnapshotKey } from '../../domain/emojiStyleArchive';
import { decodeEmojiStyle, EMOJI_STYLE_CAPACITY, emojiStyleNameKey, type EmojiStyle } from '../../domain/emojiStyle';
import { EmojiStyleRepositoryError, type EmojiStyleCollection, type EmojiStyleRecordIssue, type EmojiStyleRepository } from '../../ports/emojiStyleRepository';

const DATABASE_NAME = 'seemoji-styles';
const STORE = 'styles';
const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.addEventListener('success', () => resolve(request.result), { once: true });
  request.addEventListener('error', () => reject(request.error), { once: true });
});
const transactionDone = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.addEventListener('complete', () => resolve(), { once: true });
  transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
  transaction.addEventListener('error', () => reject(transaction.error), { once: true });
});
const failure = (cause: unknown, message: string, kind: EmojiStyleRepositoryError['kind']) =>
  cause instanceof EmojiStyleRepositoryError ? cause : new EmojiStyleRepositoryError(message, kind, { cause });

const decodeCollection = (records: readonly unknown[], recover?: (raw: unknown, index: number) => string): EmojiStyleCollection => {
  const issues: EmojiStyleRecordIssue[] = [];
  if (records.length > EMOJI_STYLE_CAPACITY) issues.push({
    id: null, error: `This library exceeds ${EMOJI_STYLE_CAPACITY} styles. Delete entries and refresh to reveal the remaining records.`,
  });
  const styles = records.slice(0, EMOJI_STYLE_CAPACITY).flatMap((raw, index) => {
    const decoded = decodeEmojiStyle(raw);
    const storedNameKey = raw !== null && typeof raw === 'object' && 'nameKey' in raw ? raw.nameKey : null;
    if (decoded.ok && storedNameKey === emojiStyleNameKey(decoded.value.name)) return [decoded.value];
    const id = raw !== null && typeof raw === 'object' && 'id' in raw && typeof raw.id === 'string' ? raw.id : null;
    issues.push({ id, error: decoded.ok ? 'Saved style name metadata is inconsistent.' : decoded.error,
      ...(recover ? { recoveryToken: recover(raw, index) } : {}),
    });
    return [];
  }).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  return { styles, issues };
};

/** Compare the stored graph without JSON's loss of types, undefined, cycles, or binary data. */
const sameStoredValue = (observed: unknown, current: unknown): boolean => {
  const pending: [unknown, unknown][] = [[observed, current]];
  const leftReferences = new Map<object, object>();
  const rightReferences = new Map<object, object>();
  while (pending.length) {
    const [left, right] = pending.pop()!;
    if (Object.is(left, right)) continue;
    if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false;
    if (leftReferences.has(left) || rightReferences.has(right)) {
      if (leftReferences.get(left) !== right || rightReferences.get(right) !== left) return false;
      continue;
    }
    leftReferences.set(left, right);
    rightReferences.set(right, left);
    const kind = Object.prototype.toString.call(left);
    if (kind !== Object.prototype.toString.call(right)) return false;
    if (left instanceof Date && right instanceof Date) {
      if (!Object.is(left.getTime(), right.getTime())) return false;
    } else if (left instanceof RegExp && right instanceof RegExp) {
      if (left.source !== right.source || left.flags !== right.flags) return false;
    } else if (left instanceof ArrayBuffer && right instanceof ArrayBuffer) {
      const a = new Uint8Array(left), b = new Uint8Array(right);
      if (a.length !== b.length || a.some((byte, index) => byte !== b[index])) return false;
    } else if (ArrayBuffer.isView(left) && ArrayBuffer.isView(right)) {
      if (left.byteOffset !== right.byteOffset || left.byteLength !== right.byteLength) return false;
      pending.push([left.buffer, right.buffer]);
    } else if (left instanceof Map && right instanceof Map) {
      if (left.size !== right.size) return false;
      const rightEntries = [...right.entries()];
      [...left.entries()].forEach(([key, value], index) => {
        pending.push([key, rightEntries[index]![0]], [value, rightEntries[index]![1]]);
      });
    } else if (left instanceof Set && right instanceof Set) {
      if (left.size !== right.size) return false;
      const rightValues = [...right];
      [...left].forEach((value, index) => pending.push([value, rightValues[index]]));
    } else if (kind === '[object Object]' || kind === '[object Array]' || left instanceof Error) {
      if (Array.isArray(left) && Array.isArray(right) && left.length !== right.length) return false;
      const leftKeys = (left instanceof Error ? Object.getOwnPropertyNames(left) : Object.keys(left)).sort();
      const rightKeys = (right instanceof Error ? Object.getOwnPropertyNames(right) : Object.keys(right)).sort();
      if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) return false;
      for (const key of leftKeys) pending.push([(left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]]);
    } else {
      // Unknown opaque browser values cannot safely prove that a record stayed unchanged.
      return false;
    }
  }
  return true;
};

export class IndexedDbEmojiStyleRepository implements EmojiStyleRepository {
  readonly #factory: IDBFactory | null;
  readonly #name: string;
  #database: Promise<IDBDatabase> | null = null;
  readonly #recoveryScope = crypto.randomUUID();
  #recoverySequence = 0;
  #recoveries = new Map<string, { readonly key: IDBValidKey; readonly observed: unknown }>();

  constructor(factory: IDBFactory | null = globalThis.indexedDB ?? null, name = DATABASE_NAME) {
    this.#factory = factory;
    this.#name = name;
  }

  async load(): Promise<EmojiStyleCollection> {
    const database = await this.#open();
    try {
      const transaction = database.transaction(STORE, 'readonly');
      const store = transaction.objectStore(STORE);
      const [records, keys] = await Promise.all([
        requestResult<unknown[]>(store.getAll(undefined, EMOJI_STYLE_CAPACITY + 1)),
        requestResult(store.getAllKeys(undefined, EMOJI_STYLE_CAPACITY + 1)), transactionDone(transaction),
      ]);
      const recoveries = new Map<string, { readonly key: IDBValidKey; readonly observed: unknown }>();
      const collection = decodeCollection(records, (observed, index) => {
        const token = `${this.#recoveryScope}:${++this.#recoverySequence}`;
        recoveries.set(token, { key: keys[index]!, observed });
        return token;
      });
      this.#recoveries = recoveries;
      return collection;
    } catch (cause) {
      throw failure(cause, 'Saved styles could not be read. Try refreshing the library.', 'read-failed');
    }
  }

  async create(style: EmojiStyle): Promise<EmojiStyle> {
    const decoded = decodeEmojiStyle(style);
    if (!decoded.ok) throw new EmojiStyleRepositoryError(decoded.error, 'write-failed');
    const database = await this.#open();
    let rejected: EmojiStyleRepositoryError | null = null;
    try {
      const transaction = database.transaction(STORE, 'readwrite');
      const completed = transactionDone(transaction);
      const store = transaction.objectStore(STORE);
      const count = store.count();
      count.addEventListener('success', () => {
        if (count.result >= EMOJI_STYLE_CAPACITY) {
          rejected = new EmojiStyleRepositoryError(`Your library holds up to ${EMOJI_STYLE_CAPACITY} styles. Delete a style before saving another.`, 'capacity');
          transaction.abort();
          return;
        }
        const duplicate = store.index('nameKey').getKey(emojiStyleNameKey(decoded.value.name));
        duplicate.addEventListener('success', () => {
          if (duplicate.result !== undefined) {
            rejected = new EmojiStyleRepositoryError('A style with that name already exists. Choose another name.', 'duplicate');
            transaction.abort();
            return;
          }
          const insert = store.add({ ...decoded.value, nameKey: emojiStyleNameKey(decoded.value.name) });
          insert.addEventListener('error', () => {
            if (insert.error?.name === 'ConstraintError') rejected = new EmojiStyleRepositoryError('That style identity already exists. Refresh and try again.', 'duplicate');
          }, { once: true });
        }, { once: true });
      }, { once: true });
      await completed;
      return decoded.value;
    } catch (cause) {
      throw rejected ?? failure(cause, 'The style could not be saved. Browser storage may be full or unavailable.', 'write-failed');
    }
  }

  async importStyles(styles: readonly EmojiStyle[], expected: readonly EmojiStyle[]): Promise<readonly EmojiStyle[]> {
    if (styles.length > EMOJI_STYLE_CAPACITY || expected.length > EMOJI_STYLE_CAPACITY) {
      throw new EmojiStyleRepositoryError(`A library holds up to ${EMOJI_STYLE_CAPACITY} styles.`, 'capacity');
    }
    const canonical = styles.map((style) => {
      const decoded = decodeEmojiStyle(style);
      if (!decoded.ok) throw new EmojiStyleRepositoryError(decoded.error, 'write-failed');
      return decoded.value;
    });
    const expectedCanonical = expected.map((style) => {
      const decoded = decodeEmojiStyle(style);
      if (!decoded.ok) throw new EmojiStyleRepositoryError('The import preview has invalid library data. Preview again.', 'conflict');
      return decoded.value;
    });
    const incomingIds = new Set(canonical.map(({ id }) => id));
    const incomingNames = new Set(canonical.map(({ name }) => emojiStyleNameKey(name)));
    if (incomingIds.size !== canonical.length || incomingNames.size !== canonical.length) {
      throw new EmojiStyleRepositoryError('The import contains duplicate identities or unresolved names. Preview again.', 'duplicate');
    }
    const database = await this.#open();
    let rejected: EmojiStyleRepositoryError | null = null;
    try {
      const transaction = database.transaction(STORE, 'readwrite');
      const completed = transactionDone(transaction);
      const store = transaction.objectStore(STORE);
      const read = store.getAll(undefined, EMOJI_STYLE_CAPACITY + 1);
      read.addEventListener('success', () => {
        const current = decodeCollection(read.result);
        const reject = (error: EmojiStyleRepositoryError) => { rejected = error; transaction.abort(); };
        if (current.issues.length) {
          reject(new EmojiStyleRepositoryError('The saved style library contains unreadable records. Repair them before importing.', 'corrupt'));
          return;
        }
        if (emojiStyleSnapshotKey(current.styles) !== emojiStyleSnapshotKey(expectedCanonical)) {
          reject(new EmojiStyleRepositoryError('The saved style library changed after this preview. Preview the import again.', 'conflict'));
          return;
        }
        if (current.styles.length + canonical.length > EMOJI_STYLE_CAPACITY) {
          reject(new EmojiStyleRepositoryError(`This import would exceed ${EMOJI_STYLE_CAPACITY} saved styles. Preview again after freeing space.`, 'capacity'));
          return;
        }
        const existingIds = new Set(current.styles.map(({ id }) => id));
        const existingNames = new Set(current.styles.map(({ name }) => emojiStyleNameKey(name)));
        if (canonical.some(({ id, name }) => existingIds.has(id) || existingNames.has(emojiStyleNameKey(name)))) {
          reject(new EmojiStyleRepositoryError('An imported identity or name conflicts with an existing style. Preview again.', 'duplicate'));
          return;
        }
        for (const style of canonical) {
          const insert = store.add({ ...style, nameKey: emojiStyleNameKey(style.name) });
          insert.addEventListener('error', () => {
            if (insert.error?.name === 'ConstraintError') rejected = new EmojiStyleRepositoryError('The import conflicts with a saved style. Preview again.', 'duplicate');
          }, { once: true });
        }
      }, { once: true });
      await completed;
      return canonical;
    } catch (cause) {
      throw rejected ?? failure(cause, 'The style import could not be saved. No styles were imported; browser storage may be full or unavailable.', 'write-failed');
    }
  }

  async delete(id: string): Promise<void> {
    const database = await this.#open();
    try {
      const transaction = database.transaction(STORE, 'readwrite');
      const completed = transactionDone(transaction);
      transaction.objectStore(STORE).delete(id);
      await completed;
    } catch (cause) {
      throw failure(cause, 'The style could not be deleted. Please try again.', 'write-failed');
    }
  }

  async removeUnreadable(recoveryToken: string): Promise<void> {
    const recovery = this.#recoveries.get(recoveryToken);
    if (!recovery) throw new EmojiStyleRepositoryError('This unreadable style recovery action expired. Refresh styles and try again.', 'conflict');
    const database = await this.#open();
    let rejected: EmojiStyleRepositoryError | null = null;
    try {
      const transaction = database.transaction(STORE, 'readwrite');
      const completed = transactionDone(transaction);
      const store = transaction.objectStore(STORE);
      const read = store.get(recovery.key);
      read.addEventListener('success', () => {
        if (!sameStoredValue(recovery.observed, read.result) || !decodeCollection([read.result]).issues.length) {
          rejected = new EmojiStyleRepositoryError('The unreadable style changed after it was shown. Nothing was deleted. Refresh styles and review it again.', 'conflict');
          transaction.abort();
          return;
        }
        store.delete(recovery.key);
      }, { once: true });
      await completed;
      this.#recoveries.delete(recoveryToken);
    } catch (cause) {
      throw rejected ?? failure(cause, 'The unreadable style could not be deleted. Please refresh and try again.', 'write-failed');
    }
  }

  #open(): Promise<IDBDatabase> {
    if (this.#database) return this.#database;
    const factory = this.#factory;
    if (!factory) return Promise.reject(new EmojiStyleRepositoryError('Saved styles need browser storage, which is unavailable.', 'unavailable'));
    this.#database = new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      const rejectOpen = (error: EmojiStyleRepositoryError) => { settled = true; reject(error); };
      let request: IDBOpenDBRequest;
      try { request = factory.open(this.#name, 1); }
      catch (cause) { rejectOpen(failure(cause, 'Saved styles storage could not be opened.', 'unavailable')); return; }
      request.addEventListener('upgradeneeded', () => {
        try {
          const store = request.result.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('nameKey', 'nameKey', { unique: true });
        } catch (cause) {
          request.transaction?.abort();
          rejectOpen(failure(cause, 'Saved styles storage could not be initialized.', 'schema-mismatch'));
        }
      });
      request.addEventListener('blocked', () => rejectOpen(new EmojiStyleRepositoryError('Close other seemoji tabs, then retry opening saved styles.', 'upgrade-blocked')));
      request.addEventListener('error', () => rejectOpen(failure(request.error, 'Saved styles storage could not be opened.', 'unavailable')));
      request.addEventListener('success', () => {
        const database = request.result;
        if (settled) { database.close(); return; }
        try {
          if (database.version !== 1 || database.objectStoreNames.length !== 1 || !database.objectStoreNames.contains(STORE)) throw new Error('unexpected database stores');
          const store = database.transaction(STORE, 'readonly').objectStore(STORE);
          if (store.keyPath !== 'id' || store.autoIncrement || !store.indexNames.contains('nameKey')
            || !store.index('nameKey').unique || store.index('nameKey').keyPath !== 'nameKey') throw new Error('unexpected saved style schema');
          database.addEventListener('versionchange', () => { database.close(); this.#database = null; });
          settled = true;
          resolve(database);
        } catch (cause) {
          database.close();
          rejectOpen(failure(cause, 'Saved styles storage has an unsupported schema.', 'schema-mismatch'));
        }
      });
    }).catch((cause: unknown) => { this.#database = null; throw cause; });
    return this.#database;
  }
}
