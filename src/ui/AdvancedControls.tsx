import type { ComponentType } from 'react';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_TRANSFORM,
  DESIGN_LIMITS,
  type Appearance,
  type SceneLayer,
  type Transform,
} from '../domain/design';
import { selectionCenter } from './inspectorModel';
import type { ControlsProps, SliderProps } from './Controls';

export interface AdvancedControlsProps {
  readonly Slider: ComponentType<SliderProps>;
  readonly selection: readonly SceneLayer[];
  readonly proportionsLocked: boolean;
  readonly onProportionsLockedChange: ControlsProps['onProportionsLockedChange'];
  readonly onPositionChange: (axis: 'x' | 'y', value: number, historyGroup: string) => void;
  readonly setTransform: <Key extends keyof Transform>(key: Key, value: Transform[Key], historyGroup?: string) => void;
  readonly onAppearanceChange: ControlsProps['onAppearanceChange'];
  readonly onUpdateLayer: ControlsProps['onUpdateLayer'];
  readonly updateSingle: (layer: SceneLayer, historyGroup: string) => void;
  readonly historyGroup: (label: string) => string;
  readonly onCommit: () => void;
  readonly onTransformCommit: () => void;
}

/** Exact and less common fields, loaded only after the inspector disclosure opens. */
export default function AdvancedControls({
  Slider,
  selection,
  proportionsLocked,
  onProportionsLockedChange,
  onPositionChange,
  setTransform,
  onAppearanceChange,
  onUpdateLayer,
  updateSingle,
  historyGroup,
  onCommit,
  onTransformCommit,
}: AdvancedControlsProps) {
  const single = selection.length === 1 ? selection[0] : undefined;
  const transform = single?.transform;
  const position = transform ?? selectionCenter(selection);
  const emoji = single?.kind === 'emoji' ? single : undefined;
  const appearance = emoji?.appearance;
  const outline = appearance?.outline;
  const setAppearance = <Key extends keyof Appearance>(key: Key, value: Appearance[Key], label?: string) => {
    if (emoji) onAppearanceChange(emoji.id, { ...emoji.appearance, [key]: value }, label ? historyGroup(label) : undefined);
  };
  return <>
          {single && <div className="inspector-object-fields">
            <label><span>Name</span><input key={`${single.id}:${single.name}`} type="text" defaultValue={single.name}
              maxLength={80} onBlur={(event) => {
                const name = event.target.value.trim();
                if (name && name !== single.name) onUpdateLayer({ ...single, name });
                else event.target.value = single.name;
              }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
          </div>}
          <fieldset>
            <legend>Position{single ? '' : ' of selection'}</legend>
            <Slider label="Position X" min={DESIGN_LIMITS.x[0]} max={DESIGN_LIMITS.x[1]}
              step={0.01} displayScale={100} suffix="%" defaultValue={DEFAULT_TRANSFORM.x}
              value={position.x} onChange={(value, label) => onPositionChange('x', value, label)}
              onCommit={onTransformCommit} />
            <Slider label="Position Y" min={DESIGN_LIMITS.y[0]} max={DESIGN_LIMITS.y[1]}
              step={0.01} displayScale={100} suffix="%" defaultValue={DEFAULT_TRANSFORM.y}
              value={position.y} onChange={(value, label) => onPositionChange('y', value, label)}
              onCommit={onTransformCommit} />
          </fieldset>
          {single && <fieldset>
            <legend>Object</legend>
            <Slider label="Opacity" min={0} max={1} step={0.01} displayScale={100} suffix="%"
              defaultValue={1} value={single.opacity}
              onChange={(value, label) => updateSingle({ ...single, opacity: value }, label)} onCommit={onCommit} />
            {single.kind === 'text' && <>
              <Slider label="Font size" min={DESIGN_LIMITS.fontSize[0]} max={DESIGN_LIMITS.fontSize[1]}
                step={0.005} displayScale={100} suffix="%" defaultValue={0.18} value={single.fontSize}
                onChange={(value, label) => updateSingle({ ...single, fontSize: value }, label)} onCommit={onCommit} />
              <div className="inspector-object-fields">
                <label><span>Font</span><select value={single.fontFamily} onChange={(event) =>
                  onUpdateLayer({ ...single, fontFamily: event.target.value as typeof single.fontFamily })}>
                  <option value="sans-serif">Sans serif</option><option value="serif">Serif</option>
                  <option value="monospace">Monospace</option>
                </select></label>
                <label><span>Text alignment</span><select value={single.align} onChange={(event) =>
                  onUpdateLayer({ ...single, align: event.target.value as typeof single.align })}>
                  <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
                </select></label>
              </div>
            </>}
          </fieldset>}

          {appearance && <fieldset>
            <legend>Color and edge</legend>
            <Slider label="Hue" min={DESIGN_LIMITS.hue[0]} max={DESIGN_LIMITS.hue[1]}
              value={appearance.hue} suffix="°" defaultValue={DEFAULT_APPEARANCE.hue}
              onChange={(value, label) => setAppearance('hue', value, label)} onCommit={onCommit} />
            <Slider label="Saturation" min={DESIGN_LIMITS.saturation[0]} max={DESIGN_LIMITS.saturation[1]}
              step={0.05} suffix="×" defaultValue={DEFAULT_APPEARANCE.saturation} value={appearance.saturation}
              onChange={(value, label) => setAppearance('saturation', value, label)} onCommit={onCommit} />
            <Slider label="Brightness" min={DESIGN_LIMITS.brightness[0]} max={DESIGN_LIMITS.brightness[1]}
              step={0.05} suffix="×" defaultValue={DEFAULT_APPEARANCE.brightness} value={appearance.brightness}
              onChange={(value, label) => setAppearance('brightness', value, label)} onCommit={onCommit} />
            <Slider label="Blur" min={DESIGN_LIMITS.blur[0]} max={DESIGN_LIMITS.blur[1]}
              step={0.0025} displayScale={100} suffix="%" defaultValue={DEFAULT_APPEARANCE.blur} value={appearance.blur}
              onChange={(value, label) => setAppearance('blur', value, label)} onCommit={onCommit} />
            <div className="outline-controls">
              <label><input type="checkbox" checked={outline != null} onChange={(event) => {
                setAppearance('outline', event.target.checked ? { width: 0.025, color: '#ffffff' } : null);
              }} />Outline</label>
              {outline && <>
                <label className="color-control"><span>Outline color</span><input type="color" value={outline.color}
                  onChange={(event) => setAppearance('outline', { ...outline, color: event.target.value }, 'outline-color')}
                  onBlur={onCommit} onPointerUp={onCommit} /></label>
                <Slider label="Outline width" min={0.005} max={DESIGN_LIMITS.outlineWidth[1]}
                  step={0.0025} displayScale={100} suffix="%" value={outline.width} defaultValue={0.025}
                  onChange={(value, label) => setAppearance('outline', { ...outline, width: value }, label)} onCommit={onCommit} />
              </>}
            </div>
          </fieldset>}

          {transform && <details className="advanced-controls">
            <summary>Advanced transforms</summary>
            <label className="lock-control"><input type="checkbox" checked={proportionsLocked}
              onChange={(event) => onProportionsLockedChange(event.target.checked)} />Lock proportions</label>
            <Slider label="Scale X" min={DESIGN_LIMITS.scaleX[0]} max={DESIGN_LIMITS.scaleX[1]}
              step={0.05} suffix="×" defaultValue={DEFAULT_TRANSFORM.scaleX} disabled={proportionsLocked} value={transform.scaleX}
              onChange={(value, label) => setTransform('scaleX', value, label)} onCommit={onCommit} />
            <Slider label="Scale Y" min={DESIGN_LIMITS.scaleY[0]} max={DESIGN_LIMITS.scaleY[1]}
              step={0.05} suffix="×" defaultValue={DEFAULT_TRANSFORM.scaleY} disabled={proportionsLocked} value={transform.scaleY}
              onChange={(value, label) => setTransform('scaleY', value, label)} onCommit={onCommit} />
            <Slider label="Skew X" min={DESIGN_LIMITS.skewX[0]} max={DESIGN_LIMITS.skewX[1]}
              suffix="°" defaultValue={DEFAULT_TRANSFORM.skewX} value={transform.skewX}
              onChange={(value, label) => setTransform('skewX', value, label)} onCommit={onCommit} />
            <Slider label="Skew Y" min={DESIGN_LIMITS.skewY[0]} max={DESIGN_LIMITS.skewY[1]}
              suffix="°" defaultValue={DEFAULT_TRANSFORM.skewY} value={transform.skewY}
              onChange={(value, label) => setTransform('skewY', value, label)} onCommit={onCommit} />
            <div className="toggle-row"><label><input type="checkbox" checked={transform.flipV}
              onChange={(event) => setTransform('flipV', event.target.checked)} />Mirror vertically</label></div>
          </details>}
  </>;
}
