import { EXPORT_SIZES } from '../application/editor';
import type { ExportBarRenderProps } from './editor/contracts';

export default function ExportBar({
  size,
  prepared,
  copying,
  onSizeChange,
  onCopy,
  onDownload,
}: ExportBarRenderProps) {
  return <div className="export-bar">
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
        Copy PNG
      </button>
      <button disabled={!prepared} onClick={onDownload}>Download PNG</button>
    </div>
  </div>;
}
