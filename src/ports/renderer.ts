import type { RenderPlan } from '../domain/renderPlan';

export interface RenderedFrame {
  readonly canvas: HTMLCanvasElement;
  readonly warnings: readonly string[];
}

export interface RendererPort {
  render(asset: CanvasImageSource, plan: RenderPlan): RenderedFrame;
  toPng(frame: RenderedFrame): Promise<Blob>;
}
