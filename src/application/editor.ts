import {
  DEFAULT_DESIGN,
  DEFAULT_APPEARANCE,
  DEFAULT_TRANSFORM,
  PRIMARY_EMOJI_LAYER_ID,
  getLayer,
  replaceLayer,
  type Appearance,
  type BrushStroke,
  type DesignDocument,
  type MaskStroke,
  type SceneLayer,
  type SelectionGroup,
  type StrokeLayer,
  type Transform,
} from '../domain/design';
import { DESIGN_CAPACITY, hasDesignCapacity } from '../domain/designCapacity';
import type { EmojiAssetRef } from '../domain/emoji';
import { copySelectionGroups, expandGroupSelection, pruneSelectionGroups, selectionGroupError } from '../domain/selectionGroups';
import { translateSelection } from '../domain/selectionTransforms';

export const EXPORT_SIZES = [48, 128, 256] as const;
export type ExportSize = (typeof EXPORT_SIZES)[number];

const MAX_HISTORY = 100;

export interface EditorState {
  readonly design: DesignDocument;
  readonly exportSize: ExportSize;
  readonly past: readonly DesignDocument[];
  readonly future: readonly DesignDocument[];
  readonly historyGroup: string | null;
  readonly selectedLayerIds: readonly string[];
  /** Transient member-selection scope; never serialized with the design. */
  readonly editingGroupId: string | null;
}

type GroupedAction = { readonly historyGroup?: string };

export type EditorAction =
  | { readonly type: 'load-design'; readonly design: DesignDocument }
  | ({ readonly type: 'replace-design'; readonly design: DesignDocument } & GroupedAction)
  | ({
      readonly type: 'set-emoji-source';
      readonly layerId: string;
      readonly source: EmojiAssetRef;
    } & GroupedAction)
  | ({ readonly type: 'update-layer-transform'; readonly layerId: string; readonly transform: Transform } & GroupedAction)
  | ({ readonly type: 'update-layer-transforms'; readonly updates: readonly { readonly layerId: string; readonly transform: Transform }[] } & GroupedAction)
  | ({ readonly type: 'update-appearance'; readonly layerId: string; readonly appearance: Appearance } & GroupedAction)
  | ({
      readonly type: 'apply-layer-style';
      readonly layerId: string;
      readonly transform: Transform;
      readonly appearance: Appearance;
    } & GroupedAction)
  | {
      readonly type: 'paint-stroke';
      readonly layerId: string;
      readonly stroke: BrushStroke;
      readonly createLayerName?: string;
    }
  | { readonly type: 'mask-stroke'; readonly layerId: string; readonly stroke: MaskStroke }
  | { readonly type: 'add-stroke-layer'; readonly layerId: string; readonly name: string }
  | { readonly type: 'add-layer'; readonly layer: SceneLayer }
  | { readonly type: 'insert-layers'; readonly layers: readonly SceneLayer[]; readonly groups: readonly SelectionGroup[] }
  | ({ readonly type: 'update-layer'; readonly layer: SceneLayer } & GroupedAction)
  | { readonly type: 'rename-layer'; readonly layerId: string; readonly name: string }
  | ({ readonly type: 'set-layer-opacity'; readonly layerId: string; readonly opacity: number } & GroupedAction)
  | { readonly type: 'duplicate-layer'; readonly layerId: string; readonly duplicateId: string; readonly name: string }
  | { readonly type: 'duplicate-layers'; readonly layerIds: readonly string[]; readonly duplicateIds: readonly string[]; readonly duplicateGroupIds: readonly string[]; readonly offset?: number }
  | { readonly type: 'create-group'; readonly groupId: string; readonly name: string; readonly layerIds: readonly string[] }
  | { readonly type: 'rename-group'; readonly groupId: string; readonly name: string }
  | { readonly type: 'remove-groups'; readonly groupIds: readonly string[] }
  | { readonly type: 'select-group'; readonly groupId: string }
  | { readonly type: 'begin-group-edit'; readonly groupId: string; readonly layerId?: string }
  | { readonly type: 'finish-group-edit' }
  | { readonly type: 'select-layer'; readonly layerId: string; readonly toggle?: boolean }
  | { readonly type: 'select-layers'; readonly layerIds: readonly string[] }
  | { readonly type: 'toggle-layer'; readonly layerId: string }
  | { readonly type: 'remove-layer'; readonly layerId: string }
  | { readonly type: 'remove-layers'; readonly layerIds: readonly string[] }
  | { readonly type: 'move-layer'; readonly layerId: string; readonly direction: 'forward' | 'backward' }
  | { readonly type: 'commit-history-group' }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'set-size'; readonly size: ExportSize }
  | { readonly type: 'reset-layers'; readonly layerIds: readonly string[] };

