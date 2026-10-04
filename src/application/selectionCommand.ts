import type { EditorAction, EditorState } from './editor';
import { alignSelection, captureSelection, cloneSelection, distributeSelection, insertSelection,
  type Alignment, type Distribution, type SelectionFragment, type SelectionResult } from '../domain/selectionCommands';

export type SelectionCommand =
  | { readonly kind: 'paste'; readonly source: SelectionFragment }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'align'; readonly mode: Alignment }
  | { readonly kind: 'distribute'; readonly axis: Distribution };

/** Resolve intent against the current editor snapshot before entering its journal. */
export function planSelectionCommand(
  editor: EditorState, command: SelectionCommand, createId: () => string,
): SelectionResult<EditorAction> {
  const selected = captureSelection(editor.design, editor.selectedLayerIds);
  if (command.kind === 'align' || command.kind === 'distribute') {
    const result = command.kind === 'align' ? alignSelection(selected.layers, command.mode)
      : distributeSelection(selected.layers, command.axis);
    return result.ok ? { ok: true, value: { type: 'update-layer-transforms', updates: result.value } } : result;
  }
  const source = command.kind === 'paste' ? command.source : selected;
  const cloned = cloneSelection(source,
    new Map(source.layers.map(({ id }) => [id, createId()])),
    new Map(source.groups.map(({ id }) => [id, createId()])));
  if (!cloned.ok) return cloned;
  const inserted = insertSelection(editor.design, cloned.value);
  return inserted.ok ? { ok: true, value: { type: 'insert-layers', ...cloned.value } } : inserted;
}
