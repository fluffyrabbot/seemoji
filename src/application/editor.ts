import {
  DEFAULT_DESIGN,
  resetDesign,
  type Appearance,
  type DesignDocument,
  type Transform,
} from '../domain/design';
import type { EmojiAssetRef } from '../domain/emoji';

export const EXPORT_SIZES = [48, 128, 256] as const;
export type ExportSize = (typeof EXPORT_SIZES)[number];

export interface EditorState {
  readonly design: DesignDocument;
  readonly exportSize: ExportSize;
}

export type EditorAction =
  | { readonly type: 'replace-design'; readonly design: DesignDocument }
  | { readonly type: 'set-source'; readonly source: EmojiAssetRef }
  | { readonly type: 'update-transform'; readonly transform: Transform }
  | { readonly type: 'update-appearance'; readonly appearance: Appearance }
  | { readonly type: 'set-size'; readonly size: ExportSize }
  | { readonly type: 'reset' };

export const INITIAL_EDITOR_STATE: EditorState = {
  design: DEFAULT_DESIGN,
  exportSize: 128,
};

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'replace-design':
      return { ...state, design: action.design };
    case 'set-source':
      return { ...state, design: { ...state.design, source: action.source } };
    case 'update-transform':
      return { ...state, design: { ...state.design, transform: action.transform } };
    case 'update-appearance':
      return { ...state, design: { ...state.design, appearance: action.appearance } };
    case 'set-size':
      return { ...state, exportSize: action.size };
    case 'reset':
      return { ...state, design: resetDesign(state.design) };
  }
}
