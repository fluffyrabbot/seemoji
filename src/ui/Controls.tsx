import { useId } from 'react';
import {
  DESIGN_LIMITS,
  type Appearance,
  type DesignDocument,
  type Transform,
} from '../domain/design';

interface SliderProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly format?: (value: number) => string;
  readonly onChange: (value: number) => void;
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  format = String,
  onChange,
}: SliderProps) {
  const id = useId();
  return (
    <div className="control-row">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output htmlFor={id}>{format(value)}</output>
    </div>
  );
}

interface Props {
  readonly design: DesignDocument;
  readonly onTransformChange: (transform: Transform) => void;
  readonly onAppearanceChange: (appearance: Appearance) => void;
  readonly onReset: () => void;
}

const degrees = (value: number) => `${value}°`;
const multiplier = (value: number) => `${value.toFixed(2)}×`;
const percentage = (value: number) => `${Math.round(value * 100)}%`;

export default function Controls({
  design,
  onTransformChange,
  onAppearanceChange,
  onReset,
}: Props) {
  const { transform, appearance } = design;
  const outline = appearance.outline;
  const setTransform = <Key extends keyof Transform>(key: Key, value: Transform[Key]) =>
    onTransformChange({ ...transform, [key]: value });
  const setAppearance = <Key extends keyof Appearance>(
    key: Key,
    value: Appearance[Key],
  ) => onAppearanceChange({ ...appearance, [key]: value });

  return (
    <div className="panel controls-panel">
      <h2>Tweak</h2>
      <fieldset>
        <legend>Shape</legend>
        <Slider label="Rotate" min={DESIGN_LIMITS.rotate[0]} max={DESIGN_LIMITS.rotate[1]}
          value={transform.rotate} format={degrees}
          onChange={(value) => setTransform('rotate', value)} />
        <Slider label="Scale X" min={DESIGN_LIMITS.scaleX[0]} max={DESIGN_LIMITS.scaleX[1]}
          step={0.05} value={transform.scaleX} format={multiplier}
          onChange={(value) => setTransform('scaleX', value)} />
        <Slider label="Scale Y" min={DESIGN_LIMITS.scaleY[0]} max={DESIGN_LIMITS.scaleY[1]}
          step={0.05} value={transform.scaleY} format={multiplier}
          onChange={(value) => setTransform('scaleY', value)} />
        <Slider label="Skew X" min={DESIGN_LIMITS.skewX[0]} max={DESIGN_LIMITS.skewX[1]}
          value={transform.skewX} format={degrees}
          onChange={(value) => setTransform('skewX', value)} />
        <Slider label="Skew Y" min={DESIGN_LIMITS.skewY[0]} max={DESIGN_LIMITS.skewY[1]}
          value={transform.skewY} format={degrees}
          onChange={(value) => setTransform('skewY', value)} />
        <div className="toggle-row">
          <label>
            <input type="checkbox" checked={transform.flipH}
              onChange={(event) => setTransform('flipH', event.target.checked)} />
            Flip horizontally
          </label>
          <label>
            <input type="checkbox" checked={transform.flipV}
              onChange={(event) => setTransform('flipV', event.target.checked)} />
            Flip vertically
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Color and edge</legend>
        <Slider label="Hue" min={DESIGN_LIMITS.hue[0]} max={DESIGN_LIMITS.hue[1]}
          value={appearance.hue} format={degrees}
          onChange={(value) => setAppearance('hue', value)} />
        <Slider label="Saturation" min={DESIGN_LIMITS.saturation[0]}
          max={DESIGN_LIMITS.saturation[1]} step={0.05} value={appearance.saturation}
          format={percentage} onChange={(value) => setAppearance('saturation', value)} />
        <Slider label="Brightness" min={DESIGN_LIMITS.brightness[0]}
          max={DESIGN_LIMITS.brightness[1]} step={0.05} value={appearance.brightness}
          format={percentage} onChange={(value) => setAppearance('brightness', value)} />
        <Slider label="Blur" min={DESIGN_LIMITS.blur[0]} max={DESIGN_LIMITS.blur[1]}
          step={0.0025} value={appearance.blur} format={percentage}
          onChange={(value) => setAppearance('blur', value)} />
        <div className="outline-controls">
          <label>
            <input
              type="checkbox"
              checked={appearance.outline !== null}
              onChange={(event) =>
                setAppearance(
                  'outline',
                  event.target.checked ? { width: 0.025, color: '#000000' } : null,
                )
              }
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
                    })
                  }
                />
              </label>
              <Slider
                label="Outline width"
                min={0.005}
                max={DESIGN_LIMITS.outlineWidth[1]}
                step={0.0025}
                value={outline.width}
                format={percentage}
                onChange={(value) =>
                  setAppearance('outline', { color: outline.color, width: value })
                }
              />
            </>
          )}
        </div>
      </fieldset>

      <button onClick={onReset}>Reset edits</button>
    </div>
  );
}
