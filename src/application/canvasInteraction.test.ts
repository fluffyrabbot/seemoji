import { expect, it } from 'vitest';
import { CanvasInteractionStore } from './canvasInteraction';

const marquee = { pointerId: 1, start: { x: 0, y: 0 }, current: { x: 0.1, y: 0.1 }, additive: false };
it('has one artwork interaction, ignores unrelated pointers, and finishes exactly once', () => {
  const store = new CanvasInteractionStore();
  store.begin('marquee', marquee);
  store.update('marquee', { ...marquee, pointerId: 2 });
  expect(store.read('marquee')).toBe(marquee);
  expect(store.finish(2).kind).toBe('idle');
  expect(store.read('marquee')).toBe(marquee);
  expect(store.finish(1).kind).toBe('marquee');
  expect(store.finish(1).kind).toBe('idle');
});
it('navigation and scope cancellation discard drafts and stale updates cannot revive them', () => {
  const store = new CanvasInteractionStore();
  store.begin('marquee', marquee);
  store.cancel();
  store.update('marquee', { ...marquee, current: { x: 0.9, y: 0.9 } });
  expect(store.getSnapshot()).toEqual({ kind: 'idle' });
  store.begin('placement', { ...marquee, tool: 'text', id: 'text', color: '#000000', shiftKey: false, altKey: false });
  expect(store.read('marquee')).toBeNull();
  expect(store.cancel().kind).toBe('placement');
});
