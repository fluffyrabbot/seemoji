import type { DesignDocument } from '../domain/design';

interface Props {
  readonly design: DesignDocument;
  readonly selectedLayerIds: readonly string[];
  readonly editingGroupId: string | null;
  readonly onSelect: (id: string, toggle: boolean) => void;
  readonly onToggle: (id: string) => void;
  readonly onMove: (id: string, direction: 'forward' | 'backward') => void;
  readonly onRemove: (id: string) => void;
  readonly onDuplicate: (id: string) => void;
  readonly onAdd: (kind: 'paint' | 'rectangle' | 'ellipse' | 'line' | 'text') => void;
  readonly onAlign: (mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  readonly onDistribute: (axis: 'horizontal' | 'vertical') => void;
  readonly onCopy: () => void;
  readonly onPaste: () => void;
  readonly onDuplicateSelection: () => void;
  readonly onGroup: () => void;
  readonly onUngroup: () => void;
  readonly onSelectGroup: (groupId: string) => void;
  readonly onEditGroup: (groupId: string) => void;
  readonly onRenameGroup: (groupId: string, name: string) => void;
  readonly onUngroupGroup: (groupId: string) => void;
}

export default function LayersPanel({
  design,
  selectedLayerIds,
  editingGroupId,
  onSelect,
  onToggle,
  onMove,
  onRemove,
  onDuplicate,
  onAdd,
  onAlign,
  onDistribute,
  onCopy,
  onPaste,
  onDuplicateSelection,
  onGroup,
  onUngroup,
  onSelectGroup,
  onEditGroup,
  onRenameGroup,
  onUngroupGroup,
}: Props) {
  const topFirst = [...design.layers].reverse();
  const emojiCount = design.layers.filter((layer) => layer.kind === 'emoji').length;
  const selectedGroups = design.groups.filter((group) => group.layerIds.some((id) => selectedLayerIds.includes(id)));
  const alreadyGrouped = selectedGroups.length === 1
    && selectedGroups[0]!.layerIds.length === selectedLayerIds.length;

  return (
    <div className="panel layers-panel">
      <div className="layers-heading">
        <div>
          <h2>Layers</h2>
          <p>Top layers paint in front.</p>
        </div>
        <div className="layer-create" aria-label="Create layer">
          <button type="button" aria-label="Add paint layer" onClick={() => onAdd('paint')}>＋ Paint</button>
          <button type="button" aria-label="Add rectangle" onClick={() => onAdd('rectangle')}>▭</button>
          <button type="button" aria-label="Add ellipse" onClick={() => onAdd('ellipse')}>○</button>
          <button type="button" aria-label="Add line" onClick={() => onAdd('line')}>╱</button>
          <button type="button" aria-label="Add text" onClick={() => onAdd('text')}>T</button>
        </div>
      </div>
      {selectedLayerIds.length > 1 && (
        <div className="arrange-actions" aria-label="Arrange selected layers">
          <span>Align</span>
          {(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map((mode) => (
            <button type="button" key={mode} title={`Align ${mode}`} aria-label={`Align ${mode}`} onClick={() => onAlign(mode)}>
              {mode[0]!.toUpperCase()}
            </button>
          ))}
          <span>Space</span>
          <button type="button" aria-label="Distribute horizontally" disabled={selectedLayerIds.length < 3}
            onClick={() => onDistribute('horizontal')}>H</button>
          <button type="button" aria-label="Distribute vertically" disabled={selectedLayerIds.length < 3}
            onClick={() => onDistribute('vertical')}>V</button>
        </div>
      )}
      <div className="selection-actions" aria-label="Selection actions">
        <button type="button" disabled={selectedLayerIds.length === 0} onClick={onCopy} title="Copy layers (⌘C)">Copy layers</button>
        <button type="button" onClick={onPaste} title="Paste layers (⌘V)">Paste layers</button>
        <button type="button" disabled={selectedLayerIds.length === 0} onClick={onDuplicateSelection}
          aria-label="Duplicate selection" title="Duplicate with offset (⌘D)">Duplicate</button>
        <button type="button" disabled={selectedLayerIds.length < 2 || alreadyGrouped || editingGroupId !== null}
          onClick={onGroup} title="Group selection (⌘G)">Group</button>
        <button type="button" disabled={selectedGroups.length === 0} onClick={onUngroup} title="Ungroup selection (⇧⌘G)">Ungroup</button>
      </div>
      {design.groups.length > 0 && <section className="selection-groups" aria-label="Saved groups">
        <h3>Saved groups</h3>
        <p>Select a group to move it together, or edit its members.</p>
        {design.groups.map((group) => <div className={`selection-group${editingGroupId === group.id ? ' editing' : ''}`}
          key={`${group.id}:${group.name}`}>
          <button type="button" aria-label={`Select group “${group.name}”`}
            aria-pressed={editingGroupId === null && group.layerIds.every((id) => selectedLayerIds.includes(id))}
            onClick={() => onSelectGroup(group.id)}>{group.layerIds.length} objects</button>
          <input aria-label={`Rename group “${group.name}”`} defaultValue={group.name} maxLength={80}
            onBlur={(event) => {
              const name = event.currentTarget.value.trim();
              if (name) onRenameGroup(group.id, name);
              else event.currentTarget.value = group.name;
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                event.currentTarget.value = group.name;
                event.currentTarget.blur();
              }
            }} />
          <button type="button" aria-label={`Edit group “${group.name}”`} disabled={editingGroupId === group.id}
            aria-pressed={editingGroupId === group.id} onClick={() => onEditGroup(group.id)}>Edit members</button>
          <button type="button" aria-label={`Ungroup “${group.name}”`}
            onClick={() => onUngroupGroup(group.id)}>Ungroup</button>
        </div>)}
      </section>}
      <div className="layer-list" role="list" aria-label="Canvas layers">
        {topFirst.map((layer) => {
          const index = design.layers.findIndex((candidate) => candidate.id === layer.id);
          const group = design.groups.find((candidate) => candidate.layerIds.includes(layer.id));
          return (
            <div className={`layer-item ${selectedLayerIds.includes(layer.id) ? 'selected' : ''}`}
              key={layer.id} role="listitem">
              <button type="button" className="visibility-button"
                aria-label={`${layer.visible ? 'Hide' : 'Show'} “${layer.name}”`}
                aria-pressed={layer.visible}
                onClick={() => onToggle(layer.id)}>
                {layer.visible ? '◉' : '○'}
              </button>
              <button type="button" className="layer-select"
                aria-pressed={selectedLayerIds.includes(layer.id)}
                onClick={(event) => onSelect(layer.id, event.shiftKey)}>
                <span className="layer-icon" aria-hidden="true">
                  {layer.kind === 'emoji' ? layer.source.grapheme
                    : layer.kind === 'strokes' ? '✎'
                      : layer.kind === 'shape' ? (layer.shape === 'rectangle' ? '▭' : layer.shape === 'ellipse' ? '○' : '╱')
                        : layer.kind === 'text' ? 'T' : '▦'}
                </span>
                <span>
                  <strong>{layer.name}</strong>
                  <small>
                    {layer.kind === 'emoji' ? 'Emoji'
                      : layer.kind === 'strokes' ? `${layer.strokes.length} stroke${layer.strokes.length === 1 ? '' : 's'}`
                        : layer.kind === 'shape' ? layer.shape
                          : layer.kind === 'text' ? 'Text' : `${layer.runs.length} fill runs`}
                    {layer.mask.length > 0 ? ` · ${layer.mask.length} mask` : ''}
                    {group ? ` · ${group.name}` : ''}
                  </small>
                </span>
              </button>
              <div className="layer-actions">
                <button type="button" aria-label={`Move “${layer.name}” forward`}
                  title="Move forward" disabled={index === design.layers.length - 1}
                  onClick={() => onMove(layer.id, 'forward')}>↑</button>
                <button type="button" aria-label={`Move “${layer.name}” backward`}
                  title="Move backward" disabled={index === 0}
                  onClick={() => onMove(layer.id, 'backward')}>↓</button>
                <button type="button" aria-label={`Delete “${layer.name}”`}
                  title={layer.kind === 'emoji' && emojiCount === 1 ? 'The last emoji layer cannot be deleted' : 'Delete layer'}
                  disabled={layer.kind === 'emoji' && emojiCount === 1}
                  onClick={() => onRemove(layer.id)}>×</button>
                <button type="button" aria-label={`Duplicate “${layer.name}”`}
                  title="Duplicate layer" onClick={() => onDuplicate(layer.id)}>⧉</button>
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}
