import { useState } from 'react';
import type { EditorTool } from './editor/contracts';

export type ShapeKind = 'rectangle' | 'ellipse' | 'line';
interface Props {
  readonly tool: EditorTool;
  readonly groupName: string | null;
  readonly onFinishGroupEdit: () => void;
  readonly onToolChange: (tool: EditorTool) => void;
  readonly onChooseEmoji: () => void;
  readonly onAddText: () => void;
  readonly onAddShape: (shape: ShapeKind) => void;
}

export default function CanvasTools({ tool, groupName, onFinishGroupEdit, onToolChange,
  onChooseEmoji, onAddText, onAddShape }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [shapesOpen, setShapesOpen] = useState(false);
  const mode = (value: EditorTool, label: string, shortcut: string) => (
    <button type="button" aria-pressed={tool === value} title={`${label} (${shortcut})`}
      onClick={() => onToolChange(value)}>{label}</button>
  );
  const secondaryActive = ['restore', 'fill', 'pan'].includes(tool);
  return <div className="canvas-tools-shell">
    <div className="canvas-tools" aria-label="Canvas tools" inert={groupName !== null}>
      <div className="primary-tools">
        {mode('select', 'Select', 'V')}
        <button type="button" aria-label="Choose emoji" onClick={onChooseEmoji}>Emoji</button>
        <button type="button" aria-label="Add text" title="Add text (T)" onClick={onAddText}>Text</button>
        {mode('brush', 'Brush', 'B')}
        {mode('eraser', 'Erase', 'E')}
        <button type="button" className="more-tools-toggle" aria-expanded={moreOpen}
          aria-controls="secondary-tools" data-active={secondaryActive}
          onClick={() => setMoreOpen(!moreOpen)}>More</button>
      </div>
      <div className="secondary-tools" id="secondary-tools" data-open={moreOpen}>
        <div className="shape-tools">
          <button type="button" aria-expanded={shapesOpen} aria-controls="shape-options"
            onClick={() => setShapesOpen(!shapesOpen)}>Shapes</button>
          {shapesOpen && <div className="shape-options" id="shape-options">
            {(['rectangle', 'ellipse', 'line'] as const).map((shape) => (
              <button type="button" key={shape} aria-label={`Add ${shape}`}
                onClick={() => { onAddShape(shape); setShapesOpen(false); }}>
                {shape[0]!.toUpperCase() + shape.slice(1)}
              </button>
            ))}
          </div>}
        </div>
        {mode('restore', 'Restore', '⇧E')}
        {mode('fill', 'Fill', 'F')}
        {mode('pan', 'Pan', 'H')}
      </div>
    </div>
    {groupName !== null && <div className="group-edit-banner" role="status">
      <strong title={`Editing group “${groupName}”`}>Editing group “{groupName}”</strong>
      <span className="sr-only">Select individual members. Escape returns to the group.</span>
      <button type="button" aria-label="Done editing group" title="Finish editing group (Escape)"
        onClick={onFinishGroupEdit}>Done</button>
    </div>}
  </div>;
}
