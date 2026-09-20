import { useRef, useState } from 'react';
import { MousePointer2, Type, Brush, Eraser, PaintBucket, Hand, RectangleHorizontal,
  Circle, Slash, Grid3X3, Plus, ChevronDown, Ellipsis, type LucideIcon } from 'lucide-react';
import type { EditorTool } from './editor/contracts';

type ShapeTool = 'rectangle' | 'ellipse' | 'line';
const SHAPES: Record<ShapeTool, { label: string; icon: LucideIcon; shortcut: string }> = {
  rectangle: { label: 'Rectangle', icon: RectangleHorizontal, shortcut: 'R' },
  ellipse: { label: 'Ellipse', icon: Circle, shortcut: 'O' },
  line: { label: 'Line', icon: Slash, shortcut: 'L' },
};
interface Props {
  readonly tool: EditorTool;
  readonly showGrid: boolean;
  readonly onToggleGrid: () => void;
  readonly groupName: string | null;
  readonly onFinishGroupEdit: () => void;
  readonly onToolChange: (tool: EditorTool) => void;
}

export default function CanvasTools({ tool, showGrid, onToggleGrid, groupName, onFinishGroupEdit, onToolChange }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [shapesOpen, setShapesOpen] = useState(false);
  const [lastShape, setLastShape] = useState<ShapeTool>('rectangle');
  const shapeToggle = useRef<HTMLButtonElement>(null);
  const shape = tool === 'rectangle' || tool === 'ellipse' || tool === 'line' ? tool : lastShape;
  const mode = (value: EditorTool, label: string, shortcut: string, Icon: LucideIcon) => (
    <button type="button" aria-label={label} aria-pressed={tool === value} title={`${label} (${shortcut})`}
      onClick={() => onToolChange(value)}>
      <span className="tool-icon"><Icon size={19} aria-hidden="true" />
        {value === 'restore' && <Plus size={10} className="restore-badge" aria-hidden="true" />}</span>
      <span className="tool-label">{label}</span>
    </button>
  );
  return <div className="canvas-tools-shell">
    <div className="canvas-tools" aria-label="Canvas tools" inert={groupName !== null}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && shapesOpen) {
          event.stopPropagation(); setShapesOpen(false); shapeToggle.current?.focus();
        }
      }}>
      <div className="primary-tools">
        {mode('select', 'Select', 'V', MousePointer2)}
        {mode('text', 'Text', 'T', Type)}
        <div className="shape-tools">
          {mode(shape, SHAPES[shape].label, SHAPES[shape].shortcut, SHAPES[shape].icon)}
          <button type="button" ref={shapeToggle} className="shape-toggle" aria-label="Shape options"
            title="Choose a shape" aria-expanded={shapesOpen} aria-controls="shape-options"
            onClick={() => setShapesOpen(!shapesOpen)}><ChevronDown size={12} aria-hidden="true" /></button>
          {shapesOpen && <div className="shape-options" id="shape-options">
            {(Object.keys(SHAPES) as ShapeTool[]).map((candidate) => {
              const { label, icon: Icon, shortcut } = SHAPES[candidate];
              return <button type="button" key={candidate} aria-label={`Use ${label.toLowerCase()}`}
                aria-pressed={tool === candidate} title={`${label} (${shortcut})`}
                onClick={() => { setLastShape(candidate); onToolChange(candidate); setShapesOpen(false); }}>
                <Icon size={18} aria-hidden="true" />{label}
              </button>;
            })}
          </div>}
        </div>
        {mode('brush', 'Brush', 'B', Brush)}
        {mode('eraser', 'Erase', 'E', Eraser)}
        <button type="button" aria-label="Grid" title="Toggle grid" aria-pressed={showGrid} onClick={onToggleGrid}>
          <Grid3X3 size={19} aria-hidden="true" /><span className="tool-label">Grid</span>
        </button>
        <button type="button" className="more-tools-toggle" aria-label="More" title="More tools"
          aria-expanded={moreOpen} aria-controls="secondary-tools" data-active={['restore', 'fill', 'pan'].includes(tool)}
          onClick={() => setMoreOpen(!moreOpen)}><Ellipsis size={19} aria-hidden="true" /><span className="tool-label">More</span></button>
      </div>
      <div className="secondary-tools" id="secondary-tools" data-open={moreOpen}>
        {mode('restore', 'Restore', '⇧E', Brush)}
        {mode('fill', 'Fill', 'F', PaintBucket)}
        {mode('pan', 'Pan', 'H', Hand)}
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
