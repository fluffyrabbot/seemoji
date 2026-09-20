import type { CanvasLayout, LayerBounds, Transform } from './design';
import { DEFAULT_TRANSFORM } from './design';

/** Normalized page geometry shared by rendering and new-object placement. */
export function comicPanels(layout: CanvasLayout): readonly LayerBounds[] {
  if (layout === 'default') return [];
  const rows = layout === 'comic4' ? 2 : 3;
  const margin = 0.04, gutter = 0.025;
  const width = (1 - margin * 2 - gutter) / 2;
  const height = (1 - margin * 2 - gutter * (rows - 1)) / rows;
  return Array.from({ length: rows * 2 }, (_, index) => ({
    x: margin + (index % 2) * (width + gutter),
    y: margin + Math.floor(index / 2) * (height + gutter), width, height,
  }));
}

export function emojiSpawnTransform(layout: CanvasLayout): Transform {
  const panel = comicPanels(layout)[0];
  const scale = panel ? Math.max(0.25, Math.min(panel.width, panel.height) * 0.8) : 1;
  return panel ? { ...DEFAULT_TRANSFORM, scaleX: scale, scaleY: scale,
    x: panel.x + panel.width / 2 - 0.5, y: panel.y + panel.height / 2 - 0.5 } : DEFAULT_TRANSFORM;
}
