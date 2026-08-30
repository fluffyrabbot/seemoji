import {
  DEFAULT_DESIGN,
  DEFAULT_TRANSFORM,
  PRIMARY_EMOJI_LAYER_ID,
  getLayer,
  replaceLayer,
  resetDesign,
  updateEmojiLayer,
  type Appearance,
  type BrushStroke,
  type DesignDocument,
  type MaskStroke,
  type SceneLayer,
  type StrokeLayer,
  type Transform,
} from '../domain/design';
import type { EmojiAssetRef } from '../domain/emoji';

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
}

type GroupedAction = { readonly historyGroup?: string };

export type EditorAction =
  | { readonly type: 'load-design'; readonly design: DesignDocument }
  | ({ readonly type: 'replace-design'; readonly design: DesignDocument } & GroupedAction)
  | ({ readonly type: 'set-source'; readonly source: EmojiAssetRef } & GroupedAction)
  | ({ readonly type: 'update-transform'; readonly transform: Transform } & GroupedAction)
  | ({ readonly type: 'update-layer-transform'; readonly layerId: string; readonly transform: Transform } & GroupedAction)
  | ({ readonly type: 'update-layer-transforms'; readonly updates: readonly { readonly layerId: string; readonly transform: Transform }[] } & GroupedAction)
  | ({ readonly type: 'update-appearance'; readonly appearance: Appearance } & GroupedAction)
  | ({
      readonly type: 'apply-layer-style';
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
  | { readonly type: 'insert-layers'; readonly layers: readonly SceneLayer[] }
  | ({ readonly type: 'update-layer'; readonly layer: SceneLayer } & GroupedAction)
  | { readonly type: 'rename-layer'; readonly layerId: string; readonly name: string }
  | ({ readonly type: 'set-layer-opacity'; readonly layerId: string; readonly opacity: number } & GroupedAction)
  | { readonly type: 'duplicate-layer'; readonly layerId: string; readonly duplicateId: string; readonly name: string }
  | { readonly type: 'duplicate-layers'; readonly layerIds: readonly string[]; readonly duplicateIds: readonly string[]; readonly offset?: number }
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
  | { readonly type: 'reset' };

export const INITIAL_EDITOR_STATE: EditorState = {
  design: DEFAULT_DESIGN,
  exportSize: 128,
  past: [],
  future: [],
  historyGroup: null,
  selectedLayerIds: [PRIMARY_EMOJI_LAYER_ID],
};

const validSelection = (design: DesignDocument, ids: readonly string[]): readonly string[] => {
  const valid = ids.filter((id, index) => ids.indexOf(id) === index && getLayer(design, id));
  return valid.length > 0 ? valid : [design.layers.at(-1)!.id];
};

function recordDesign(
  state: EditorState,
  design: DesignDocument,
  historyGroup?: string,
): EditorState {
  if (design === state.design) return state;
  if (historyGroup && state.historyGroup === historyGroup) {
    return {
      ...state,
      design,
      future: [],
      selectedLayerIds: validSelection(design, state.selectedLayerIds),
    };
  }
  return {
    ...state,
    design,
    past: [...state.past, state.design].slice(-MAX_HISTORY),
    future: [],
    historyGroup: historyGroup ?? null,
    selectedLayerIds: validSelection(design, state.selectedLayerIds),
  };
}

export const canUndo = (state: EditorState): boolean => state.past.length > 0;
export const canRedo = (state: EditorState): boolean => state.future.length > 0;

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'load-design':
      return { ...state, design: action.design, past: [], future: [], historyGroup: null,
        selectedLayerIds: [action.design.layers.at(-1)!.id] };
    case 'replace-design':
      return recordDesign(state, action.design, action.historyGroup);
    case 'set-source':
      return recordDesign(
        state,
        updateEmojiLayer(state.design, (layer) => ({ ...layer, source: action.source })),
        action.historyGroup,
      );
    case 'update-transform':
      return recordDesign(
        state,
        updateEmojiLayer(state.design, (layer) => ({
          ...layer,
          transform: action.transform,
        })),
        action.historyGroup,
      );
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
    case 'update-appearance':
      return recordDesign(
        state,
        updateEmojiLayer(state.design, (layer) => ({
          ...layer,
          appearance: action.appearance,
        })),
        action.historyGroup,
      );
    case 'apply-layer-style':
      return recordDesign(
        state,
        updateEmojiLayer(state.design, (layer) => ({
          ...layer,
          transform: action.transform,
          appearance: action.appearance,
        })),
        action.historyGroup,
      );
    case 'paint-stroke': {
      const existing = getLayer(state.design, action.layerId);
      if (existing?.kind === 'strokes') {
        return recordDesign(
          state,
          replaceLayer(state.design, {
            ...existing,
            visible: true,
            strokes: [...existing.strokes, action.stroke],
          }),
        );
      }
      if (existing || !action.createLayerName || state.design.layers.length >= 100) return state;
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
      return {
        ...recordDesign(state, {
          ...state.design,
          layers: [...state.design.layers, layer],
        }),
        selectedLayerIds: [layer.id],
      };
    }
    case 'mask-stroke': {
      const layer = getLayer(state.design, action.layerId);
      if (!layer) return state;
      return recordDesign(
        state,
        replaceLayer(state.design, { ...layer, mask: [...layer.mask, action.stroke] }),
      );
    }
    case 'add-stroke-layer': {
      if (getLayer(state.design, action.layerId) || state.design.layers.length >= 100) return state;
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
      };
    }
    case 'add-layer': {
      if (getLayer(state.design, action.layer.id) || state.design.layers.length >= 100) return state;
      return {
        ...recordDesign(state, { ...state.design, layers: [...state.design.layers, action.layer] }),
        selectedLayerIds: [action.layer.id],
      };
    }
    case 'insert-layers': {
      if (action.layers.length === 0 || state.design.layers.length + action.layers.length > 100) return state;
      const existing = new Set(state.design.layers.map((layer) => layer.id));
      if (action.layers.some((layer) => !layer.id || existing.has(layer.id))) return state;
      return { ...recordDesign(state, { ...state.design, layers: [...state.design.layers, ...action.layers] }),
        selectedLayerIds: action.layers.map((layer) => layer.id) };
    }
    case 'update-layer':
      return getLayer(state.design, action.layer.id)
        ? recordDesign(state, replaceLayer(state.design, action.layer), action.historyGroup)
        : state;
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
      if (!layer || getLayer(state.design, action.duplicateId) || state.design.layers.length >= 100) {
        return state;
      }
      const index = state.design.layers.findIndex((candidate) => candidate.id === layer.id);
      const duplicate = { ...layer, id: action.duplicateId, name: action.name };
      const layers = [...state.design.layers];
      layers.splice(index + 1, 0, duplicate);
      return {
        ...recordDesign(state, { ...state.design, layers }),
        selectedLayerIds: [duplicate.id],
      };
    }
    case 'duplicate-layers': {
      if (action.layerIds.length !== action.duplicateIds.length || state.design.layers.length + action.layerIds.length > 100) return state;
      const offset = action.offset ?? 0.035;
      const copies = action.layerIds.map((id, index) => {
        const layer = getLayer(state.design, id);
        const duplicateId = action.duplicateIds[index];
        if (!layer || !duplicateId || getLayer(state.design, duplicateId)) return null;
        return { ...layer, id: duplicateId, name: `${layer.name} copy`.slice(0, 80), transform: {
          ...layer.transform,
          x: Math.min(0.5, layer.transform.x + offset),
          y: Math.min(0.5, layer.transform.y + offset),
        } } as SceneLayer;
      });
      if (copies.some((copy) => copy === null)) return state;
      const next = copies as SceneLayer[];
      return { ...recordDesign(state, { ...state.design, layers: [...state.design.layers, ...next] }),
        selectedLayerIds: next.map((copy) => copy.id) };
    }
    case 'select-layer': {
      if (!getLayer(state.design, action.layerId)) return state;
      if (!action.toggle) return { ...state, selectedLayerIds: [action.layerId], historyGroup: null };
      const selected = state.selectedLayerIds.includes(action.layerId)
        ? state.selectedLayerIds.filter((id) => id !== action.layerId)
        : [...state.selectedLayerIds, action.layerId];
      return { ...state, selectedLayerIds: selected.length > 0 ? selected : [action.layerId], historyGroup: null };
    }
    case 'select-layers':
      return { ...state, selectedLayerIds: validSelection(state.design, action.layerIds), historyGroup: null };
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
      return recordDesign(state, {
        ...state.design,
        layers: state.design.layers.filter((candidate) => candidate.id !== layer.id),
      });
    }
    case 'remove-layers': {
      const ids = new Set(action.layerIds);
      const emojiIds = state.design.layers.filter((layer) => layer.kind === 'emoji' && ids.has(layer.id));
      const emojiCount = state.design.layers.filter((layer) => layer.kind === 'emoji').length;
      if (ids.size === 0 || emojiIds.length >= emojiCount) return state;
      const layers = state.design.layers.filter((layer) => !ids.has(layer.id));
      return layers.length === state.design.layers.length ? state
        : recordDesign(state, { ...state.design, layers });
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
        selectedLayerIds: validSelection(design, state.selectedLayerIds),
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
        selectedLayerIds: validSelection(design, state.selectedLayerIds),
      };
    }
    case 'set-size':
      return { ...state, exportSize: action.size, historyGroup: null };
    case 'reset': {
      const reset = resetDesign(state.design);
      if (JSON.stringify(state.design) === JSON.stringify(reset)) return state;
      return recordDesign(state, reset);
    }
  }
}
