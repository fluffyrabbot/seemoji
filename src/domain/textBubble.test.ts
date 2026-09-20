import { describe, expect, it } from 'vitest';
import { bubblePaths, fitText, setTextBubble, textLayout } from './textBubble';
import { DEFAULT_DESIGN, DEFAULT_TRANSFORM, type TextLayer } from './design';
import { decodeDesignDocument } from './designCodec';
import { layerLocalBounds } from './sceneGeometry';

const text: TextLayer = { id: 'text', kind: 'text', name: 'Text', visible: true, opacity: 1,
  transform: DEFAULT_TRANSFORM, mask: [], bounds: { x: 0.2, y: 0.3, width: 0.5, height: 0.2 },
  text: 'Hello world\nNext line', fontSize: 0.08, fontFamily: 'sans-serif', align: 'center', color: '#000000' };
const measure = (value: string, size: number) => Array.from(value).length * size * 0.5;

describe('text bubbles', () => {
  it('wraps words, explicit newlines, and long Unicode words without dropping characters', () => {
    const layout = textLayout(setTextBubble(text, 'speech'), measure);
    expect(layout.lines).toEqual(['Hello', 'world', 'Next line']);
    const emoji = { ...text, text: '😀'.repeat(20) };
    const wrapped = textLayout(emoji, measure);
    expect(wrapped.lines.join('')).toBe(emoji.text);
    expect(wrapped.lines.every((line) => measure(line, text.fontSize) <= text.bounds.width)).toBe(true);
  });
  it('shrinks text to fit padding while preserving the box and tail', () => {
    const fitted = fitText(setTextBubble(text, 'speech'), measure);
    expect(fitted.bounds).toEqual(text.bounds);
    expect(fitted.fontSize).toBeLessThan(text.fontSize);
    expect(textLayout(fitted, measure).height).toBeLessThanOrEqual(fitted.bounds.height);
    expect(fitted.bubble!.tail.y).toBeGreaterThan(fitted.bounds.y + fitted.bounds.height);
    expect(fitted.text).toBe(text.text);
  });
  it('keeps long text within page limits and retains the complete text value', () => {
    const fitted = fitText(setTextBubble({ ...text, text: 'long words '.repeat(40), bounds: { ...text.bounds, y: 0.8 } }, 'thought'), measure);
    expect(fitted.bounds).toEqual({ ...text.bounds, y: 0.8 });
    expect(textLayout(fitted, measure).height).toBeLessThanOrEqual(text.bounds.height);
    expect(fitted.text).toBe('long words '.repeat(40));
  });
  it('fits even a narrow box without dropping text or changing the preferred size', () => {
    const source = { ...text, text: 'W'.repeat(500), bounds: { x: 0, y: 0, width: 0.001, height: 0.001 } };
    const fitted = fitText(source, measure);
    const layout = textLayout(fitted, measure);
    expect(layout.height).toBeLessThanOrEqual(source.bounds.height);
    expect(layout.lines.every((line) => measure(line, fitted.fontSize) <= layout.width)).toBe(true);
    expect(layout.lines.join('')).toBe(source.text);
    expect(source.fontSize).toBe(text.fontSize);
  });
  it('switches styles and removes the bubble without replacing the object or its text', () => {
    const speech = setTextBubble(text, 'speech');
    const thought = setTextBubble(speech, 'thought');
    expect(thought.bubble!.tail).toEqual(speech.bubble!.tail);
    expect(setTextBubble(thought, 'plain')).toEqual(text);
    expect(bubblePaths(speech)).toHaveLength(1);
    expect(bubblePaths(thought)).toHaveLength(4);
    expect(layerLocalBounds(speech).height).toBeGreaterThan(text.bounds.height);
  });
  it('migrates V4 comic scenes with plain text without changing artwork', () => {
    const design = { ...DEFAULT_DESIGN, canvas: { ...DEFAULT_DESIGN.canvas, layout: 'comic4' as const }, layers: [...DEFAULT_DESIGN.layers, text] };
    expect(decodeDesignDocument({ ...design, version: 4 })).toEqual({ ok: true, value: design });
  });
  it('round-trips bubble state and rejects malformed tails', () => {
    const design = { ...DEFAULT_DESIGN, layers: [...DEFAULT_DESIGN.layers, setTextBubble(text, 'speech')] };
    expect(decodeDesignDocument(design)).toEqual({ ok: true, value: design });
    for (const bubble of [null, { kind: 'other' }, { kind: 'speech', tail: { x: NaN, y: 0.2 } }, { kind: 'thought', tail: { x: 2, y: 0 } }]) {
      expect(decodeDesignDocument({ ...design, layers: [...DEFAULT_DESIGN.layers, { ...text, bubble }] }).ok).toBe(false);
    }
  });
});
