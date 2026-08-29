import type { DesignDocument, SceneLayer } from '../domain/design';

interface Props {
  readonly design: DesignDocument;
  readonly selectedLayerIds: readonly string[];
  readonly onSelect: (id: string, toggle: boolean) => void;
  readonly onToggle: (id: string) => void;
  readonly onMove: (id: string, direction: 'forward' | 'backward') => void;
  readonly onRemove: (id: string) => void;
  readonly onRename: (id: string, name: string) => void;
  readonly onDuplicate: (id: string) => void;
  readonly onOpacityChange: (id: string, opacity: number, historyGroup: string) => void;
  readonly onCommit: () => void;
  readonly onAdd: (kind: 'paint' | 'rectangle' | 'ellipse' | 'line' | 'text') => void;
  readonly onUpdate: (layer: SceneLayer, historyGroup?: string) => void;
  readonly onAlign: (mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  readonly onDistribute: (axis: 'horizontal' | 'vertical') => void;
  readonly onCopy: () => void;
  readonly onPaste: () => void;
  readonly onDuplicateSelection: () => void;
  readonly onGroup: () => void;
  readonly onUngroup: () => void;
}

export default function LayersPanel({
  design,
  selectedLayerIds,
  onSelect,
  onToggle,
  onMove,
  onRemove,
  onRename,
  onDuplicate,
  onOpacityChange,
  onCommit,
  onAdd,
  onUpdate,
  onAlign,
  onDistribute,
  onCopy,
  onPaste,
  onDuplicateSelection,
  onGroup,
  onUngroup,
}: Props) {
  const topFirst = [...design.layers].reverse();
  const emojiCount = design.layers.filter((layer) => layer.kind === 'emoji').length;

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
        <button type="button" onClick={onCopy} title="Copy layers (⌘C)">Copy</button>
        <button type="button" onClick={onPaste} title="Paste layers (⌘V)">Paste</button>
        <button type="button" onClick={onDuplicateSelection} title="Duplicate with offset (⌘D)">Duplicate</button>
        <button type="button" disabled={selectedLayerIds.length < 2} onClick={onGroup} title="Group selection (⌘G)">Group</button>
        <button type="button" onClick={onUngroup} title="Ungroup selection (⇧⌘G)">Ungroup</button>
      </div>
      <div className="layer-list" role="list" aria-label="Canvas layers">
        {topFirst.map((layer) => {
          const index = design.layers.findIndex((candidate) => candidate.id === layer.id);
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
              {selectedLayerIds.length === 1 && selectedLayerIds[0] === layer.id && (
                <div className="layer-properties">
                  <label>
                    <span>Name</span>
                    <input key={layer.name} type="text" defaultValue={layer.name} maxLength={80}
                      onBlur={(event) => onRename(layer.id, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                      }} />
                  </label>
                  {layer.kind === 'text' && (
                    <>
                      <label>
                        <span>Text</span>
                        <input type="text" maxLength={500} value={layer.text}
                          onChange={(event) => onUpdate({ ...layer, text: event.target.value || ' ' }, `text:${layer.id}`)}
                          onBlur={onCommit} />
                      </label>
                      <label>
                        <span>Color</span>
                        <input type="color" value={layer.color}
                          onChange={(event) => onUpdate({ ...layer, color: event.target.value }, `text-color:${layer.id}`)}
                          onPointerUp={onCommit} />
                      </label>
                    </>
                  )}
                  {layer.kind === 'shape' && (
                    <label>
                      <span>Color</span>
                      <input type="color" value={layer.fill ?? layer.stroke?.color ?? '#000000'}
                        onChange={(event) => onUpdate(layer.shape === 'line'
                          ? { ...layer, stroke: { color: event.target.value, width: layer.stroke?.width ?? 0.025 } }
                          : { ...layer, fill: event.target.value }, `shape-color:${layer.id}`)}
                        onPointerUp={onCommit} />
                    </label>
                  )}
                  <label>
                    <span>Opacity</span>
                    <input type="range" aria-label="Layer opacity"
                      min="0" max="1" step="0.05" value={layer.opacity}
                      onChange={(event) => onOpacityChange(
                        layer.id,
                        Number(event.target.value),
                        `layer-opacity:${layer.id}`,
                      )}
                      onPointerUp={onCommit} onKeyUp={onCommit} />
                    <output>{Math.round(layer.opacity * 100)}%</output>
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
