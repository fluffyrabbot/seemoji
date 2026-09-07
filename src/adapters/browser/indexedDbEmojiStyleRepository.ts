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

export class IndexedDbEmojiStyleRepository implements EmojiStyleRepository {
  readonly #factory: IDBFactory | null;
  readonly #name: string;
  #database: Promise<IDBDatabase> | null = null;

  constructor(factory: IDBFactory | null = globalThis.indexedDB ?? null, name = DATABASE_NAME) {
    this.#factory = factory;
    this.#name = name;
  }

  async load(): Promise<EmojiStyleCollection> {
    const database = await this.#open();
    try {
      const transaction = database.transaction(STORE, 'readonly');
      const [records] = await Promise.all([
        requestResult<unknown[]>(transaction.objectStore(STORE).getAll(undefined, EMOJI_STYLE_CAPACITY + 1)), transactionDone(transaction),
      ]);
      const issues: EmojiStyleRecordIssue[] = [];
      if (records.length > EMOJI_STYLE_CAPACITY) issues.push({
        id: null, error: `This library exceeds ${EMOJI_STYLE_CAPACITY} styles. Delete entries and refresh to reveal the remaining records.`,
      });
      const styles = records.slice(0, EMOJI_STYLE_CAPACITY).flatMap((raw) => {
        const decoded = decodeEmojiStyle(raw);
        const storedNameKey = raw !== null && typeof raw === 'object' && 'nameKey' in raw ? raw.nameKey : null;
        if (decoded.ok && storedNameKey === emojiStyleNameKey(decoded.value.name)) return [decoded.value];
        const id = raw !== null && typeof raw === 'object' && 'id' in raw && typeof raw.id === 'string' ? raw.id : null;
        issues.push({ id, error: decoded.ok ? 'Saved style name metadata is inconsistent.' : decoded.error });
        return [];
      }).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
      return { styles, issues };
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
