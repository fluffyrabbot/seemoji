import { describe, expect, it } from 'vitest';
import { getEmojiLayer } from '../domain/design';
import { createEmojiAssetRef } from '../domain/emoji';
import { editorReducer, INITIAL_EDITOR_STATE } from './editor';

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

  it('duplicates a selection with an offset and restores an earlier history point', () => {
    const duplicated = editorReducer(INITIAL_EDITOR_STATE, { type: 'duplicate-layers',
      layerIds: ['emoji-1'], duplicateIds: ['emoji-2'], offset: 0.05 });
    expect(duplicated.design.layers[1]).toMatchObject({ id: 'emoji-2', transform: { x: 0.05, y: 0.05 } });
    expect(duplicated.selectedLayerIds).toEqual(['emoji-2']);
    const moved = editorReducer(duplicated, { type: 'update-layer-transform', layerId: 'emoji-2',
      transform: { ...duplicated.design.layers[1]!.transform, x: 0.2 } });
    const restored = editorReducer(moved, { type: 'restore-history', index: 0 });
    expect(restored.design.layers).toHaveLength(1);
    expect(restored.future).toHaveLength(2);
  });
});
