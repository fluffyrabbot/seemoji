import { useEffect, useId, useRef, useState, type ComponentType } from 'react';
import type { AdvancedControlsProps } from './AdvancedControls';
import type { SavedStylesProps } from './SavedStyles';
import type { AppServices } from '../application/services';
import type { RenderCoordinator } from '../application/renderCoordinator';
import {
  DEFAULT_TRANSFORM,
  DESIGN_LIMITS,
  type Appearance,
  type DesignDocument,
  type EmojiLayer,
  type SceneLayer,
  type Transform,
} from '../domain/design';
import {
  applyQuickStyle,
  moveSelection,
  QUICK_STYLES,
  rotateSelection,
  scaleSelection,
  selectionSize,
  wrapRotation,
  type LayerTransformUpdate,
} from './inspectorModel';

export interface SliderProps {
  readonly label: string;
  readonly value: number;
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly displayScale?: number;
  readonly suffix?: string;
  readonly disabled?: boolean;
  readonly onChange: (value: number, historyGroup: string) => void;
  readonly onCommit: () => void;
}

const decimals = (step: number): number => {
  const value = String(step);
  return value.includes('.') ? value.length - value.indexOf('.') - 1 : 0;
};

function Slider({
  label,
  value,
  defaultValue,
  min,
  max,
  step = 1,
  displayScale = 1,
  suffix = '',
  disabled = false,
  onChange,
  onCommit,
}: SliderProps) {
  const id = useId();
  const group = `control:${label}`;
  const displayStep = step * displayScale;
  const displayValue = Number((value * displayScale).toFixed(decimals(displayStep)));
  const update = (next: number) =>
    onChange(Math.min(max, Math.max(min, next / displayScale)), group);
  const reset = () => {
    onChange(defaultValue, group);
    onCommit();
  };

  return (
    <div className="control-row">
      <label htmlFor={id}>{label}</label>
      <input
        type="range"
        aria-label={`${label} slider`}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value), group)}
        onPointerUp={onCommit}
        onPointerCancel={onCommit}
        onBlur={onCommit}
        onKeyUp={onCommit}
        onDoubleClick={reset}
      />
      <span className="number-control">
        <input
          id={id}
          type="number"
          min={min * displayScale}
          max={max * displayScale}
          step={displayStep}
          value={displayValue}
          disabled={disabled}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) update(next);
          }}
          onBlur={onCommit}
          onKeyUp={onCommit}
          onDoubleClick={reset}
        />
        {suffix && <span aria-hidden="true">{suffix}</span>}
      </span>
      <button
        type="button"
        className="control-reset"
        aria-label={`Reset ${label}`}
        title={`Reset ${label}`}
        disabled={disabled || value === defaultValue}
        onClick={reset}
      >
        ↺
      </button>
    </div>
  );
}

export interface ControlsProps {
  readonly design: DesignDocument;
  readonly selectedLayerIds: readonly string[];
  readonly renderer: RenderCoordinator;
  readonly emojiStyles: AppServices['emojiStyles'];
  readonly proportionsLocked: boolean;
  readonly onProportionsLockedChange: (locked: boolean) => void;
  readonly onTransformsChange: (updates: readonly LayerTransformUpdate[], historyGroup?: string) => void;
  readonly onAppearanceChange: (layerId: string, appearance: Appearance, historyGroup?: string) => void;
  readonly onApplyStyle: (layerId: string, transform: Transform, appearance: Appearance) => void;
  readonly onUpdateLayer: (layer: SceneLayer, historyGroup?: string) => void;
  readonly onCommit: () => void;
  readonly onReset: (layerIds: readonly string[]) => void;
}

function StylePreview({ layer, renderer }: { readonly layer: EmojiLayer; readonly renderer: RenderCoordinator }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failedPreview, setFailedPreview] = useState<string | null>(null);
  // Position does not belong in the style swatch; keep every preview centered and visible.
  const document: DesignDocument = { version: 3, groups: [], canvas: { background: 'transparent' }, layers: [{
    ...layer, visible: true, opacity: 1, transform: { ...layer.transform, x: 0, y: 0 },
  }] };
  const key = JSON.stringify(document);
  useEffect(() => {
    let active = true;
    const context = canvas.current?.getContext('2d');
    context?.clearRect(0, 0, 80, 80);
    renderer.render(JSON.parse(key) as DesignDocument, 80).then((frame) => {
      if (!active) return;
      context?.drawImage(frame.canvas, 0, 0, 80, 80);
    }).catch(() => { if (active) setFailedPreview(key); });
    return () => { active = false; };
  }, [key, renderer]);
  return <span className="style-preview">
    <canvas ref={canvas} width={80} height={80} aria-hidden="true" />
    {failedPreview === key && <small>Preview unavailable</small>}
  </span>;
}

