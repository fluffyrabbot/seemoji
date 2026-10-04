import { DESIGN_LIMITS, type DesignDocument, type SceneLayer, type SelectionGroup } from './design';
import { hasDesignCapacity } from './designCapacity';
import { layerWorldBounds, unionWorldBounds } from './sceneGeometry';
import { copySelectionGroups, selectionGroupError } from './selectionGroups';
import { translateSelection, type LayerTransformUpdate } from './selectionTransforms';

export interface SelectionFragment {
  readonly layers: readonly SceneLayer[];
  readonly groups: readonly SelectionGroup[];
}
export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type Distribution = 'horizontal' | 'vertical';
export type SelectionResult<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export function captureSelection(design: DesignDocument, ids: readonly string[]): SelectionFragment {
  const selected = new Set(ids);
  return {
    layers: design.layers.filter((layer) => selected.has(layer.id)),
    groups: design.groups.filter((group) => group.layerIds.every((id) => selected.has(id))),
  };
}

/** Clone a scene fragment as a graph: internal references follow copies, external ones remain. */
export function cloneSelection(
  source: SelectionFragment,
  layerIds: ReadonlyMap<string, string>,
  groupIds: ReadonlyMap<string, string>,
  offset = 0.035,
): SelectionResult<SelectionFragment> {
  const ids = [...layerIds.values(), ...groupIds.values()];
  if (!source.layers.length || !Number.isFinite(offset)
      || layerIds.size !== source.layers.length || groupIds.size !== source.groups.length
      || source.layers.some((layer) => !layerIds.has(layer.id))
      || source.groups.some((group) => !groupIds.has(group.id))
      || ids.some((id) => !id.trim() || id.length > 100)
      || new Set(ids).size !== ids.length) {
    return { ok: false, error: 'The copied selection has invalid identities.' };
  }
  const transforms = new Map(translateSelection(source.layers, { x: offset, y: offset })
    .map(({ layerId, transform }) => [layerId, transform]));
  const layers = source.layers.map((layer): SceneLayer => ({
    ...layer, id: layerIds.get(layer.id)!, name: `${layer.name} copy`.slice(0, 80),
    transform: transforms.get(layer.id)!,
    ...(layer.kind === 'text' && layer.bubble?.speakerId ? { bubble: {
      ...layer.bubble, speakerId: layerIds.get(layer.bubble.speakerId) ?? layer.bubble.speakerId,
    } } : {}),
  }));
  const groups = copySelectionGroups(source.groups, layerIds, groupIds);
  const error = selectionGroupError(groups, layers);
  return error ? { ok: false, error } : { ok: true, value: { layers, groups } };
}

export function insertSelection(design: DesignDocument, fragment: SelectionFragment): SelectionResult<DesignDocument> {
  const ids = [...design.layers, ...design.groups, ...fragment.layers, ...fragment.groups].map(({ id }) => id);
  const next = { ...design, layers: [...design.layers, ...fragment.layers], groups: [...design.groups, ...fragment.groups] };
  const inserted = new Set(fragment.layers.map(({ id }) => id));
  if (!fragment.layers.length || ids.some((id) => !id.trim() || id.length > 100)
      || new Set(ids).size !== ids.length
      || fragment.groups.some((group) => group.layerIds.some((id) => !inserted.has(id)))) {
    return { ok: false, error: 'The copied selection has conflicting identities.' };
  }
  const error = selectionGroupError(next.groups, next.layers);
  if (error) return { ok: false, error };
  return hasDesignCapacity(next) ? { ok: true, value: next }
    : { ok: false, error: 'The copied selection exceeds the document capacity.' };
}

/** Reject an infeasible layout as a whole instead of silently distorting its alignment. */
function validateLayout(updates: readonly LayerTransformUpdate[]): SelectionResult<readonly LayerTransformUpdate[]> {
  return updates.some(({ transform }) => (['x', 'y'] as const).some((axis) =>
    !Number.isFinite(transform[axis]) || transform[axis] < DESIGN_LIMITS[axis][0] - 1e-10
      || transform[axis] > DESIGN_LIMITS[axis][1] + 1e-10))
    ? { ok: false, error: 'This layout would move an object beyond the editable position limits.' }
    : { ok: true, value: updates.map(({ layerId, transform }) => ({ layerId, transform: {
      ...transform, x: Math.max(-0.5, Math.min(0.5, transform.x)), y: Math.max(-0.5, Math.min(0.5, transform.y)),
    } })) };
}

export function alignSelection(layers: readonly SceneLayer[], mode: Alignment): SelectionResult<readonly LayerTransformUpdate[]> {
  const union = unionWorldBounds(layers);
  if (!union || layers.length < 2) return { ok: false, error: 'Select at least two objects to align.' };
  return validateLayout(layers.map((layer) => {
    const bounds = layerWorldBounds(layer);
    const dx = mode === 'left' ? union.left - bounds.left
      : mode === 'center' ? (union.left + union.right - bounds.left - bounds.right) / 2
        : mode === 'right' ? union.right - bounds.right : 0;
    const dy = mode === 'top' ? union.top - bounds.top
      : mode === 'middle' ? (union.top + union.bottom - bounds.top - bounds.bottom) / 2
        : mode === 'bottom' ? union.bottom - bounds.bottom : 0;
    return { layerId: layer.id, transform: { ...layer.transform, x: layer.transform.x + dx, y: layer.transform.y + dy } };
  }));
}

export function distributeSelection(layers: readonly SceneLayer[], axis: Distribution): SelectionResult<readonly LayerTransformUpdate[]> {
  if (layers.length < 3) return { ok: false, error: 'Select at least three objects to distribute.' };
  const coordinate = axis === 'horizontal' ? 'x' : 'y';
  const measured = layers.map((layer) => {
    const bounds = layerWorldBounds(layer);
    return { layer, center: axis === 'horizontal' ? (bounds.left + bounds.right) / 2 : (bounds.top + bounds.bottom) / 2 };
  }).sort((a, b) => a.center - b.center);
  const first = measured[0]!.center;
  const step = (measured.at(-1)!.center - first) / (measured.length - 1);
  return validateLayout(measured.map(({ layer, center }, index) => ({ layerId: layer.id,
    transform: { ...layer.transform, [coordinate]: layer.transform[coordinate] + first + step * index - center },
  })));
}
