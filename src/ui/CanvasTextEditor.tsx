import { useLayoutEffect, useRef, useState } from 'react';
import type { TextLayer } from '../domain/design';
import { layerLocalToWorldMatrix } from '../domain/sceneGeometry';

/** A local draft: one history entry on commit, no document mutation on Escape. */
export default function CanvasTextEditor({ layer, size, onFinish }: {
  readonly layer: TextLayer;
  readonly size: number;
  readonly onFinish: (text: string | null) => void;
}) {
  const [text, setText] = useState(layer.text);
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useLayoutEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const finish = (value: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onFinish(value);
  };
  const { a, b, c, d, e, f } = layerLocalToWorldMatrix(layer);
  return <svg className="canvas-text-transform" viewBox={`0 0 ${size} ${size}`}>
    <g transform={`matrix(${a} ${b} ${c} ${d} ${e * size} ${f * size})`}>
    <foreignObject x={layer.bounds.x * size} y={layer.bounds.y * size}
      width={layer.bounds.width * size} height={layer.fontSize * size}>
    <input ref={input} className="canvas-text-editor" aria-label="Edit canvas text"
      maxLength={500} value={text} spellCheck={false}
      style={{ fontSize: layer.fontSize * size, fontFamily: layer.fontFamily,
        textAlign: layer.align, color: layer.color }}
      onChange={(event) => setText(event.target.value)}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault();
          finish(event.key === 'Escape' ? null : text);
        }
      }}
      onKeyUp={(event) => event.stopPropagation()}
      onBlur={() => finish(text)} />
    </foreignObject>
    </g>
  </svg>;
}
