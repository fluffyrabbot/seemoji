import { describe, it, expect } from 'vitest';
import { DEFAULT_DESIGN, DEFAULT_TRANSFORM, type TextLayer } from '../domain/design';
import { detachBubble, resolveBubbleAttachments } from '../domain/bubbleAttachment';
import { decodeDesignDocument } from '../domain/designCodec';
import { editorReducer, INITIAL_EDITOR_STATE } from './editor';

const speaker = DEFAULT_DESIGN.layers[0]!;
const text: TextLayer = { id: 'text', kind: 'text', name: 'Text', visible: true, opacity: 1, mask: [],
  transform: DEFAULT_TRANSFORM, bounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 }, text: 'Hi',
  fontSize: 0.1, fontFamily: 'sans-serif', align: 'center', color: '#000000',
  bubble: { kind: 'speech', speakerId: speaker.id, tail: { x: 0.5, y: 0.6 } } };
const design = resolveBubbleAttachments({ ...DEFAULT_DESIGN, layers: [speaker, text] });
const initial = { ...INITIAL_EDITOR_STATE, design };
const bubble = (state: typeof initial, id = text.id) => (state.design.layers.find((layer) => layer.id === id) as TextLayer).bubble!;

describe('bubble speaker attachment transactions', () => {
  it('follows a speaker and undoes both movement and tail together', () => {
    const moved = editorReducer(initial, { type: 'update-layer-transform', layerId: speaker.id,
      transform: { ...speaker.transform, x: 0.2, rotate: 35 } });
    expect(bubble(moved).tail).not.toEqual(bubble(initial).tail);
    expect(moved.past).toHaveLength(1);
    expect(editorReducer(moved, { type: 'undo' }).design).toEqual(design);
    expect(decodeDesignDocument(moved.design)).toEqual({ ok: true, value: moved.design });
  });
  it('detaches on deletion without moving the last tail and restores attachment on undo', () => {
    const withExtra = { ...initial, design: { ...design, layers: [...design.layers, { ...speaker, id: 'extra' }] } };
    const deleted = editorReducer(withExtra, { type: 'remove-layer', layerId: speaker.id });
    expect(bubble(deleted).speakerId).toBeUndefined();
    expect(bubble(deleted).tail).toEqual(bubble(initial).tail);
    expect(bubble(editorReducer(deleted, { type: 'undo' })).speakerId).toBe(speaker.id);
  });
  it('remaps copied speaker pairs and keeps a bubble-only copy attached to the original', () => {
    const copied = editorReducer(initial, { type: 'duplicate-layers', layerIds: [speaker.id, text.id],
      duplicateIds: ['speaker-copy', 'bubble-copy'], duplicateGroupIds: [] });
    expect(bubble(copied, 'bubble-copy').speakerId).toBe('speaker-copy');
    const single = editorReducer(initial, { type: 'duplicate-layer', layerId: text.id, duplicateId: 'text-copy', name: 'Copy' });
    expect(bubble(single, 'text-copy').speakerId).toBe(speaker.id);
  });
  it('keeps a manually detached tail fixed and rejects invalid imported references', () => {
    const detached = detachBubble(design.layers[1] as TextLayer);
    const resolved = resolveBubbleAttachments({ ...design, layers: [{ ...speaker, transform: { ...speaker.transform, x: 0.3 } }, detached] });
    expect((resolved.layers[1] as TextLayer).bubble).toEqual(detached.bubble);
    expect(decodeDesignDocument({ ...design, layers: [speaker, { ...text, bubble: { ...text.bubble, speakerId: text.id } }] }).ok).toBe(false);
    expect(decodeDesignDocument({ ...design, version: 5, layers: [speaker, detached] })).toEqual({ ok: true, value: { ...design, layers: [speaker, detached] } });
  });
});