export default function Controls(props: ControlsProps) {
  const selectionKey = props.design.layers
    .filter((layer) => props.selectedLayerIds.includes(layer.id))
    .map((layer) => `${layer.kind}:${layer.id}`).join(',');
  // A different target owns a fresh gesture and field lifecycle, even when the
  // previous slider did not receive a pointer-up (for example, selection undo).
  return <SelectionControls key={selectionKey} {...props} />;
}

function SelectionControls({
  design,
  selectedLayerIds,
  renderer,
  emojiStyles,
  proportionsLocked,
  onProportionsLockedChange,
  onTransformsChange,
  onAppearanceChange,
  onApplyStyle,
  onUpdateLayer,
  onCommit,
  onReset,
}: ControlsProps) {
  const [Advanced, setAdvanced] = useState<ComponentType<AdvancedControlsProps> | null>(null);
  const [advancedFailed, setAdvancedFailed] = useState(false);
  const [Styles, setStyles] = useState<ComponentType<SavedStylesProps> | null>(null);
  const [stylesFailed, setStylesFailed] = useState(false);
  const loadStyles = async () => {
    setStylesFailed(false);
    try {
      const module = await import('./SavedStyles');
      setStyles(() => module.default);
    } catch {
      setStylesFailed(true);
    }
  };
  const loadAdvanced = async () => {
    setAdvancedFailed(false);
    try {
      const module = await import('./AdvancedControls');
      setAdvanced(() => module.default);
    } catch {
      setAdvancedFailed(true);
    }
  };
  const transformGesture = useRef<{ readonly key: string; readonly layers: readonly SceneLayer[] } | null>(null);
  const selected = design.layers.filter((layer) => selectedLayerIds.includes(layer.id));
  const single = selected.length === 1 ? selected[0] : undefined;
  const emoji = single?.kind === 'emoji' ? single : undefined;
  const first = selected[0];
  const rotate = first?.transform.rotate ?? 0;
  const size = selectionSize(selected);
  const ids = selected.map((layer) => layer.id);
  const group = (label: string) => `inspector:${ids.join(',')}:${label}`;
  const gestureLayers = (label?: string): readonly SceneLayer[] => {
    if (!label) return selected;
    const key = group(label);
    if (transformGesture.current?.key !== key) transformGesture.current = { key, layers: selected };
    return transformGesture.current.layers;
  };
  const commit = () => {
    transformGesture.current = null;
    onCommit();
  };
  const changeTransforms = (updates: readonly LayerTransformUpdate[], label?: string) =>
    onTransformsChange(updates, label ? group(label) : undefined);
  const setTransform = <Key extends keyof Transform>(key: Key, value: Transform[Key], label?: string) => {
    if (single) changeTransforms([{ layerId: single.id, transform: { ...single.transform, [key]: value } }], label);
  };
  const rotateTo = (value: number, label?: string) => {
    if (!first) return;
    if (single) setTransform('rotate', value, label);
    else {
      const layers = gestureLayers(label);
      const reference = layers[0]!.transform;
      const direction = reference.flipH !== reference.flipV ? -1 : 1;
      changeTransforms(rotateSelection(layers, (value - reference.rotate) * direction), label);
    }
  };
  const updateSingle = (next: SceneLayer, label: string) => onUpdateLayer(next, group(label));

  return (
    <div className="panel controls-panel">
      <div className="inspector-heading">
        <div>
          <span className="selection-label">{selected.length ? 'Editing' : 'Workspace'}</span>
          <h2>{single?.name ?? (selected.length ? `${selected.length} objects` : 'Canvas')}</h2>
          <p className="selection-summary">{single ? 'Adjust the selected object.'
            : selected.length ? 'Move, resize, and rotate this selection together.'
              : 'Select an object on the canvas to edit it.'}</p>
        </div>
        {selected.length > 0 && <button type="button" aria-label="Reset selected edits"
          title="Reset transforms and effects on the selected objects" onClick={() => onReset(ids)}>Reset selected</button>}
      </div>

      {!selected.length && <div className="inspector-empty">
        <p>Add an emoji or text to start composing. Choose an object on the canvas or in Objects to see its controls here.</p>
      </div>}

      {emoji && <fieldset className="preset-controls">
        <legend>Quick styles</legend>
        <div className="preset-list">
          {QUICK_STYLES.map((style) => {
            const candidate = applyQuickStyle(emoji, style.id);
            return <button type="button" className="visual-preset" key={style.id} title={style.description}
              onClick={() => onApplyStyle(emoji.id, candidate.transform, candidate.appearance)}>
              <StylePreview layer={candidate} renderer={renderer} />
              <span>{style.name}</span>
            </button>;
          })}
        </div>
        <p className="preset-description">Preview your emoji, then apply a style. Each click is one undo.</p>
      </fieldset>}

      {emoji && <details className="saved-styles-details" onToggle={(event) => {
        if (event.currentTarget.open && !Styles) void loadStyles();
      }}>
        <summary>Saved styles</summary>
        {Styles ? <Styles loadLibrary={emojiStyles} selectedLayer={emoji}
          onApply={(transform, appearance) => onApplyStyle(emoji.id, transform, appearance)} />
          : stylesFailed ? <p role="alert">Couldn’t load saved styles. <button type="button"
            onClick={() => void loadStyles()}>Try again</button></p>
            : <p role="status">Loading saved styles…</p>}
      </details>}

      {single?.kind === 'text' && <div className="inspector-object-fields">
        <label><span>Text</span><input type="text" maxLength={500} value={single.text}
          onChange={(event) => updateSingle({ ...single, text: event.target.value || ' ' }, 'text')}
          onBlur={onCommit} /></label>
        <label className="color-control"><span>Text color</span>
          <input type="color" value={single.color}
            onChange={(event) => updateSingle({ ...single, color: event.target.value }, 'text-color')}
            onBlur={onCommit} onPointerUp={onCommit} /></label>
      </div>}
      {single?.kind === 'shape' && <div className="inspector-object-fields">
        <label className="color-control"><span>Shape color</span>
          <input type="color" value={single.fill ?? single.stroke?.color ?? '#000000'}
            onChange={(event) => updateSingle(single.shape === 'line'
              ? { ...single, stroke: { color: event.target.value, width: single.stroke?.width ?? 0.025 } }
              : { ...single, fill: event.target.value }, 'shape-color')}
            onBlur={onCommit} onPointerUp={onCommit} /></label>
      </div>}

      {selected.length > 0 && <>
        <fieldset className="primary-transforms">
          <legend>{single ? 'Transform' : 'Selection transform'}</legend>
          <Slider label="Size" min={DESIGN_LIMITS.scaleX[0]} max={DESIGN_LIMITS.scaleX[1]}
            step={0.05} suffix="×" defaultValue={1} value={size}
            onChange={(value, label) => changeTransforms(scaleSelection(gestureLayers(label), value), label)} onCommit={commit} />
          <Slider label="Rotate" min={DESIGN_LIMITS.rotate[0]} max={DESIGN_LIMITS.rotate[1]}
            value={rotate} suffix="°" defaultValue={DEFAULT_TRANSFORM.rotate}
            onChange={rotateTo} onCommit={commit} />
          {single && <div className="quick-transform-actions">
            <button type="button" aria-pressed={single.transform.flipH}
              onClick={() => setTransform('flipH', !single.transform.flipH)}>Mirror</button>
            <button type="button" onClick={() => rotateTo(wrapRotation(rotate + 180))}>Rotate 180°</button>
          </div>}
        </fieldset>

        <details className="more-controls" onToggle={(event) => {
          if (event.currentTarget.open && !Advanced) void loadAdvanced();
        }}>
          <summary>More editing controls</summary>
          {Advanced ? <Advanced
            Slider={Slider}
            selection={selected}
            proportionsLocked={proportionsLocked}
            onProportionsLockedChange={onProportionsLockedChange}
            onPositionChange={(axis, value, label) => changeTransforms(moveSelection(gestureLayers(label), axis, value), label)}
            setTransform={setTransform}
            onAppearanceChange={onAppearanceChange}
            onUpdateLayer={onUpdateLayer}
            updateSingle={updateSingle}
            historyGroup={group}
            onCommit={onCommit}
            onTransformCommit={commit}
          /> : advancedFailed ? <p role="alert">Couldn’t load editing controls. <button type="button" onClick={() => void loadAdvanced()}>Try again</button></p>
            : <p role="status">Loading editing controls…</p>}
        </details>
      </>}
    </div>
  );
}
