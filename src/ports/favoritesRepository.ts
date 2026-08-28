import type { Favorite } from '../domain/favorite';

export interface FavoritesRepository {
  list(): Promise<readonly Favorite[]>;
  save(favorite: Favorite): Promise<readonly Favorite[]>;
  remove(id: string): Promise<readonly Favorite[]>;
}
