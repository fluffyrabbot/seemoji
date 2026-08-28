import { describe, expect, it } from 'vitest';
import { createEmojiAssetRef } from '../domain/emoji';
import { editorReducer, INITIAL_EDITOR_STATE } from './editor';

describe('editor reducer', () => {
  it('updates edits without changing source identity', () => {
    const state = editorReducer(INITIAL_EDITOR_STATE, {
      type: 'update-transform',
      transform: { ...INITIAL_EDITOR_STATE.design.transform, rotate: 20 },
    });
    expect(state.design.transform.rotate).toBe(20);
    expect(state.design.source).toBe(INITIAL_EDITOR_STATE.design.source);
  });

  it('reset preserves the selected artwork', () => {
    const selected = editorReducer(INITIAL_EDITOR_STATE, {
      type: 'set-source',
      source: createEmojiAssetRef('👍'),
    });
    const edited = editorReducer(selected, {
      type: 'update-transform',
      transform: { ...selected.design.transform, rotate: 45 },
    });
    const reset = editorReducer(edited, { type: 'reset' });
    expect(reset.design.source.grapheme).toBe('👍');
    expect(reset.design.transform.rotate).toBe(0);
  });
});
