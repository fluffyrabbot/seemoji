import type { BrushStroke, LayerBounds, MaskStroke, RasterRun } from '../domain/design';
import type { LinearMatrix, RenderPlan } from '../domain/renderPlan';

export type RenderLayerInput =
  | {
      readonly kind: 'emoji';
      readonly asset: CanvasImageSource;
      readonly plan: RenderPlan;
      readonly opacity: number;
      readonly mask: readonly MaskStroke[];
      readonly cacheKey: string;
    }
  | {
      readonly kind: 'strokes';
      readonly visible: boolean;
      readonly opacity: number;
      readonly matrix: LinearMatrix & { readonly e: number; readonly f: number };
      readonly strokes: readonly BrushStroke[];
      readonly mask: readonly MaskStroke[];
      readonly cacheKey: string;
    }
  | {
      readonly kind: 'shape';
      readonly visible: boolean;
      readonly opacity: number;
      readonly matrix: LinearMatrix & { readonly e: number; readonly f: number };
      readonly shape: 'rectangle' | 'ellipse' | 'line';
      readonly bounds: LayerBounds;
      readonly fill: string | null;
      readonly stroke: { readonly color: string; readonly width: number } | null;
      readonly mask: readonly MaskStroke[];
      readonly cacheKey: string;
    }
  | {
      readonly kind: 'text';
      readonly visible: boolean;
      readonly opacity: number;
      readonly matrix: LinearMatrix & { readonly e: number; readonly f: number };
      readonly bounds: LayerBounds;
      readonly text: string;
      readonly fontSize: number;
      readonly color: string;
      readonly fontFamily: 'sans-serif' | 'serif' | 'monospace';
      readonly align: 'left' | 'center' | 'right';
      readonly mask: readonly MaskStroke[];
      readonly cacheKey: string;
    }
  | {
      readonly kind: 'raster';
      readonly visible: boolean;
      readonly opacity: number;
      readonly matrix: LinearMatrix & { readonly e: number; readonly f: number };
      readonly resolution: number;
      readonly runs: readonly RasterRun[];
      readonly mask: readonly MaskStroke[];
      readonly cacheKey: string;
    };

export interface RenderSceneInput {
  readonly size: number;
  /** Back-to-front paint order. */
  readonly layers: readonly RenderLayerInput[];
}

export interface RenderedFrame {
  readonly canvas: HTMLCanvasElement;
  readonly warnings: readonly string[];
}

export interface RendererPort {
  render(scene: RenderSceneInput): RenderedFrame;
  toPng(frame: RenderedFrame): Promise<Blob>;
}
