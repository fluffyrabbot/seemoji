import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN, DEFAULT_EMOJI_LAYER, DEFAULT_TRANSFORM, type TextLayer } from './design';
import { alignSelection, captureSelection, cloneSelection, distributeSelection } from './selectionCommands';
import { decodeDesignDocument } from './designCodec';
import { editorReducer, INITIAL_EDITOR_STATE } from '../application/editor';
import { layerWorldBounds } from './sceneGeometry';

const speaker = DEFAULT_EMOJI_LAYER;
const text: TextLayer = { id: 'bubble', kind: 'text', name: 'Speech', visible: true, opacity: 1,
  mask: [], transform: DEFAULT_TRANSFORM, bounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
  text: 'Hi', fontSize: 0.1, fontFamily: 'sans-serif', align: 'center', color: '#000000',
  bubble: { kind: 'speech', speakerId: speaker.id, speakerAnchor: { x: 0.5, y: 0.6 }, tail: { x: 0.5, y: 0.6 } } };
const design = { ...DEFAULT_DESIGN, layers: [speaker, text], groups: [{ id: 'group', name: 'Pair', layerIds: [speaker.id, text.id] }] };

describe('selection graph commands', () => {
  it('paste and duplicate preserve the same attachment graph, groups, history and codec invariants', () => {
    const source = captureSelection(design, [text.id, speaker.id]);
    const copied = cloneSelection(source, new Map([[speaker.id, 'copy-speaker'], [text.id, 'copy-text']]), new Map([['group', 'copy-group']]));
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    const initial = { ...INITIAL_EDITOR_STATE, design };
    const pasted = editorReducer(initial, { type: 'insert-layers', ...copied.value });
    const duplicated = editorReducer(initial, { type: 'duplicate-layers', layerIds: [text.id, speaker.id],
      duplicateIds: ['copy-text', 'copy-speaker'], duplicateGroupIds: ['copy-group'] });
    expect(pasted.design).toEqual(duplicated.design);
    expect((pasted.design.layers.at(-1) as TextLayer).bubble?.speakerId).toBe('copy-speaker');
    expect(pasted.design.groups.at(-1)?.layerIds).toEqual(['copy-speaker', 'copy-text']);
    expect(decodeDesignDocument(pasted.design).ok).toBe(true);
    expect(pasted.past).toHaveLength(1);
    expect(editorReducer(pasted, { type: 'undo' }).design).toEqual(design);
    expect(editorReducer(editorReducer(pasted, { type: 'undo' }), { type: 'redo' }).design).toEqual(pasted.design);
  });
  it('retains external attachments and detaches them when pasting into a different scene', () => {
    const copied = cloneSelection(captureSelection(design, [text.id]), new Map([[text.id, 'copy']]), new Map());
    if (!copied.ok) throw new Error(copied.error);
    expect((copied.value.layers[0] as TextLayer).bubble?.speakerId).toBe(speaker.id);
    const pasted = editorReducer({ ...INITIAL_EDITOR_STATE, design: { ...DEFAULT_DESIGN, layers: [{ ...speaker, id: 'other' }] } },
      { type: 'insert-layers', ...copied.value });
    expect((pasted.design.layers.at(-1) as TextLayer).bubble?.speakerId).toBeUndefined();
    expect(decodeDesignDocument(pasted.design).ok).toBe(true);
  });
  it('rejects duplicate identities without mutating the document', () => {
    expect(cloneSelection(captureSelection(design, [text.id, speaker.id]),
      new Map([[text.id, 'same'], [speaker.id, 'same']]), new Map([['group', 'g']])).ok).toBe(false);
    const initial = { ...INITIAL_EDITOR_STATE, design };
    expect(editorReducer(initial, { type: 'insert-layers', layers: [speaker], groups: [] })).toBe(initial);
  });
  it('aligns transformed bounds and produces evenly spaced centers within persistable limits', () => {
    const layers = [-0.3, -0.1, 0.3].map((x, index) => ({ ...speaker, id: `e${index}`,
      transform: { ...speaker.transform, x, y: x / 2, rotate: index * 25, scaleX: 0.4, scaleY: 0.4 } }));
    for (const result of [alignSelection(layers, 'top'), distributeSelection(layers, 'horizontal')]) {
      if (!result.ok) throw new Error(result.error);
      const updated = layers.map((layer) => ({ ...layer, transform: result.value.find((item) => item.layerId === layer.id)!.transform }));
      expect(decodeDesignDocument({ ...DEFAULT_DESIGN, layers: updated }).ok).toBe(true);
    }
    const aligned = alignSelection(layers, 'top');
    if (!aligned.ok) throw new Error(aligned.error);
    const tops = layers.map((layer, index) => layerWorldBounds({ ...layer, transform: aligned.value[index]!.transform }).top);
    expect(tops[0]).toBeCloseTo(tops[1]!); expect(tops[1]).toBeCloseTo(tops[2]!);
    const distributed = distributeSelection(layers, 'horizontal');
    if (!distributed.ok) throw new Error(distributed.error);
    const xs = distributed.value.map(({ transform }) => transform.x);
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!);
  });
  it('rejects alignment that would violate position limits', () => {
    const layers = [{ ...speaker, transform: { ...speaker.transform, x: -0.5, scaleX: 3 } },
      { ...speaker, id: 'small', transform: { ...speaker.transform, scaleX: 0.25 } }];
    expect(alignSelection(layers, 'left').ok).toBe(false);
  });
});
