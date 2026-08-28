import { useEffect, useRef, useState } from 'react';
import { EXPORT_SIZES, type ExportSize } from '../application/editor';
import type { AppServices } from '../application/services';
import type { DesignDocument } from '../domain/design';
import type { Notice } from './App';

interface Props {
  readonly design: DesignDocument;
  readonly size: ExportSize;
  readonly services: AppServices;
  readonly onSizeChange: (size: ExportSize) => void;
  readonly onNotice: (notice: Notice) => void;
}

export default function Preview({
  design,
  size,
  services,
  onSizeChange,
  onNotice,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderSequence = useRef(0);
  const renderKey = `${size}:${JSON.stringify(design)}`;
  const [prepared, setPrepared] = useState<{ readonly key: string; readonly blob: Blob } | null>(
    null,
  );
  const [copying, setCopying] = useState(false);
  const png = prepared?.key === renderKey ? prepared.blob : null;
  const rendering = png === null;

  useEffect(() => {
    const sequence = ++renderSequence.current;
    services.renderer
      .render(design, size)
      .then((frame) => {
        if (sequence !== renderSequence.current || !canvasRef.current) return;
        const canvasContext = canvasRef.current.getContext('2d');
        if (!canvasContext) throw new Error('Canvas 2D rendering is unavailable');
        canvasContext.clearRect(0, 0, size, size);
        canvasContext.drawImage(frame.canvas, 0, 0);
        if (frame.warnings.length > 0) {
          onNotice({ kind: 'error', message: frame.warnings.join(' ') });
        }
        return services.renderer.png(design, size);
      })
      .then((prepared) => {
        if (sequence === renderSequence.current && prepared) {
          setPrepared({ key: renderKey, blob: prepared });
        }
      })
      .catch((cause: unknown) => {
        if (sequence === renderSequence.current) {
          onNotice({ kind: 'error', message: `Render failed: ${String(cause)}` });
        }
      })
  }, [design, size, services.renderer, onNotice, renderKey]);

  const copy = async () => {
    if (!png) return;
    setCopying(true);
    const outcome = await services.clipboard.writePng(png);
    setCopying(false);
    switch (outcome.kind) {
      case 'copied':
        onNotice({ kind: 'status', message: 'Copied. Paste it into Discord.' });
        break;
      case 'unsupported':
        onNotice({
          kind: 'error',
          message: 'PNG clipboard writes are unsupported here. Use Download PNG.',
        });
        break;
      case 'denied':
        onNotice({
          kind: 'error',
          message: 'Clipboard permission was denied. Use Download PNG.',
        });
        break;
      case 'failed':
        onNotice({ kind: 'error', message: `Copy failed: ${String(outcome.cause)}` });
        break;
    }
  };

  return (
    <div className="panel preview-panel">
      <div className="panel-heading">
        <div>
          <h2>Preview</h2>
          <p>Transparent PNG · {size}×{size}px</p>
        </div>
        <label className="size-control">
          <span>Export size</span>
          <select
            value={size}
            onChange={(event) => onSizeChange(Number(event.target.value) as ExportSize)}
          >
            {EXPORT_SIZES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}px
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="preview-stage" aria-busy={rendering}>
        <div className="checkerboard">
          <canvas
            ref={canvasRef}
            width={size}
            height={size}
            aria-label={`Preview of ${design.source.grapheme}`}
          />
        </div>
        {rendering && <span className="render-status">Rendering…</span>}
      </div>

      <div className="preview-actions">
        <button className="primary" disabled={!png || copying} onClick={() => void copy()}>
          {!png ? 'Preparing PNG…' : copying ? 'Copying…' : 'Copy PNG'}
        </button>
        <button
          disabled={!png}
          onClick={() => png && services.fileExport.downloadPng(png, 'seemoji.png')}
        >
          Download PNG
        </button>
      </div>
    </div>
  );
}
