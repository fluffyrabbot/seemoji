import type { DesignDocument, SceneLayer, SelectionGroup } from './design';

/** Shared by the decoder and editor: one layer belongs to at most one group. */
export function selectionGroupError(
  groups: readonly SelectionGroup[],
  layers: readonly SceneLayer[],
): string | null {
  if (groups.length > Math.floor(layers.length / 2)) return 'groups exceed available layer membership';
  const layerIds = new Set(layers.map((layer) => layer.id));
  const groupIds = new Set<string>();
  const members = new Set<string>();
  for (const group of groups) {
    if (!group.id.trim() || group.id.length > 100 || layerIds.has(group.id) || groupIds.has(group.id)) {
      return 'group id must be unique, non-empty, and distinct from layer ids';
    }
    if (!group.name.trim() || group.name !== group.name.trim() || group.name.length > 80) {
      return 'group name must contain 1 to 80 characters without surrounding whitespace';
    }
    if (group.layerIds.length < 2) return 'a group must contain at least two layers';
    groupIds.add(group.id);
    for (const id of group.layerIds) {
      if (!layerIds.has(id)) return 'group members must reference existing layers';
      if (members.has(id)) return 'group membership must be unique and non-overlapping';
      members.add(id);
    }
  }
  return null;
}

export function expandGroupSelection(
  design: DesignDocument,
  ids: readonly string[],
  editingGroupId: string | null = null,
): readonly string[] {
  const existing = new Set(design.layers.map((layer) => layer.id));
  const membership = new Map(design.groups.filter((group) => group.id !== editingGroupId)
    .flatMap((group) => group.layerIds.map((id) => [id, group.layerIds] as const)));
  return [...new Set(ids.filter((id) => existing.has(id)).flatMap((id) => membership.get(id) ?? [id]))];
}

/** Delete missing members; a group with fewer than two members dissolves. */
export function pruneSelectionGroups(
  groups: readonly SelectionGroup[],
  retainedIds: ReadonlySet<string>,
): readonly SelectionGroup[] {
  return groups.flatMap((group) => {
    const layerIds = group.layerIds.filter((id) => retainedIds.has(id));
    return layerIds.length < 2 ? [] : [layerIds.length === group.layerIds.length ? group : { ...group, layerIds }];
  });
}

/** A copied subset only carries groups whose complete membership is included. */
export function copySelectionGroups(
  groups: readonly SelectionGroup[],
  layerIdMap: ReadonlyMap<string, string>,
  groupIdMap: ReadonlyMap<string, string>,
): readonly SelectionGroup[] {
  return groups.flatMap((group) => {
    const id = groupIdMap.get(group.id);
    if (!id || !group.layerIds.every((member) => layerIdMap.has(member))) return [];
    return [{ id, name: `${group.name} copy`.slice(0, 80),
      layerIds: group.layerIds.map((member) => layerIdMap.get(member)!) }];
  });
}
