import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN, DEFAULT_EMOJI_LAYER } from './design';
import { copySelectionGroups, expandGroupSelection, pruneSelectionGroups, selectionGroupError } from './selectionGroups';

const layers = ['a', 'b', 'c'].map((id) => ({ ...DEFAULT_EMOJI_LAYER, id }));
const groups = [{ id: 'group-1', name: 'Badge', layerIds: ['a', 'b'] }];

describe('persistent selection groups', () => {
  it('expands existing group members and removes duplicate or absent selection ids', () => {
    expect(expandGroupSelection({ ...DEFAULT_DESIGN, layers, groups }, ['b', 'a', 'missing', 'c']))
      .toEqual(['a', 'b', 'c']);
    expect(expandGroupSelection({ ...DEFAULT_DESIGN, layers, groups }, [])).toEqual([]);
  });

  it('expands other groups while treating members of the edited group individually', () => {
    const scene = { ...DEFAULT_DESIGN,
      layers: [...layers, { ...DEFAULT_EMOJI_LAYER, id: 'd' }],
      groups: [...groups, { id: 'group-2', name: 'Caption', layerIds: ['c', 'd'] }] };
    expect(expandGroupSelection(scene, ['b'], 'group-1')).toEqual(['b']);
    expect(expandGroupSelection(scene, ['b', 'c'], 'group-1')).toEqual(['b', 'c', 'd']);
    expect(expandGroupSelection(scene, ['b'], null)).toEqual(['a', 'b']);
  });

  it('copies complete groups with fresh identities and remapped member ids', () => {
    const copied = copySelectionGroups(groups, new Map([['a', 'new-a'], ['b', 'new-b']]),
      new Map([['group-1', 'new-group']]));
    expect(copied).toEqual([{ id: 'new-group', name: 'Badge copy', layerIds: ['new-a', 'new-b'] }]);
    expect(copySelectionGroups(groups, new Map([['a', 'new-a']]), new Map([['group-1', 'new-group']]))).toEqual([]);
    expect(groups[0]!.layerIds).toEqual(['a', 'b']);
  });

  it('dissolves single-member groups when layers are removed', () => {
    expect(pruneSelectionGroups(groups, new Set(['b', 'c']))).toEqual([]);
    expect(pruneSelectionGroups(groups, new Set(['a', 'b']))[0]).toBe(groups[0]);
  });

  it('rejects group/layer identity collisions and overlapping membership', () => {
    expect(selectionGroupError(groups, layers)).toBeNull();
    expect(selectionGroupError([{ ...groups[0]!, id: 'a' }], layers)).not.toBeNull();
    expect(selectionGroupError([{ ...groups[0]!, layerIds: ['a', 'a'] }], layers)).not.toBeNull();
  });
});
