/** LRU with an explicit resource budget; oversized entries are never retained. */
export class WeightedCache<K, V> {
  readonly #entries = new Map<K, { value: V; weight: number }>();
  #weight = 0;
  readonly budget: number;
  constructor(budget: number) { this.budget = budget; }
  get(key: K): V | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }
  set(key: K, value: V, weight: number): void {
    this.delete(key);
    if (!Number.isFinite(weight) || weight < 0 || weight > this.budget) return;
    this.#entries.set(key, { value, weight });
    this.#weight += weight;
    while (this.#weight > this.budget) this.delete(this.#entries.keys().next().value!);
  }
  delete(key: K): void {
    const entry = this.#entries.get(key);
    if (entry) this.#weight -= entry.weight;
    this.#entries.delete(key);
  }
}
