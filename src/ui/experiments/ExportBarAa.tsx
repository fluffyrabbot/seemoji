import { EXPORT_SIZES } from '../../application/editor';
import type { ExportBarRenderProps } from '../editor/contracts';

interface Props extends ExportBarRenderProps {
  readonly diagnosticVariant: 'control-a' | 'control-b';
}

export default function ExportBarAa({
  size,
  prepared,
  copying,
  onSizeChange,
  onCopy,
  onDownload,
  diagnosticVariant,
}: Props) {
  return <div className="export-bar" data-experiment-variant={diagnosticVariant}>
    <label className="size-control">
      <span>Export size</span>
      <select value={size}
        onChange={(event) => onSizeChange(Number(event.target.value) as typeof size)}>
        {EXPORT_SIZES.map((candidate) => (
          <option key={candidate} value={candidate}>{candidate} × {candidate}px</option>
        ))}
      </select>
    </label>
    <div className="preview-actions">
      <button className="primary" disabled={!prepared || copying} onClick={onCopy}>
        {!prepared ? 'Preparing PNG…' : copying ? 'Copying…' : 'Copy PNG'}
      </button>
      <button disabled={!prepared} onClick={onDownload}>Download PNG</button>
    </div>
  </div>;
}
