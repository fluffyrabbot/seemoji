import { useId } from 'react';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_TRANSFORM,
  DESIGN_LIMITS,
  getEmojiLayer,
  type Appearance,
  type DesignDocument,
  type Transform,
} from '../domain/design';

interface SliderProps {
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

interface Props {
  readonly design: DesignDocument;
  readonly proportionsLocked: boolean;
  readonly onProportionsLockedChange: (locked: boolean) => void;
  readonly onTransformChange: (transform: Transform, historyGroup?: string) => void;
  readonly onAppearanceChange: (appearance: Appearance, historyGroup?: string) => void;
  readonly onApplyStyle: (transform: Transform, appearance: Appearance) => void;
  readonly onCommit: () => void;
  readonly onReset: () => void;
}

export default function Controls({
  design,
  proportionsLocked,
  onProportionsLockedChange,
  onTransformChange,
  onAppearanceChange,
  onApplyStyle,
  onCommit,
  onReset,
}: Props) {
  const { transform, appearance } = getEmojiLayer(design);
  const outline = appearance.outline;
  const setTransform = <Key extends keyof Transform>(
    key: Key,
    value: Transform[Key],
    historyGroup?: string,
  ) => onTransformChange({ ...transform, [key]: value }, historyGroup);
  const setAppearance = <Key extends keyof Appearance>(
    key: Key,
    value: Appearance[Key],
    historyGroup?: string,
  ) => onAppearanceChange({ ...appearance, [key]: value }, historyGroup);
  const size = Math.sqrt(transform.scaleX * transform.scaleY);
  const setSize = (value: number, historyGroup: string) => {
    const ratio = value / size;
    onTransformChange(
      {
        ...transform,
        scaleX: Math.min(DESIGN_LIMITS.scaleX[1], Math.max(DESIGN_LIMITS.scaleX[0], transform.scaleX * ratio)),
        scaleY: Math.min(DESIGN_LIMITS.scaleY[1], Math.max(DESIGN_LIMITS.scaleY[0], transform.scaleY * ratio)),
      },
      historyGroup,
    );
  };

  return (
    <div className="panel controls-panel">
      <div className="inspector-heading">
        <div>
          <h2>Adjust</h2>
          <p>Drag the canvas handles or enter exact values.</p>
        </div>
        <button type="button" aria-label="Reset edits" onClick={onReset}>Reset all</button>
      </div>

      <fieldset className="preset-controls">
        <legend>Quick styles</legend>
        <div className="preset-list">
          <button type="button" onClick={() => onApplyStyle(
            { ...transform, rotate: -12, scaleX: 1.05, scaleY: 1.05 },
            appearance,
          )}>Tilt</button>
          <button type="button" onClick={() => onApplyStyle(
            { ...transform, scaleX: 1.2, scaleY: 0.8 },
            appearance,
          )}>Squish</button>
          <button type="button" onClick={() => onApplyStyle(
            transform,
            { ...appearance, saturation: 1.5, brightness: 1.08 },
          )}>Vivid</button>
          <button type="button" onClick={() => onApplyStyle(
            transform,
            { ...appearance, outline: { width: 0.025, color: '#ffffff' } },
          )}>Sticker</button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Transform</legend>
        <Slider label="Position X" min={DESIGN_LIMITS.x[0]} max={DESIGN_LIMITS.x[1]}
          step={0.01} displayScale={100} suffix="%" defaultValue={DEFAULT_TRANSFORM.x}
          value={transform.x} onChange={(value, group) => setTransform('x', value, group)}
          onCommit={onCommit} />
        <Slider label="Position Y" min={DESIGN_LIMITS.y[0]} max={DESIGN_LIMITS.y[1]}
          step={0.01} displayScale={100} suffix="%" defaultValue={DEFAULT_TRANSFORM.y}
          value={transform.y} onChange={(value, group) => setTransform('y', value, group)}
          onCommit={onCommit} />
        <Slider label="Rotate" min={DESIGN_LIMITS.rotate[0]} max={DESIGN_LIMITS.rotate[1]}
          value={transform.rotate} suffix="°" defaultValue={DEFAULT_TRANSFORM.rotate}
          onChange={(value, group) => setTransform('rotate', value, group)}
          onCommit={onCommit} />
        <Slider label="Size" min={DESIGN_LIMITS.scaleX[0]} max={DESIGN_LIMITS.scaleX[1]}
          step={0.05} suffix="×" defaultValue={1} value={size} onChange={setSize}
          onCommit={onCommit} />
      </fieldset>

      <fieldset>
        <legend>Color and edge</legend>
        <Slider label="Hue" min={DESIGN_LIMITS.hue[0]} max={DESIGN_LIMITS.hue[1]}
          value={appearance.hue} suffix="°" defaultValue={DEFAULT_APPEARANCE.hue}
          onChange={(value, group) => setAppearance('hue', value, group)}
          onCommit={onCommit} />
        <Slider label="Saturation" min={DESIGN_LIMITS.saturation[0]}
          max={DESIGN_LIMITS.saturation[1]} step={0.05} suffix="×"
          defaultValue={DEFAULT_APPEARANCE.saturation} value={appearance.saturation}
          onChange={(value, group) => setAppearance('saturation', value, group)}
          onCommit={onCommit} />
        <Slider label="Brightness" min={DESIGN_LIMITS.brightness[0]}
          max={DESIGN_LIMITS.brightness[1]} step={0.05} suffix="×"
          defaultValue={DEFAULT_APPEARANCE.brightness} value={appearance.brightness}
          onChange={(value, group) => setAppearance('brightness', value, group)}
          onCommit={onCommit} />
        <Slider label="Blur" min={DESIGN_LIMITS.blur[0]} max={DESIGN_LIMITS.blur[1]}
          step={0.0025} displayScale={100} suffix="%" defaultValue={DEFAULT_APPEARANCE.blur}
          value={appearance.blur} onChange={(value, group) => setAppearance('blur', value, group)}
          onCommit={onCommit} />
        <div className="outline-controls">
          <label>
            <input
              type="checkbox"
              checked={appearance.outline !== null}
              onChange={(event) => {
                setAppearance(
                  'outline',
                  event.target.checked ? { width: 0.025, color: '#000000' } : null,
                  'control:outline',
                );
                onCommit();
              }}
            />
            Outline
          </label>
          {outline && (
            <>
              <label className="color-control">
                <span>Outline color</span>
                <input
                  type="color"
                  value={outline.color}
                  onChange={(event) =>
                    setAppearance('outline', {
                      width: outline.width,
                      color: event.target.value,
                    }, 'control:outline-color')
                  }
                  onBlur={onCommit}
                />
              </label>
              <Slider
                label="Outline width"
                min={0.005}
                max={DESIGN_LIMITS.outlineWidth[1]}
                step={0.0025}
                displayScale={100}
                suffix="%"
                value={outline.width}
                defaultValue={0.025}
                onChange={(value, group) =>
                  setAppearance('outline', { color: outline.color, width: value }, group)
                }
                onCommit={onCommit}
              />
            </>
          )}
        </div>
      </fieldset>

      <details className="advanced-controls">
        <summary>Advanced transforms</summary>
        <label className="lock-control">
          <input type="checkbox" checked={proportionsLocked}
            onChange={(event) => onProportionsLockedChange(event.target.checked)} />
          Lock proportions
        </label>
        <Slider label="Scale X" min={DESIGN_LIMITS.scaleX[0]} max={DESIGN_LIMITS.scaleX[1]}
          step={0.05} suffix="×" defaultValue={DEFAULT_TRANSFORM.scaleX}
          disabled={proportionsLocked} value={transform.scaleX}
          onChange={(value, group) => setTransform('scaleX', value, group)} onCommit={onCommit} />
        <Slider label="Scale Y" min={DESIGN_LIMITS.scaleY[0]} max={DESIGN_LIMITS.scaleY[1]}
          step={0.05} suffix="×" defaultValue={DEFAULT_TRANSFORM.scaleY}
          disabled={proportionsLocked} value={transform.scaleY}
          onChange={(value, group) => setTransform('scaleY', value, group)} onCommit={onCommit} />
        <Slider label="Skew X" min={DESIGN_LIMITS.skewX[0]} max={DESIGN_LIMITS.skewX[1]}
          suffix="°" defaultValue={DEFAULT_TRANSFORM.skewX} value={transform.skewX}
          onChange={(value, group) => setTransform('skewX', value, group)} onCommit={onCommit} />
        <Slider label="Skew Y" min={DESIGN_LIMITS.skewY[0]} max={DESIGN_LIMITS.skewY[1]}
          suffix="°" defaultValue={DEFAULT_TRANSFORM.skewY} value={transform.skewY}
          onChange={(value, group) => setTransform('skewY', value, group)} onCommit={onCommit} />
        <div className="toggle-row">
          <label>
            <input type="checkbox" checked={transform.flipH}
              onChange={(event) => {
                setTransform('flipH', event.target.checked, 'control:flip-h');
                onCommit();
              }} />
            Flip horizontally
          </label>
          <label>
            <input type="checkbox" checked={transform.flipV}
              onChange={(event) => {
                setTransform('flipV', event.target.checked, 'control:flip-v');
                onCommit();
              }} />
            Flip vertically
          </label>
        </div>
      </details>
    </div>
  );
}
