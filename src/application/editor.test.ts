import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSFORM,
  getEmojiLayer,
  type BrushStroke,
  type MaskStroke,
  type StrokeLayer,
  type StrokePoint,
} from '../domain/design';
import { DESIGN_CAPACITY } from '../domain/designCapacity';
import { decodeDesignDocument } from '../domain/designCodec';
import { createEmojiAssetRef } from '../domain/emoji';
import { editorReducer, INITIAL_EDITOR_STATE } from './editor';

const POINT: StrokePoint = { x: 0.5, y: 0.5, pressure: 0.5 };

const brushStroke = (id: string, pointCount: number): BrushStroke => ({
  id,
  points: Array<StrokePoint>(pointCount).fill(POINT),
  width: 0.03,
  color: '#000000',
  opacity: 1,
});

const maskStroke = (id: string, pointCount: number): MaskStroke => ({
  id,
  mode: 'erase',
  points: Array<StrokePoint>(pointCount).fill(POINT),
  width: 0.03,
});

const strokeLayer = (
  id: string,
  strokes: readonly BrushStroke[] = [],
  mask: readonly MaskStroke[] = [],
): StrokeLayer => ({
  id,
  kind: 'strokes',
  name: 'Paint',
  visible: true,
  opacity: 1,
  transform: DEFAULT_TRANSFORM,
  strokes,
  mask,
});