export const INITIAL_EDITOR_STATE: EditorState = {
  design: DEFAULT_DESIGN,
  exportSize: 128,
  past: [],
  future: [],
  historyGroup: null,
  selectedLayerIds: [PRIMARY_EMOJI_LAYER_ID],
  editingGroupId: null,
};

const validSelection = (design: DesignDocument, ids: readonly string[], editingGroupId: string | null = null): readonly string[] => {
  return expandGroupSelection(design, ids, editingGroupId);
};

function normalizeSelection(
  design: DesignDocument,
  ids: readonly string[],
  editingGroupId: string | null,
): Pick<EditorState, 'selectedLayerIds' | 'editingGroupId'> {
  const group = design.groups.find((candidate) => candidate.id === editingGroupId);
  const selectedLayerIds = validSelection(design, ids, group?.id ?? null);
  // An explicit outside selection exits member mode; empty selection stays inside.
  return group && selectedLayerIds.every((id) => group.layerIds.includes(id))
    ? { selectedLayerIds, editingGroupId: group.id }
    : { selectedLayerIds: validSelection(design, ids), editingGroupId: null };
}

const reservedId = (design: DesignDocument, id: string): boolean =>
  !!getLayer(design, id) || design.groups.some((group) => group.id === id);

function recordDesign(
  state: EditorState,
  design: DesignDocument,
  historyGroup?: string,
): EditorState {
  if (design === state.design || selectionGroupError(design.groups, design.layers)) return state;
  if (historyGroup && state.historyGroup === historyGroup) {
    return {
      ...state,
      design,
      future: [],
      ...normalizeSelection(design, state.selectedLayerIds, state.editingGroupId),
    };
  }
  return {
    ...state,
    design,
    past: [...state.past, state.design].slice(-MAX_HISTORY),
    future: [],
    historyGroup: historyGroup ?? null,
    ...normalizeSelection(design, state.selectedLayerIds, state.editingGroupId),
  };
}

function recordCapacityChangingDesign(
  state: EditorState,
  design: DesignDocument,
  historyGroup?: string,
): EditorState {
  return hasDesignCapacity(design) ? recordDesign(state, design, historyGroup) : state;
}

function preservesOrReducesStrokeData(current: SceneLayer, replacement: SceneLayer): boolean {
  if (current.mask !== replacement.mask) return false;
  if (replacement.kind !== 'strokes') return true;
  return current.kind === 'strokes' && current.strokes === replacement.strokes;
}

