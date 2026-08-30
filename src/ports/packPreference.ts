import type { PackSnapshot } from '../domain/pack';

export interface PackPreferenceStore {
  read(): Promise<PackSnapshot | null>;
  write(preference: PackSnapshot): Promise<void>;
}
