import type { RenderPlan } from '../../domain/renderPlan';
import type { RenderedFrame, RendererPort } from '../../ports/renderer';

const createCanvas = (size: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
};

const context = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => {
  const value = canvas.getContext('2d');
  if (!value) throw new Error('Canvas 2D rendering is unavailable');
  return value;
};

function drawOutline(
  destination: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  width: number,
  color: string,
): void {
  if (width <= 0) return;
  const outline = createCanvas(source.width);
  const outlineContext = context(outline);
  const radius = Math.max(1, width);
  const samples = Math.max(24, Math.ceil(2 * Math.PI * radius * 2));

  for (let index = 0; index < samples; index += 1) {
    const angle = (index / samples) * Math.PI * 2;
    outlineContext.drawImage(
      source,
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
    );
  }
  outlineContext.globalCompositeOperation = 'source-in';
  outlineContext.fillStyle = color;
  outlineContext.fillRect(0, 0, outline.width, outline.height);
  destination.drawImage(outline, 0, 0);
}

export class BrowserCanvasRenderer implements RendererPort {
  render(asset: CanvasImageSource, plan: RenderPlan): RenderedFrame {
    const sourceLayer = createCanvas(plan.size);
    const sourceContext = context(sourceLayer);
    const warnings: string[] = [];

    if (plan.filters.length > 0) {
      if (typeof sourceContext.filter === 'string') {
        sourceContext.filter = plan.filters.join(' ');
      } else {
        warnings.push('This browser cannot reproduce color and blur effects.');
      }
    }

    const { a, b, c, d, e, f } = plan.matrix;
    sourceContext.setTransform(a, b, c, d, e, f);
    sourceContext.drawImage(
      asset,
      -plan.glyphSize / 2,
      -plan.glyphSize / 2,
      plan.glyphSize,
      plan.glyphSize,
    );

    const canvas = createCanvas(plan.size);
    const destination = context(canvas);
    if (plan.outline) {
      drawOutline(
        destination,
        sourceLayer,
        plan.outline.widthPixels,
        plan.outline.color,
      );
    }
    destination.drawImage(sourceLayer, 0, 0);
    return { canvas, warnings };
  }

  toPng(frame: RenderedFrame): Promise<Blob> {
    return new Promise((resolve, reject) => {
      frame.canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('The browser could not encode the PNG'));
      }, 'image/png');
    });
  }
}
