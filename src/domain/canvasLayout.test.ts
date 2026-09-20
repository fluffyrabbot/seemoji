import { describe, expect, it } from 'vitest';
import { comicPanels, emojiSpawnTransform } from './canvasLayout';
import { DEFAULT_DESIGN, DEFAULT_TRANSFORM } from './design';
import { decodeDesignDocument } from './designCodec';
import { editorReducer, INITIAL_EDITOR_STATE } from '../application/editor';

describe('comic canvas layouts', () => {
  it.each(['comic4', 'comic6'] as const)('keeps %s panels inside the page with gutters and valid smaller emojis', (layout) => {
    const panels = comicPanels(layout);
    expect(panels).toHaveLength(layout === 'comic4' ? 4 : 6);
    for (const panel of panels) {
      expect(panel.x).toBeGreaterThan(0);
      expect(panel.y).toBeGreaterThan(0);
      expect(panel.x + panel.width).toBeLessThan(1);
      expect(panel.y + panel.height).toBeLessThan(1);
    }
    expect(panels[0]!.x + panels[0]!.width).toBeLessThan(panels[1]!.x);
    const transform = emojiSpawnTransform(layout);
    expect(transform.scaleX).toBeLessThan(0.4);
    expect(transform.scaleY).toBe(transform.scaleX);
    expect(transform.x + 0.5).toBeCloseTo(panels[0]!.x + panels[0]!.width / 2);
    const design = { ...DEFAULT_DESIGN, canvas: { layout },
      layers: DEFAULT_DESIGN.layers.map((layer) => ({ ...layer, transform })) };
    expect(decodeDesignDocument(design)).toEqual({ ok: true, value: design });
  });

  it('restores the default spawn and records canvas changes as undoable document state', () => {
    expect(comicPanels('default')).toEqual([]);
    expect(emojiSpawnTransform('default')).toEqual(DEFAULT_TRANSFORM);
    const comic = editorReducer(INITIAL_EDITOR_STATE, { type: 'set-canvas-layout', layout: 'comic6' });
    expect(comic.design.layers).toBe(INITIAL_EDITOR_STATE.design.layers);
    expect(editorReducer(comic, { type: 'undo' }).design).toEqual(DEFAULT_DESIGN);
    expect(editorReducer(editorReducer(comic, { type: 'undo' }), { type: 'redo' }).design).toEqual(comic.design);
  });

  it('migrates V3 canvases and rejects unknown layouts rather than losing page structure', () => {
    expect(decodeDesignDocument({ ...DEFAULT_DESIGN, version: 3, canvas: { background: 'transparent' } }))
      .toEqual({ ok: true, value: DEFAULT_DESIGN });
    expect(decodeDesignDocument({ ...DEFAULT_DESIGN, canvas: { layout: 'comic99' } }).ok).toBe(false);
  });
});
