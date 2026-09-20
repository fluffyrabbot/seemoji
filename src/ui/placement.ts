import { DEFAULT_TRANSFORM, type SceneLayer } from '../domain/design';

export type PlacementTool = 'text' | 'rectangle' | 'ellipse' | 'line';
export interface PlacementPoint { readonly x: number; readonly y: number }
export const isPlacementTool = (tool: string): tool is PlacementTool =>
  tool === 'text' || tool === 'rectangle' || tool === 'ellipse' || tool === 'line';

/** Uses canvas coordinates, independently of viewport zoom, pan, or selection. */
export function createPlacedLayer(tool: PlacementTool, start: PlacementPoint,
  end: PlacementPoint, id: string, color: string): SceneLayer {
  const unit = (value: number) => Math.min(1, Math.max(0, value));
  const a = { x: unit(start.x), y: unit(start.y) };
  const b = { x: unit(end.x), y: unit(end.y) };
  const click = Math.hypot(b.x - a.x, b.y - a.y) < 0.01;
  const width = tool === 'text' && click ? 0.6 : Math.max(0.001, Math.abs(b.x - a.x));
  const height = tool === 'text' && click ? 0.24 : Math.max(0.001, Math.abs(b.y - a.y));
  const bounds = { x: Math.min(1 - width, Math.min(a.x, b.x)),
    y: Math.min(1 - height, Math.min(a.y, b.y)), width, height };
  const negativeSlope = tool === 'line' && (b.x - a.x) * (b.y - a.y) < 0;
  const common = { id, name: tool[0]!.toUpperCase() + tool.slice(1), visible: true,
    opacity: 1, mask: [], transform: { ...DEFAULT_TRANSFORM,
      ...(negativeSlope ? { flipV: true, y: bounds.y * 2 + height - 1 } : {}) } };
  return tool === 'text'
    ? { ...common, kind: 'text', bounds, text: 'Text', fontSize: Math.min(0.18, Math.max(0.01, height * 0.75)),
      color, fontFamily: 'sans-serif', align: 'center' }
    : { ...common, kind: 'shape', shape: tool, bounds, fill: tool === 'line' ? null : color,
      stroke: tool === 'line' ? { color, width: 0.025 } : null };
}
