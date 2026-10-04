import type { SceneLayer, StrokePoint, TextLayer } from '../domain/design';
import type { WorldBounds } from '../domain/sceneGeometry';
import type { PlacementTool } from '../domain/placement';
interface Point { readonly x: number; readonly y: number }

export type Gesture =
  | {
      readonly kind: 'move';
      readonly pointerId: number;
      readonly start: Point;
      readonly layers: readonly SceneLayer[];
      readonly bounds: WorldBounds;
    }
  | {
      readonly kind: 'scale';
      readonly pointerId: number;
      readonly center: Point;
      readonly startLocal: Point | null;
      readonly uniform: boolean;
      readonly startDistance: number;
      readonly layers: readonly SceneLayer[];
    }
  | {
      readonly kind: 'rotate';
      readonly pointerId: number;
      readonly center: Point;
      readonly lastAngle: number;
      readonly angleDelta: number;
      readonly layers: readonly SceneLayer[];
    };

export interface Marquee {
  readonly pointerId: number;
  readonly start: Point;
  readonly current: Point;
  readonly additive: boolean;
}

export interface DraftStroke {
  readonly kind: 'brush' | 'eraser' | 'restore';
  readonly pointerId: number;
  readonly targetLayerId: string;
  readonly createLayer: boolean;
  readonly layerLocal: boolean;
  readonly points: readonly StrokePoint[];
  readonly width: number;
  readonly color: string;
  readonly opacity: number;
}


export interface InteractionValues {
  readonly transform: Gesture;
  readonly stroke: DraftStroke;
  readonly marquee: Marquee;
  readonly placement: { readonly tool: PlacementTool; readonly pointerId: number; readonly start: Point;
    readonly current: Point; readonly shiftKey: boolean; readonly altKey: boolean; readonly id: string; readonly color: string };
  readonly tail: { readonly pointerId: number; readonly layer: TextLayer; readonly moved: boolean };
}
export type CanvasInteraction = { readonly kind: 'idle' } | {
  [K in keyof InteractionValues]: { readonly kind: K; readonly value: InteractionValues[K] }
}[keyof InteractionValues];

/** One pointer-owned artwork interaction; navigation cancels it before taking over. */
export class CanvasInteractionStore {
  #state: CanvasInteraction = { kind: 'idle' };
  readonly #listeners = new Set<() => void>();
  getSnapshot = (): CanvasInteraction => this.#state;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  read<K extends keyof InteractionValues>(kind: K): InteractionValues[K] | null {
    return this.#state.kind === kind ? this.#state.value as InteractionValues[K] : null;
  }
  begin<K extends keyof InteractionValues>(kind: K, value: InteractionValues[K]): void {
    this.#set({ kind, value } as CanvasInteraction);
  }
  update<K extends keyof InteractionValues>(kind: K, value: InteractionValues[K]): void {
    const current = this.read(kind);
    if (current?.pointerId === value.pointerId) this.begin(kind, value);
  }
  finish(pointerId?: number): CanvasInteraction {
    const current = this.#state;
    if (current.kind === 'idle' || (pointerId !== undefined && current.value.pointerId !== pointerId)) return { kind: 'idle' };
    this.#set({ kind: 'idle' });
    return current;
  }
  cancel(pointerId?: number): CanvasInteraction { return this.finish(pointerId); }
  #set(state: CanvasInteraction): void {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
}
