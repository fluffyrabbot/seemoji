import type { BrushStroke, MaskStroke, StrokePoint } from '../../domain/design';
import type { RenderPlan } from '../../domain/renderPlan';
import type {
  RenderLayerInput,
  RenderedFrame,
  RendererPort,
  RenderSceneInput,
} from '../../ports/renderer';

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
    outlineContext.drawImage(source, Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  outlineContext.globalCompositeOperation = 'source-in';
  outlineContext.fillStyle = color;
  outlineContext.fillRect(0, 0, outline.width, outline.height);
  destination.drawImage(outline, 0, 0);
}

const drawShape = (
  destination: CanvasRenderingContext2D,
  layer: Extract<RenderLayerInput, { readonly kind: 'shape' }>,
  size: number,
) => {
  const { x, y, width, height } = layer.bounds;
  destination.beginPath();
  if (layer.shape === 'rectangle') {
    destination.rect(x * size, y * size, width * size, height * size);
  } else if (layer.shape === 'ellipse') {
    destination.ellipse((x + width / 2) * size, (y + height / 2) * size,
      width * size / 2, height * size / 2, 0, 0, Math.PI * 2);
  } else {
    destination.moveTo(x * size, y * size);
    destination.lineTo((x + width) * size, (y + height) * size);
  }
  if (layer.fill && layer.shape !== 'line') {
    destination.fillStyle = layer.fill;
    destination.fill();
  }
  if (layer.stroke) {
    destination.strokeStyle = layer.stroke.color;
    destination.lineWidth = layer.stroke.width * size;
    destination.lineCap = 'round';
    destination.lineJoin = 'round';
    destination.stroke();
  }
};

const drawText = (
  destination: CanvasRenderingContext2D,
  layer: Extract<RenderLayerInput, { readonly kind: 'text' }>,
  size: number,
) => {
  const { x, y, width } = layer.bounds;
  destination.fillStyle = layer.color;
  destination.font = `${layer.fontSize * size}px ${layer.fontFamily}`;
  destination.textAlign = layer.align;
  destination.textBaseline = 'top';
  const anchor = layer.align === 'left' ? x : layer.align === 'center' ? x + width / 2 : x + width;
  destination.fillText(layer.text, anchor * size, y * size, width * size);
};

const drawRaster = (
  destination: CanvasRenderingContext2D,
  layer: Extract<RenderLayerInput, { readonly kind: 'raster' }>,
  size: number,
) => {
  const cell = size / layer.resolution;
  for (const run of layer.runs) {
    destination.fillStyle = run.color;
    destination.fillRect(run.xStart * cell, run.y * cell, (run.xEnd - run.xStart + 1) * cell, cell);
  }
};

const setLru = <T,>(map: Map<string, T>, key: string, value: T, maximum: number) => {
  map.delete(key);
  map.set(key, value);
  while (map.size > maximum) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
};

const pressure = (point: StrokePoint): number => Math.max(0.08, point.pressure);

function drawPath(
  destination: CanvasRenderingContext2D,
  points: readonly StrokePoint[],
  size: number,
  width: number,
  color: string,
  opacity: number,
): void {
  const first = points[0];
  if (!first) return;
  destination.save();
  destination.strokeStyle = color;
  destination.fillStyle = color;
  destination.globalAlpha = opacity;
  destination.lineCap = 'round';
  destination.lineJoin = 'round';
  if (points.length === 1) {
    destination.beginPath();
    destination.arc(
      first.x * size,
      first.y * size,
      (width * size * pressure(first)) / 2,
      0,
      Math.PI * 2,
    );
    destination.fill();
    destination.restore();
    return;
  }
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) continue;
    destination.lineWidth = width * size * ((pressure(previous) + pressure(current)) / 2);
    destination.beginPath();
    destination.moveTo(previous.x * size, previous.y * size);
    destination.lineTo(current.x * size, current.y * size);
    destination.stroke();
  }
  destination.restore();
}

function drawBrushStroke(
  destination: CanvasRenderingContext2D,
  stroke: BrushStroke,
  size: number,
): void {
  drawPath(destination, stroke.points, size, stroke.width, stroke.color, stroke.opacity);
}

function applyMask(
  destination: CanvasRenderingContext2D,
  mask: readonly MaskStroke[],
  size: number,
): void {
  if (mask.length === 0) return;
  const maskCanvas = createCanvas(size);
  const maskContext = context(maskCanvas);
  maskContext.fillStyle = '#ffffff';
  maskContext.fillRect(0, 0, size, size);
  for (const stroke of mask) {
    maskContext.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over';
    drawPath(maskContext, stroke.points, size, stroke.width, '#ffffff', 1);
  }
  destination.save();
  destination.globalCompositeOperation = 'destination-in';
  destination.drawImage(maskCanvas, 0, 0);
  destination.restore();
}

function drawEmoji(
  asset: CanvasImageSource,
  plan: RenderPlan,
): { readonly canvas: HTMLCanvasElement; readonly warnings: readonly string[] } {
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
    drawOutline(destination, sourceLayer, plan.outline.widthPixels, plan.outline.color);
  }
  destination.drawImage(sourceLayer, 0, 0);
  return { canvas, warnings };
}

export class BrowserCanvasRenderer implements RendererPort {
  readonly #layerCache = new Map<string, { readonly canvas: HTMLCanvasElement; readonly warnings: readonly string[] }>();

  render(scene: RenderSceneInput): RenderedFrame {
    const canvas = createCanvas(scene.size);
    const destination = context(canvas);
    const warnings: string[] = [];

    for (const layer of scene.layers) {
      if (layer.kind === 'emoji' ? !layer.plan.visible : !layer.visible) continue;
      let layerCanvas: HTMLCanvasElement;
      const cached = this.#layerCache.get(layer.cacheKey);
      if (cached) {
        setLru(this.#layerCache, layer.cacheKey, cached, 64);
        layerCanvas = cached.canvas;
        warnings.push(...cached.warnings);
      } else {
        const layerWarnings: string[] = [];
        if (layer.kind === 'emoji') {
          const rendered = drawEmoji(layer.asset, layer.plan);
          layerCanvas = rendered.canvas;
          layerWarnings.push(...rendered.warnings);
        } else {
          layerCanvas = createCanvas(scene.size);
          const layerContext = context(layerCanvas);
          if (layer.kind === 'strokes') {
            for (const stroke of layer.strokes) drawBrushStroke(layerContext, stroke, scene.size);
          } else if (layer.kind === 'shape') {
            drawShape(layerContext, layer, scene.size);
          } else if (layer.kind === 'text') {
            drawText(layerContext, layer, scene.size);
          } else {
            drawRaster(layerContext, layer, scene.size);
          }
        }
        applyMask(context(layerCanvas), layer.mask, scene.size);
        setLru(this.#layerCache, layer.cacheKey, { canvas: layerCanvas, warnings: layerWarnings }, 64);
        warnings.push(...layerWarnings);
      }
      destination.save();
      destination.globalAlpha = layer.opacity;
      if (layer.kind !== 'emoji') {
        const { a, b, c, d, e, f } = layer.matrix;
        destination.setTransform(a, b, c, d, e, f);
        destination.drawImage(layerCanvas, -scene.size / 2, -scene.size / 2);
      } else {
        destination.drawImage(layerCanvas, 0, 0);
      }
      destination.restore();
    }

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
