import { bubblePaths } from '../domain/textBubble';
import { canvasTextLayout, fitCanvasText } from './textLayout';
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
  const input = useRef<HTMLTextAreaElement>(null);
  const finished = useRef(false);
  useLayoutEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const finish = (value: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onFinish(value);
  };
  const draft = fitCanvasText({ ...layer, text: text || ' ' });
  const layout = canvasTextLayout(draft);
  const { a, b, c, d, e, f } = layerLocalToWorldMatrix(layer);
  return <svg className="canvas-text-transform" viewBox={`0 0 ${size} ${size}`}>
    <g transform={`matrix(${a} ${b} ${c} ${d} ${e * size} ${f * size})`}>
    {bubblePaths(draft).map((path, index) => <path key={index} d={path}
      transform={`scale(${size})`} fill="white" stroke="#111" strokeWidth="0.004" />)}
    <foreignObject x={(draft.bounds.x + layout.padding) * size} y={(draft.bounds.y + layout.padding) * size}
      width={layout.width * size} height={(draft.bounds.height - layout.padding * 2) * size}>
    <textarea ref={input} rows={1} className="canvas-text-editor" aria-label="Edit canvas text"
      maxLength={500} value={text} spellCheck={false}
      style={{ fontSize: draft.fontSize * size, fontFamily: layer.fontFamily,
        textAlign: layer.align, color: layer.color }}
      onChange={(event) => setText(event.target.value)}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Escape') {
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
