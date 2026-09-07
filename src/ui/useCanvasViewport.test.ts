import { createElement, useLayoutEffect, type PointerEvent, type WheelEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCanvasViewport } from './useCanvasViewport';

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.replaceChildren();
});

const pointer = (pointerId: number, clientX: number, clientY: number, pointerType = 'touch') => ({
  pointerId, clientX, clientY, pointerType, preventDefault: vi.fn(),
}) as unknown as PointerEvent;

const mountViewport = async () => {
  const stage = document.createElement('div');
  stage.setPointerCapture = vi.fn();
  stage.getBoundingClientRect = () => ({ left: 10, top: 20, width: 400, height: 400 }) as DOMRect;
  const stageRef = { current: stage };
  const container = document.createElement('div');
  document.body.append(stage, container);
  let result: ReturnType<typeof useCanvasViewport> | undefined;
  function Harness() {
    const viewport = useCanvasViewport(stageRef);
    useLayoutEffect(() => { result = viewport; });
    return null;
  }
  root = createRoot(container);
  root.render(createElement(Harness));
  await vi.waitFor(() => expect(result).toBeDefined());
  return {
    stage,
    get current() { return result!; },
  };
};

describe('canvas viewport gestures', () => {
  it('leaves one touch to the tool and zooms around the moving midpoint when a second arrives', async () => {
    const hook = await mountViewport();
    expect(hook.current.beginTouch(pointer(1, 90, 100))).toBe(false);
    expect(hook.current.continueTouch(pointer(1, 90, 100))).toBe(false);
    const originalPoint = hook.current.pointInCanvas(pointer(1, 170, 100));
    expect(hook.current.beginTouch(pointer(2, 250, 100))).toBe(true);
    expect(hook.current.continueTouch(pointer(2, 410, 100))).toBe(true);
    await vi.waitFor(() => expect(hook.current.viewport.zoom).toBe(2));
    const anchoredPoint = hook.current.pointInCanvas(pointer(1, 250, 100));
    expect(anchoredPoint?.x).toBeCloseTo(originalPoint!.x);
    expect(anchoredPoint?.y).toBeCloseTo(originalPoint!.y);
    expect(hook.current.viewport.panX).toBeCloseTo(0.3);
    expect(hook.current.viewport.panY).toBeCloseTo(0.3);
    expect(hook.stage.setPointerCapture).toHaveBeenCalledWith(1);
    expect(hook.stage.setPointerCapture).toHaveBeenCalledWith(2);
  });

  it('keeps the remaining touch in pan mode and returns to normal tools only after every finger lifts', async () => {
    const hook = await mountViewport();
    hook.current.beginTouch(pointer(1, 90, 100));
    hook.current.beginTouch(pointer(2, 250, 100));
    hook.current.continueTouch(pointer(2, 410, 100));
    expect(hook.current.endTouch(pointer(2, 410, 100))).toBe(true);
    expect(hook.current.continueTouch(pointer(1, 130, 140))).toBe(true);
    await vi.waitFor(() => expect(hook.current.viewport.panX).toBeCloseTo(0.4));
    expect(hook.current.viewport).toMatchObject({ zoom: 2 });
    expect(hook.current.viewport.panY).toBeCloseTo(0.4);
    expect(hook.current.beginTouch(pointer(3, 290, 140))).toBe(true);
    hook.current.continueTouch(pointer(3, 290, 140));
    expect(hook.current.pointInCanvas(pointer(1, 210, 140))?.x).toBeCloseTo(0.3);
    expect(hook.current.endTouch(pointer(1, 130, 140))).toBe(true);
    expect(hook.current.endTouch(pointer(3, 290, 140))).toBe(true);
    expect(hook.current.beginTouch(pointer(4, 210, 220))).toBe(false);
    expect(hook.current.endTouch(pointer(4, 210, 220))).toBe(false);
  });

  it('clamps pinch zoom while keeping the midpoint anchored', async () => {
    const hook = await mountViewport();
    hook.current.beginTouch(pointer(1, 190, 180));
    hook.current.beginTouch(pointer(2, 230, 180));
    const anchor = hook.current.pointInCanvas(pointer(1, 210, 180));
    hook.current.continueTouch(pointer(1, 10, 180));
    hook.current.continueTouch(pointer(2, 410, 180));
    await vi.waitFor(() => expect(hook.current.viewport.zoom).toBe(4));
    expect(hook.current.pointInCanvas(pointer(1, 210, 180))?.y).toBeCloseTo(anchor!.y);
    hook.current.continueTouch(pointer(1, 209, 180));
    hook.current.continueTouch(pointer(2, 211, 180));
    await vi.waitFor(() => expect(hook.current.viewport.zoom).toBe(0.5));
    expect(hook.current.pointInCanvas(pointer(1, 210, 180))?.y).toBeCloseTo(anchor!.y);
  });

  it('reanchors when a pinch finger leaves while a third touch remains', async () => {
    const hook = await mountViewport();
    hook.current.beginTouch(pointer(1, 90, 220));
    hook.current.beginTouch(pointer(2, 250, 220));
    hook.current.continueTouch(pointer(2, 330, 220));
    hook.current.beginTouch(pointer(3, 410, 220));
    const before = hook.current.pointInCanvas(pointer(1, 370, 220));
    expect(hook.current.endTouch(pointer(1, 90, 220))).toBe(true);
    hook.current.continueTouch(pointer(3, 410, 220));
    expect(hook.current.pointInCanvas(pointer(1, 370, 220))?.x).toBeCloseTo(before!.x);
    hook.current.continueTouch(pointer(3, 450, 220));
    await vi.waitFor(() => expect(hook.current.viewport.zoom).toBeCloseTo(2.25));
  });

  it('keeps mouse panning and pointer-anchored wheel zoom independent of touch tracking', async () => {
    const hook = await mountViewport();
    expect(hook.current.beginTouch(pointer(1, 210, 220, 'mouse'))).toBe(false);
    expect(hook.current.beginPan(pointer(1, 210, 220, 'mouse'))).toBe(true);
    hook.current.continuePan(pointer(1, 250, 180, 'mouse'));
    expect(hook.current.endPan(pointer(1, 250, 180, 'mouse'))).toBe(true);
    const anchor = hook.current.pointInCanvas(pointer(1, 330, 140, 'mouse'));
    hook.current.zoomWithWheel({ ctrlKey: true, clientX: 330, clientY: 140, deltaY: -100,
      preventDefault: vi.fn() } as unknown as WheelEvent<HTMLDivElement>);
    const after = hook.current.pointInCanvas(pointer(1, 330, 140, 'mouse'));
    expect(after?.x).toBeCloseTo(anchor!.x);
    expect(after?.y).toBeCloseTo(anchor!.y);
    await vi.waitFor(() => expect(hook.current.viewport.zoom).toBeGreaterThan(1));
  });

  it('cleans up a cancelled single touch without leaving it in a future pinch', async () => {
    const hook = await mountViewport();
    hook.current.beginTouch(pointer(1, 90, 100));
    expect(hook.current.endTouch(pointer(1, 90, 100))).toBe(false);
    expect(hook.current.beginTouch(pointer(2, 250, 100))).toBe(false);
    expect(hook.current.continueTouch(pointer(1, 90, 100))).toBe(false);
    expect(hook.current.viewport.zoom).toBe(1);
  });
});
