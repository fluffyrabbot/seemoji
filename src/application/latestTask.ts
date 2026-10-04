/** At most one active task and one waiting input. Superseded results never publish. */
export class LatestTask<Input, Output> {
  #generation = 0;
  #running = false;
  #pending: { input: Input; generation: number; success: (output: Output) => void; failure: (cause: unknown) => void } | null = null;
  readonly run: (input: Input) => Promise<Output>;
  constructor(run: (input: Input) => Promise<Output>) { this.run = run; }
  request(input: Input, success: (output: Output) => void, failure: (cause: unknown) => void): void {
    this.#pending = { input, generation: ++this.#generation, success, failure };
    void this.#drain();
  }
  cancel(): void { this.#generation++; this.#pending = null; }
  async #drain(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      while (this.#pending) {
        const task = this.#pending;
        this.#pending = null;
        try {
          const output = await this.run(task.input);
          if (task.generation === this.#generation) task.success(output);
        } catch (cause) {
          if (task.generation === this.#generation) task.failure(cause);
        }
      }
    } finally { this.#running = false; }
  }
}
