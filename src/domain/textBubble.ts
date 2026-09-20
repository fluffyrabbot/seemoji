import type { TextLayer } from './design';

export type BubbleKind = 'speech' | 'thought';
export interface TextBubble { readonly kind: BubbleKind; readonly speakerId?: string; readonly tail: { readonly x: number; readonly y: number } }
export type MeasureText = (text: string, fontSize: number) => number;

export function textLayout(layer: Pick<TextLayer, 'bounds' | 'fontSize' | 'text' | 'bubble'>, measure: MeasureText) {
  const padding = layer.bubble ? Math.min(layer.bounds.width * 0.2, layer.fontSize * 0.5) : 0;
  const width = Math.max(0.001, layer.bounds.width - padding * 2);
  const lines: string[] = [];
  for (const paragraph of layer.text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/(\s+)/u)) {
      if (measure(line + word, layer.fontSize) <= width) { line += word; continue; }
      if (line.trim()) { lines.push(line.trimEnd()); line = ''; }
      for (const character of Array.from(word.trimStart())) {
        if (line && measure(line + character, layer.fontSize) > width) { lines.push(line); line = ''; }
        line += character;
      }
    }
    lines.push(line.trimEnd());
  }
  const lineHeight = layer.fontSize * 1.2;
  return { lines, padding, width, lineHeight, height: lines.length * lineHeight + padding * 2 };
}

/** Keep the chosen box fixed. Font size is a ceiling; fit at render time without losing it. */
export function fitText<T extends Pick<TextLayer, 'bounds' | 'fontSize' | 'text' | 'bubble'>>(layer: T, measure: MeasureText): T {
  const fits = (fontSize: number) => {
    const layout = textLayout({ ...layer, fontSize }, measure);
    return layout.height <= layer.bounds.height
      && layout.lines.every((line) => measure(line, fontSize) <= layout.width);
  };
  if (fits(layer.fontSize)) return layer;
  let low = 0, high = layer.fontSize;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle; else high = middle;
  }
  return { ...layer, fontSize: Math.max(Number.EPSILON, low) };
}

export function setTextBubble(layer: TextLayer, kind: BubbleKind | 'plain'): TextLayer {
  const { bubble: previous, ...plain } = layer;
  if (kind === 'plain') return plain;
  const { x, y, width, height } = layer.bounds;
  return { ...layer, bubble: { kind, ...(previous?.speakerId ? { speakerId: previous.speakerId } : {}), tail: previous?.tail ?? {
    x: x + width * 0.25, y: y + height <= 0.92 ? y + height + 0.08 : Math.max(0, y - 0.08),
  } } };
}

/** One path source for canvas export and the editable SVG preview. */
export function bubblePaths(layer: Pick<TextLayer, 'bounds' | 'bubble'>): readonly string[] {
  if (!layer.bubble) return [];
  const { x, y, width: w, height: h } = layer.bounds;
  const { tail, kind } = layer.bubble;
  const cx = x + w / 2, cy = y + h / 2;
  if (kind === 'thought') {
    const count = 14, rx = w / 2, ry = h / 2;
    const point = (angle: number, radius: number) => `${cx + Math.cos(angle) * rx * radius} ${cy + Math.sin(angle) * ry * radius}`;
    let body = `M ${point(0, 0.88)}`;
    for (let i = 0; i < count; i++) body += ` Q ${point((i + 0.5) * Math.PI * 2 / count, 1.12)} ${point((i + 1) * Math.PI * 2 / count, 0.88)}`;
    body += ' Z';
    const dx = tail.x - cx, dy = tail.y - cy;
    const distance = Math.hypot(dx / rx, dy / ry);
    if (distance <= 1) return [body];
    const start = { x: cx + dx / distance, y: cy + dy / distance };
    const dots = [0.25, 0.6, 1].map((t, index) => {
      const px = start.x + (tail.x - start.x) * t, py = start.y + (tail.y - start.y) * t;
      const r = Math.min(w, h) * [0.045, 0.03, 0.018][index]!;
      return `M ${px - r} ${py} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
    });
    return [body, ...dots];
  }
  const r = Math.min(w, h) * 0.16, half = Math.min(w, h) * 0.1;
  const dx = (tail.x - cx) / w, dy = (tail.y - cy) / h;
  const inside = Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5;
  const side = inside ? '' : Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'bottom' : 'top';
  const tx = Math.max(x + r + half, Math.min(x + w - r - half, tail.x));
  const ty = Math.max(y + r + half, Math.min(y + h - r - half, tail.y));
  const tip = `${tail.x} ${tail.y}`;
  return [`M ${x + r} ${y} ${side === 'top' ? `L ${tx - half} ${y} L ${tip} L ${tx + half} ${y}` : ''}
    L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r}
    ${side === 'right' ? `L ${x + w} ${ty - half} L ${tip} L ${x + w} ${ty + half}` : ''}
    L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h}
    ${side === 'bottom' ? `L ${tx + half} ${y + h} L ${tip} L ${tx - half} ${y + h}` : ''}
    L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r}
    ${side === 'left' ? `L ${x} ${ty + half} L ${tip} L ${x} ${ty - half}` : ''}
    L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`];
}
