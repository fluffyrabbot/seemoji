export interface WorkspaceChange {
  readonly projectIds: readonly string[];
}

export interface WorkspaceSync {
  publish(change: WorkspaceChange): void;
  subscribe(listener: (change: WorkspaceChange) => void): () => void;
  close(): void;
}