export const canUndo = (state: EditorState): boolean => state.past.length > 0;
export const canRedo = (state: EditorState): boolean => state.future.length > 0;

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'load-design':
      return hasDesignCapacity(action.design) && !selectionGroupError(action.design.groups, action.design.layers)
        ? { ...state, design: action.design, past: [], future: [], historyGroup: null,
            selectedLayerIds: validSelection(action.design, [action.design.layers.at(-1)!.id]), editingGroupId: null }
        : state;
    case 'replace-design':
      return recordCapacityChangingDesign(state, action.design, action.historyGroup);
    case 'set-emoji-source': {
      const layer = getLayer(state.design, action.layerId);
      return layer?.kind === 'emoji'
        ? recordDesign(
            state,
            replaceLayer(state.design, { ...layer, source: action.source }),
            action.historyGroup,
          )
        : state;
    }
    case 'update-layer-transform': {
      const layer = getLayer(state.design, action.layerId);
      return layer
        ? recordDesign(
            state,
            replaceLayer(state.design, { ...layer, transform: action.transform }),
            action.historyGroup,
          )
        : state;
    }
    case 'update-layer-transforms': {
      const updates = new Map(action.updates.map((update) => [update.layerId, update.transform]));
      if (updates.size === 0) return state;
      const layers = state.design.layers.map((layer) => {
        const transform = updates.get(layer.id);
        return transform ? { ...layer, transform } : layer;
      });
      return recordDesign(state, { ...state.design, layers }, action.historyGroup);
    }
    case 'update-appearance': {
      const layer = getLayer(state.design, action.layerId);
      return layer?.kind === 'emoji'
        ? recordDesign(state, replaceLayer(state.design, { ...layer, appearance: action.appearance }), action.historyGroup)
        : state;
    }
    case 'apply-layer-style': {
      const layer = getLayer(state.design, action.layerId);
      return layer?.kind === 'emoji'
        ? recordDesign(state, replaceLayer(state.design, {
            ...layer, transform: action.transform, appearance: action.appearance,
          }), action.historyGroup)
        : state;
    }
    case 'paint-stroke': {
      const existing = getLayer(state.design, action.layerId);
      if (existing?.kind === 'strokes') {
        return recordCapacityChangingDesign(
          state,
          replaceLayer(state.design, {
            ...existing,
            visible: true,
            strokes: [...existing.strokes, action.stroke],
          }),
        );
      }
      if (existing || reservedId(state.design, action.layerId) || !action.createLayerName
          || state.design.layers.length >= DESIGN_CAPACITY.layers) return state;
      const layer: StrokeLayer = {
        id: action.layerId,
        kind: 'strokes',
        name: action.createLayerName,
        visible: true,
        opacity: 1,
        transform: DEFAULT_TRANSFORM,
        strokes: [action.stroke],
        mask: [],
      };
      const design = { ...state.design, layers: [...state.design.layers, layer] };
      if (!hasDesignCapacity(design)) return state;
      return {
        ...recordDesign(state, design),
        selectedLayerIds: [layer.id],
        editingGroupId: null,
      };
    }
    case 'mask-stroke': {
      const layer = getLayer(state.design, action.layerId);
      if (!layer) return state;
      return recordCapacityChangingDesign(
        state,
        replaceLayer(state.design, { ...layer, mask: [...layer.mask, action.stroke] }),
      );
    }
    case 'add-stroke-layer': {
      if (reservedId(state.design, action.layerId)
          || state.design.layers.length >= DESIGN_CAPACITY.layers) return state;
      const layer: StrokeLayer = {
        id: action.layerId,
        kind: 'strokes',
        name: action.name,
        visible: true,
        opacity: 1,
        transform: DEFAULT_TRANSFORM,
        strokes: [],
        mask: [],
      };
      return {
        ...recordDesign(state, { ...state.design, layers: [...state.design.layers, layer] }),
        selectedLayerIds: [layer.id],
        editingGroupId: null,
      };
    }
    case 'add-layer': {
      if (reservedId(state.design, action.layer.id)
          || state.design.layers.length >= DESIGN_CAPACITY.layers) return state;
      const design = { ...state.design, layers: [...state.design.layers, action.layer] };
      if (!hasDesignCapacity(design)) return state;
      return {
        ...recordDesign(state, design),
        selectedLayerIds: [action.layer.id],
        editingGroupId: null,
      };
    }
    case 'insert-layers': {
      if (action.layers.length === 0
          || state.design.layers.length + action.layers.length > DESIGN_CAPACITY.layers) return state;
      const insertedIds = new Set(action.layers.map((layer) => layer.id));
      if (insertedIds.size !== action.layers.length
          || action.layers.some((layer) => !layer.id || reservedId(state.design, layer.id))
          || action.groups.some((group) => group.layerIds.some((id) => !insertedIds.has(id)))) return state;
      const design = { ...state.design, layers: [...state.design.layers, ...action.layers],
        groups: [...state.design.groups, ...action.groups] };
      if (!hasDesignCapacity(design) || selectionGroupError(design.groups, design.layers)) return state;
      return { ...recordDesign(state, design), selectedLayerIds: action.layers.map((layer) => layer.id), editingGroupId: null };
    }
    case 'update-layer': {
      const current = getLayer(state.design, action.layer.id);
      if (!current) return state;
      const design = replaceLayer(state.design, action.layer);
      return preservesOrReducesStrokeData(current, action.layer)
        ? recordDesign(state, design, action.historyGroup)
        : recordCapacityChangingDesign(state, design, action.historyGroup);
    }
    case 'rename-layer': {
      const layer = getLayer(state.design, action.layerId);
      const name = action.name.trim();
      if (!layer || !name || name.length > 80 || name === layer.name) return state;
      return recordDesign(state, replaceLayer(state.design, { ...layer, name }));
    }
    case 'set-layer-opacity': {
      const layer = getLayer(state.design, action.layerId);
      if (!layer || !Number.isFinite(action.opacity)) return state;
      const opacity = Math.min(1, Math.max(0, action.opacity));
      return recordDesign(
        state,
        replaceLayer(state.design, { ...layer, opacity }),
        action.historyGroup,
      );
    }
    case 'duplicate-layer': {
      const layer = getLayer(state.design, action.layerId);
      if (!layer || reservedId(state.design, action.duplicateId)
          || state.design.layers.length >= DESIGN_CAPACITY.layers) {
        return state;
      }
      const index = state.design.layers.findIndex((candidate) => candidate.id === layer.id);
      const duplicate = { ...layer, id: action.duplicateId, name: action.name };
      const layers = [...state.design.layers];
      layers.splice(index + 1, 0, duplicate);
      const design = { ...state.design, layers };
      if (!hasDesignCapacity(design)) return state;
      return {
        ...recordDesign(state, design),
        selectedLayerIds: [duplicate.id],
        editingGroupId: null,
      };
    }
    case 'duplicate-layers': {
      if (action.layerIds.length !== action.duplicateIds.length
          || new Set(action.layerIds).size !== action.layerIds.length
          || new Set(action.duplicateIds).size !== action.duplicateIds.length
          || state.design.layers.length + action.layerIds.length > DESIGN_CAPACITY.layers) return state;
      const copyingGroups = state.design.groups.filter((group) => group.layerIds.every((id) => action.layerIds.includes(id)));
      if (copyingGroups.length !== action.duplicateGroupIds.length) return state;
      const offset = action.offset ?? 0.035;
      if (!Number.isFinite(offset) || action.layerIds.length === 0
          || action.duplicateIds.some((id) => !id || reservedId(state.design, id))) return state;
      const idMap = new Map(action.layerIds.map((id, index) => [id, action.duplicateIds[index]!]));
      const originals = state.design.layers.filter((layer) => idMap.has(layer.id));
      if (originals.length !== action.layerIds.length) return state;
      const transforms = new Map(translateSelection(originals, { x: offset, y: offset })
        .map(({ layerId, transform }) => [layerId, transform]));
      const next = originals.map((layer) => ({ ...layer, id: idMap.get(layer.id)!,
        name: `${layer.name} copy`.slice(0, 80), transform: transforms.get(layer.id)! }));
      const copiedGroups = copySelectionGroups(copyingGroups,
        idMap,
        new Map(copyingGroups.map((group, index) => [group.id, action.duplicateGroupIds[index]!])));
      const design = { ...state.design, layers: [...state.design.layers, ...next],
        groups: [...state.design.groups, ...copiedGroups] };
      if (copiedGroups.length !== copyingGroups.length || !hasDesignCapacity(design)
          || selectionGroupError(design.groups, design.layers)) return state;
      return { ...recordDesign(state, design),
        selectedLayerIds: next.map((copy) => copy.id), editingGroupId: null };
    }
    case 'create-group': {
      if (state.editingGroupId !== null) return state;
      if (reservedId(state.design, action.groupId)) return state;
      const layerIds = validSelection(state.design, action.layerIds);
      if (layerIds.length < 2 || state.design.groups.some((group) =>
        group.layerIds.length === layerIds.length && group.layerIds.every((id) => layerIds.includes(id)))) return state;
      const group = { id: action.groupId, name: action.name.trim(), layerIds };
      const groups = [...state.design.groups.filter((existing) =>
        !existing.layerIds.some((id) => layerIds.includes(id))), group];
      const design = { ...state.design, groups };
      if (selectionGroupError(groups, design.layers)) return state;
      return { ...recordDesign(state, design), selectedLayerIds: layerIds, editingGroupId: null };
    }
    case 'rename-group': {
      const name = action.name.trim();
      const current = state.design.groups.find((group) => group.id === action.groupId);
      if (!current || name === current.name) return state;
      return recordDesign(state, { ...state.design,
        groups: state.design.groups.map((group) => group.id === action.groupId ? { ...group, name } : group) });
    }
    case 'remove-groups': {
      const groups = state.design.groups.filter((group) => !action.groupIds.includes(group.id));
      return groups.length === state.design.groups.length ? state
        : recordDesign(state, { ...state.design, groups });
    }
    case 'select-group': {
      const group = state.design.groups.find((candidate) => candidate.id === action.groupId);
      return group ? { ...state, selectedLayerIds: group.layerIds, editingGroupId: null, historyGroup: null } : state;
    }
    case 'begin-group-edit': {
      const group = state.design.groups.find((candidate) => candidate.id === action.groupId);
      if (!group || (action.layerId !== undefined && !group.layerIds.includes(action.layerId))) return state;
      const selected = action.layerId
        ?? state.selectedLayerIds.find((id) => group.layerIds.includes(id))
        ?? group.layerIds[0]!;
      return { ...state, selectedLayerIds: [selected], editingGroupId: group.id, historyGroup: null };
    }
    case 'finish-group-edit': {
      if (state.editingGroupId === null) return state;
      const group = state.design.groups.find((candidate) => candidate.id === state.editingGroupId);
      return { ...state, selectedLayerIds: group?.layerIds ?? validSelection(state.design, state.selectedLayerIds),
        editingGroupId: null, historyGroup: null };
    }
    case 'select-layer': {
      if (!getLayer(state.design, action.layerId)) return state;
      const unit = validSelection(state.design, [action.layerId], state.editingGroupId);
      if (!action.toggle) return { ...state, ...normalizeSelection(state.design, unit, state.editingGroupId), historyGroup: null };
      const selected = unit.every((id) => state.selectedLayerIds.includes(id))
        ? state.selectedLayerIds.filter((id) => !unit.includes(id))
        : [...state.selectedLayerIds, ...unit];
      return { ...state, ...normalizeSelection(state.design, selected, state.editingGroupId), historyGroup: null };
    }
    case 'select-layers':
      return { ...state, ...normalizeSelection(state.design, action.layerIds, state.editingGroupId), historyGroup: null };
    case 'toggle-layer': {
      const layer = getLayer(state.design, action.layerId);
      return layer
        ? recordDesign(state, replaceLayer(state.design, { ...layer, visible: !layer.visible }))
        : state;
    }
    case 'remove-layer': {
      const layer = getLayer(state.design, action.layerId);
      const emojiCount = state.design.layers.filter((candidate) => candidate.kind === 'emoji').length;
      if (!layer || (layer.kind === 'emoji' && emojiCount === 1)) return state;
      const layers = state.design.layers.filter((candidate) => candidate.id !== layer.id);
      return recordDesign(state, { ...state.design, layers,
        groups: pruneSelectionGroups(state.design.groups, new Set(layers.map((candidate) => candidate.id))) });
    }
    case 'remove-layers': {
      const ids = new Set(action.layerIds);
      const emojiIds = state.design.layers.filter((layer) => layer.kind === 'emoji' && ids.has(layer.id));
      const emojiCount = state.design.layers.filter((layer) => layer.kind === 'emoji').length;
      if (ids.size === 0 || emojiIds.length >= emojiCount) return state;
      const layers = state.design.layers.filter((layer) => !ids.has(layer.id));
      return layers.length === state.design.layers.length ? state
        : recordDesign(state, { ...state.design, layers,
            groups: pruneSelectionGroups(state.design.groups, new Set(layers.map((layer) => layer.id))) });
    }
    case 'move-layer': {
      const index = state.design.layers.findIndex((layer) => layer.id === action.layerId);
      if (index < 0) return state;
      const target = action.direction === 'forward' ? index + 1 : index - 1;
      if (target < 0 || target >= state.design.layers.length) return state;
      const layers = [...state.design.layers];
      const [layer] = layers.splice(index, 1);
      if (!layer) return state;
      layers.splice(target, 0, layer);
      return recordDesign(state, { ...state.design, layers });
    }
    case 'commit-history-group':
      return state.historyGroup === null ? state : { ...state, historyGroup: null };
    case 'undo': {
      const design = state.past.at(-1);
      if (!design) return state;
      return {
        ...state,
        design,
        past: state.past.slice(0, -1),
        future: [state.design, ...state.future],
        historyGroup: null,
        ...normalizeSelection(design, state.selectedLayerIds, state.editingGroupId),
      };
    }
    case 'redo': {
      const [design, ...future] = state.future;
      if (!design) return state;
      return {
        ...state,
        design,
        past: [...state.past, state.design].slice(-MAX_HISTORY),
        future,
        historyGroup: null,
        ...normalizeSelection(design, state.selectedLayerIds, state.editingGroupId),
      };
    }
    case 'set-size':
      return { ...state, exportSize: action.size, historyGroup: null };
    case 'reset-layers': {
      const targets = new Set(action.layerIds);
      let changed = false;
      const layers = state.design.layers.map((layer) => {
        if (!targets.has(layer.id)) return layer;
        const reset = layer.kind === 'emoji'
          ? { ...layer, transform: DEFAULT_TRANSFORM, appearance: DEFAULT_APPEARANCE }
          : { ...layer, transform: DEFAULT_TRANSFORM };
        if (JSON.stringify(reset) === JSON.stringify(layer)) return layer;
        changed = true;
        return reset;
      });
      return changed ? recordDesign(state, { ...state.design, layers }) : state;
    }
  }
}