describe('editor reducer', () => {
  it('updates the emoji layer without changing source identity', () => {
    const initialLayer = getEmojiLayer(INITIAL_EDITOR_STATE.design);
    const state = editorReducer(INITIAL_EDITOR_STATE, {
      type: 'update-transform',
      transform: { ...initialLayer.transform, rotate: 20 },
    });
    expect(getEmojiLayer(state.design).transform.rotate).toBe(20);
    expect(getEmojiLayer(state.design).source).toBe(initialLayer.source);
  });

  it('reset preserves the selected artwork', () => {
    const selected = editorReducer(INITIAL_EDITOR_STATE, {
      type: 'set-source',
      source: createEmojiAssetRef('👍'),
    });
    const edited = editorReducer(selected, {
      type: 'update-transform',
      transform: { ...getEmojiLayer(selected.design).transform, rotate: 45 },
    });
    const reset = editorReducer(edited, { type: 'reset' });
    expect(getEmojiLayer(reset.design).source.grapheme).toBe('👍');
    expect(getEmojiLayer(reset.design).transform.rotate).toBe(0);
  });

  it('coalesces a gesture into one undo step and supports redo', () => {
    const initial = getEmojiLayer(INITIAL_EDITOR_STATE.design).transform;
    const first = editorReducer(INITIAL_EDITOR_STATE, {
      type: 'update-transform',
      transform: { ...initial, x: 0.1 },
      historyGroup: 'canvas:move',
    });
    const second = editorReducer(first, {
      type: 'update-transform',
      transform: { ...initial, x: 0.2 },
      historyGroup: 'canvas:move',
    });
    expect(second.past).toHaveLength(1);

    const undone = editorReducer(second, { type: 'undo' });
    expect(getEmojiLayer(undone.design).transform.x).toBe(0);
    const redone = editorReducer(undone, { type: 'redo' });
    expect(getEmojiLayer(redone.design).transform.x).toBe(0.2);
  });

  it('creates a paint layer and its first stroke as one undoable command', () => {
    const painted = editorReducer(INITIAL_EDITOR_STATE, {
      type: 'paint-stroke',
      layerId: 'paint-1',
      createLayerName: 'Paint',
      stroke: {
        id: 'stroke-1',
        points: [{ x: 0.5, y: 0.5, pressure: 0.75 }],
        width: 0.03,
        color: '#ff00aa',
        opacity: 1,
      },
    });
    expect(painted.design.layers).toHaveLength(2);
    expect(painted.selectedLayerIds).toEqual(['paint-1']);
    expect(painted.past).toHaveLength(1);

    const undone = editorReducer(painted, { type: 'undo' });
    expect(undone.design.layers).toHaveLength(1);
    const redone = editorReducer(undone, { type: 'redo' });
    expect(redone.design.layers[1]).toMatchObject({ kind: 'strokes', id: 'paint-1' });
  });

  it('stores erasing as a mask without altering layer content', () => {
    const painted = editorReducer(INITIAL_EDITOR_STATE, {
      type: 'paint-stroke',
      layerId: 'paint-1',
      createLayerName: 'Paint',
      stroke: {
        id: 'stroke-1',
        points: [{ x: 0.2, y: 0.2, pressure: 0.5 }],
        width: 0.02,
        color: '#000000',
        opacity: 1,
      },
    });
    const masked = editorReducer(painted, {
      type: 'mask-stroke',
      layerId: 'paint-1',
      stroke: {
        id: 'mask-1',
        mode: 'erase',
        points: [{ x: 0.2, y: 0.2, pressure: 0.5 }],
        width: 0.04,
      },
    });
    const layer = masked.design.layers[1];
    expect(layer?.kind).toBe('strokes');
    if (layer?.kind === 'strokes') {
      expect(layer.strokes).toHaveLength(1);
      expect(layer.mask).toHaveLength(1);
    }
  });

  it('edits paint-layer metadata and transforms without changing strokes', () => {
    const painted = editorReducer(INITIAL_EDITOR_STATE, {
      type: 'paint-stroke',
      layerId: 'paint-1',
      createLayerName: 'Paint',
      stroke: {
        id: 'stroke-1',
        points: [{ x: 0.5, y: 0.5, pressure: 0.5 }],
        width: 0.03,
        color: '#000000',
        opacity: 1,
      },
    });
    const renamed = editorReducer(painted, {
      type: 'rename-layer',
      layerId: 'paint-1',
      name: '  Ink  ',
    });
    const transformed = editorReducer(renamed, {
      type: 'update-layer-transform',
      layerId: 'paint-1',
      transform: {
        ...renamed.design.layers[1]!.transform,
        x: 0.2,
        rotate: 15,
      },
    });
    const faded = editorReducer(transformed, {
      type: 'set-layer-opacity',
      layerId: 'paint-1',
      opacity: 0.4,
    });
    const duplicated = editorReducer(faded, {
      type: 'duplicate-layer',
      layerId: 'paint-1',
      duplicateId: 'paint-2',
      name: 'Ink copy',
    });

    expect(duplicated.design.layers[1]).toMatchObject({
      id: 'paint-1',
      name: 'Ink',
      opacity: 0.4,
      transform: { x: 0.2, rotate: 15 },
    });
    expect(duplicated.design.layers[2]).toMatchObject({ id: 'paint-2', name: 'Ink copy' });
    expect(duplicated.selectedLayerIds).toEqual(['paint-2']);
    expect(duplicated.design.layers[2]?.kind === 'strokes'
      ? duplicated.design.layers[2].strokes
      : []).toHaveLength(1);
  });

  it('selects multiple scene nodes and transforms them as one undoable command', () => {
    const shape = {
      id: 'shape-1', kind: 'shape' as const, name: 'Rectangle', visible: true, opacity: 1,
      transform: getEmojiLayer(INITIAL_EDITOR_STATE.design).transform, mask: [],
      shape: 'rectangle' as const, bounds: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      fill: '#ff00aa', stroke: null,
    };
    const added = editorReducer(INITIAL_EDITOR_STATE, { type: 'add-layer', layer: shape });
    const selected = editorReducer(added, { type: 'select-layer', layerId: 'emoji-1', toggle: true });
    expect(selected.selectedLayerIds).toEqual(['shape-1', 'emoji-1']);
    const moved = editorReducer(selected, { type: 'update-layer-transforms', historyGroup: 'group:move', updates:
      selected.design.layers.map((layer) => ({ layerId: layer.id, transform: { ...layer.transform, x: 0.1 } })) });
    expect(moved.design.layers.every((layer) => layer.transform.x === 0.1)).toBe(true);
  });

  it('duplicates a selection with an offset and undoes its next transformation', () => {
    const duplicated = editorReducer(INITIAL_EDITOR_STATE, { type: 'duplicate-layers',
      layerIds: ['emoji-1'], duplicateIds: ['emoji-2'], offset: 0.05 });
    expect(duplicated.design.layers[1]).toMatchObject({ id: 'emoji-2', transform: { x: 0.05, y: 0.05 } });
    expect(duplicated.selectedLayerIds).toEqual(['emoji-2']);
    const moved = editorReducer(duplicated, { type: 'update-layer-transform', layerId: 'emoji-2',
      transform: { ...duplicated.design.layers[1]!.transform, x: 0.2 } });
    const undone = editorReducer(moved, { type: 'undo' });
    expect(undone.design.layers[1]).toMatchObject({ id: 'emoji-2', transform: { x: 0.05, y: 0.05 } });
    expect(undone.future).toHaveLength(1);
  });

  it('rejects strokes beyond the per-stroke and per-collection capacities', () => {
    const overlong = editorReducer(INITIAL_EDITOR_STATE, {
      type: 'paint-stroke',
      layerId: 'paint-1',
      createLayerName: 'Paint',
      stroke: brushStroke('too-long', DESIGN_CAPACITY.pointsPerStroke + 1),
    });
    expect(overlong).toBe(INITIAL_EDITOR_STATE);

    const fullCollection = Array<BrushStroke>(DESIGN_CAPACITY.strokesPerCollection)
      .fill(brushStroke('existing', 1));
    const full = editorReducer(INITIAL_EDITOR_STATE, {
      type: 'add-layer',
      layer: strokeLayer('paint-1', fullCollection),
    });
    expect(full).not.toBe(INITIAL_EDITOR_STATE);
    expect(editorReducer(full, {
      type: 'paint-stroke',
      layerId: 'paint-1',
      stroke: brushStroke('overflow', 1),
    })).toBe(full);

    const emoji = getEmojiLayer(INITIAL_EDITOR_STATE.design);
    const fullMask = editorReducer(INITIAL_EDITOR_STATE, {
      type: 'load-design',
      design: {
        ...INITIAL_EDITOR_STATE.design,
        layers: [{
          ...emoji,
          mask: Array<MaskStroke>(DESIGN_CAPACITY.strokesPerCollection)
            .fill(maskStroke('existing-mask', 1)),
        }],
      },
    });
    expect(fullMask).not.toBe(INITIAL_EDITOR_STATE);
    expect(editorReducer(fullMask, {
      type: 'mask-stroke',
      layerId: emoji.id,
      stroke: maskStroke('mask-overflow', 1),
    })).toBe(fullMask);
  });

  it('accepts the final available scene point and rejects the next one', () => {
    const nearCapacity = [
      brushStroke('stroke-1', DESIGN_CAPACITY.pointsPerStroke),
      brushStroke('stroke-2', DESIGN_CAPACITY.pointsPerStroke),
      brushStroke('stroke-3', DESIGN_CAPACITY.pointsPerStroke),
      brushStroke('stroke-4', DESIGN_CAPACITY.pointsPerStroke),
      brushStroke('stroke-5', DESIGN_CAPACITY.pointsPerStroke - 1),
    ];
    const base = editorReducer(INITIAL_EDITOR_STATE, {
      type: 'add-layer',
      layer: strokeLayer('paint-1', nearCapacity),
    });
    const full = editorReducer(base, {
      type: 'paint-stroke',
      layerId: 'paint-1',
      stroke: brushStroke('final-point', 1),
    });
    expect(full).not.toBe(base);
    expect(decodeDesignDocument(full.design).ok).toBe(true);
    expect(editorReducer(full, {
      type: 'mask-stroke',
      layerId: 'paint-1',
      stroke: maskStroke('one-too-many', 1),
    })).toBe(full);
  });

  it('rejects capacity-breaking layer replacement, insertion, and duplication', () => {
    const largeLayer = strokeLayer('paint-1', [
      brushStroke('stroke-1', DESIGN_CAPACITY.pointsPerStroke),
      brushStroke('stroke-2', DESIGN_CAPACITY.pointsPerStroke),
      brushStroke('stroke-3', DESIGN_CAPACITY.pointsPerStroke),
    ]);
    const base = editorReducer(INITIAL_EDITOR_STATE, { type: 'add-layer', layer: largeLayer });
    expect(base).not.toBe(INITIAL_EDITOR_STATE);

    expect(editorReducer(base, {
      type: 'duplicate-layer',
      layerId: largeLayer.id,
      duplicateId: 'paint-2',
      name: 'Paint copy',
    })).toBe(base);

    const invalidLayer = strokeLayer('invalid', [
      brushStroke('too-long', DESIGN_CAPACITY.pointsPerStroke + 1),
    ]);
    const invalidDesign = {
      ...base.design,
      layers: [...base.design.layers, invalidLayer],
    };
    expect(editorReducer(base, { type: 'load-design', design: invalidDesign })).toBe(base);
    expect(editorReducer(base, { type: 'replace-design', design: invalidDesign })).toBe(base);
    expect(editorReducer(base, { type: 'add-layer', layer: invalidLayer })).toBe(base);
    expect(editorReducer(base, { type: 'insert-layers', layers: [invalidLayer] })).toBe(base);
    expect(editorReducer(base, {
      type: 'update-layer',
      layer: { ...invalidLayer, id: largeLayer.id },
    })).toBe(base);
  });

  it('accepts exactly 100 layers and rejects multi-layer duplication to 101', () => {
    const additions = Array.from(
      { length: DESIGN_CAPACITY.layers - 2 },
      (_, index) => strokeLayer(`paint-${index}`),
    );
    const oneSlotLeft = editorReducer(INITIAL_EDITOR_STATE, {
      type: 'insert-layers',
      layers: additions,
    });
    expect(oneSlotLeft.design.layers).toHaveLength(DESIGN_CAPACITY.layers - 1);

    const full = editorReducer(oneSlotLeft, {
      type: 'duplicate-layer',
      layerId: 'emoji-1',
      duplicateId: 'emoji-final',
      name: 'Emoji final',
    });
    expect(full.design.layers).toHaveLength(DESIGN_CAPACITY.layers);
    expect(decodeDesignDocument(full.design).ok).toBe(true);
    expect(editorReducer(full, {
      type: 'add-layer',
      layer: strokeLayer('layer-101'),
    })).toBe(full);

    expect(editorReducer(oneSlotLeft, {
      type: 'duplicate-layers',
      layerIds: ['emoji-1', 'paint-0'],
      duplicateIds: ['emoji-copy', 'paint-copy'],
    })).toBe(oneSlotLeft);
  });
});
