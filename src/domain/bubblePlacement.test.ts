import { describe, it, expect } from 'vitest';
import { DEFAULT_DESIGN, DEFAULT_TRANSFORM, type TextLayer } from './design';
import { comicPanels, emojiSpawnTransform } from './canvasLayout';
import { placeTextBubble } from './bubblePlacement';
import { layerWorldBounds, layerLocalPointToWorld } from './sceneGeometry';
import { decodeDesignDocument } from './designCodec';

const text: TextLayer = { id: 'text', kind: 'text', name: 'Text', visible: true, opacity: 1,
  transform: DEFAULT_TRANSFORM, mask: [], bounds: { x: 0.02, y: 0.05, width: 0.6, height: 0.24 },
  text: 'Hello there', fontSize: 0.18, fontFamily: 'sans-serif', align: 'center', color: '#000000' };

describe('initial bubble placement', () => {
  it.each(['comic4', 'comic6'] as const)('fits a new bubble within %s margins and points toward its speaker', (layout) => {
    const emoji = { ...DEFAULT_DESIGN.layers[0]!, transform: emojiSpawnTransform(layout) };
    const design = { ...DEFAULT_DESIGN, canvas: { layout }, layers: [emoji, text] };
    const placed = placeTextBubble(text, 'speech', design);
    const panel = comicPanels(layout)[0]!;
    const box = layerWorldBounds(placed);
    expect(box.left).toBeGreaterThan(panel.x);
    expect(box.top).toBeGreaterThan(panel.y);
    expect(box.right).toBeLessThan(panel.x + panel.width);
    expect(box.bottom).toBeLessThan(panel.y + panel.height);
    const tip = layerLocalPointToWorld(placed, placed.bubble!.tail);
    const speaker = { x: emoji.transform.x + 0.5, y: emoji.transform.y + 0.5 };
    const body = layerLocalPointToWorld(placed, { x: placed.bounds.x + placed.bounds.width / 2, y: placed.bounds.y + placed.bounds.height / 2 });
    expect(Math.hypot(tip.x - speaker.x, tip.y - speaker.y)).toBeLessThan(Math.hypot(body.x - speaker.x, body.y - speaker.y));
    expect(decodeDesignDocument({ ...design, layers: [emoji, placed] }).ok).toBe(true);
    expect(placed.text).toBe(text.text);
    expect(placed.fontSize).toBe(text.fontSize);
  });
  it('ignores hidden speakers and emoji in other panels', () => {
    const design = { ...DEFAULT_DESIGN, canvas: { layout: 'comic4' as const }, layers: [text] };
    const baseline = placeTextBubble(text, 'thought', design);
    const hidden = { ...DEFAULT_DESIGN.layers[0]!, visible: false, transform: emojiSpawnTransform('comic4') };
    const elsewhere = { ...hidden, id: 'other', visible: true, transform: { ...hidden.transform, x: 0.25, y: 0.25 } };
    expect(placeTextBubble(text, 'thought', { ...design, layers: [text, hidden, elsewhere] })).toEqual(baseline);
  });
  it('preserves manual geometry on subsequent style changes', () => {
    const speech = placeTextBubble(text, 'speech', DEFAULT_DESIGN);
    const manual = { ...speech, bubble: { ...speech.bubble!, tail: { x: 0.9, y: 0.8 } } };
    const thought = placeTextBubble(manual, 'thought', { ...DEFAULT_DESIGN, canvas: { layout: 'comic6' } });
    expect(thought.bounds).toEqual(manual.bounds);
    expect(thought.transform).toEqual(manual.transform);
    expect(thought.bubble!.tail).toEqual(manual.bubble!.tail);
    expect(placeTextBubble(thought, 'plain', DEFAULT_DESIGN).bubble).toBeUndefined();
  });
  it('retains rotation when fitting a panel', () => {
    const rotated = { ...text, transform: { ...text.transform, rotate: 30 } };
    const placed = placeTextBubble(rotated, 'speech', { ...DEFAULT_DESIGN, canvas: { layout: 'comic6' }, layers: [rotated] });
    expect(placed.transform.rotate).toBe(30);
    expect(decodeDesignDocument({ ...DEFAULT_DESIGN, layers: [...DEFAULT_DESIGN.layers, placed] }).ok).toBe(true);
  });
});
