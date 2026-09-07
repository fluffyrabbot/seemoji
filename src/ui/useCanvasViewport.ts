import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
  type WheelEvent,
} from 'react';

export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

export interface CanvasViewportState {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

interface PanGesture {
  readonly pointerId: number;
  readonly start: CanvasPoint;
  readonly panX: number;
  readonly panY: number;
}

interface TouchPoint {
  readonly point: CanvasPoint;
  readonly clientX: number;
  readonly clientY: number;
}

interface PinchGesture {
  readonly pointerIds: readonly [number, number];
  readonly midpoint: CanvasPoint;
  readonly distance: number;
  readonly viewport: CanvasViewportState;
}

export function useCanvasViewport(stageRef: RefObject<HTMLDivElement | null>) {
  const spacePressed = useRef(false);
  useEffect(() => {
    const down = (event: globalThis.KeyboardEvent) => {
      if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof Element
          && event.target.closest('input, textarea, select, button, summary, [contenteditable="true"]')) return;
      spacePressed.current = true;
      event.preventDefault();
    };
    const up = (event: globalThis.KeyboardEvent) => {
      if (event.code === 'Space') spacePressed.current = false;
    };
    const blur = () => { spacePressed.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
  const panGesture = useRef<PanGesture | null>(null);
  const [viewport, setViewport] = useState<CanvasViewportState>({
    zoom: 1,
    panX: 0,
    panY: 0,
  });
  const viewportRef = useRef(viewport);
  const touches = useRef(new Map<number, TouchPoint>());
  const pinchGesture = useRef<PinchGesture | null>(null);
  const touchNavigation = useRef(false);
  const updateViewport = (next: CanvasViewportState | ((current: CanvasViewportState) => CanvasViewportState)) => {
    const value = typeof next === 'function' ? next(viewportRef.current) : next;
    viewportRef.current = value;
    setViewport(value);
  };
  const previewRenderSize = useMemo(
    () => Math.min(1024, Math.max(512, Math.round(512 * (window.devicePixelRatio || 1)))),
    [],
  );

  const pointInViewport = (event: PointerEvent): CanvasPoint | null => {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) return null;
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    };
  };

  const pointInCanvas = (event: PointerEvent): CanvasPoint | null => {
    const point = pointInViewport(event);
    if (!point) return null;
    const current = viewportRef.current;
    return {
      x: (point.x - 0.5 - current.panX) / current.zoom + 0.5,
      y: (point.y - 0.5 - current.panY) / current.zoom + 0.5,
    };
  };

  const beginPan = (event: PointerEvent): boolean => {
    const point = pointInViewport(event);
    if (!point || !stageRef.current) return false;
    event.preventDefault();
    stageRef.current.setPointerCapture(event.pointerId);
    panGesture.current = {
      pointerId: event.pointerId,
      start: point,
      panX: viewportRef.current.panX,
      panY: viewportRef.current.panY,
    };
    return true;
  };

  const continuePan = (event: PointerEvent): boolean => {
    const active = panGesture.current;
    if (active?.pointerId !== event.pointerId) return false;
    const point = pointInViewport(event);
    if (!point) return true;
    updateViewport((current) => ({
      ...current,
      panX: active.panX + point.x - active.start.x,
      panY: active.panY + point.y - active.start.y,
    }));
    return true;
  };

  const endPan = (event: PointerEvent): boolean => {
    if (panGesture.current?.pointerId !== event.pointerId) return false;
    panGesture.current = null;
    return true;
  };

  const startPinch = () => {
    const [first, second] = [...touches.current.entries()];
    if (!first || !second) return;
    pinchGesture.current = {
      pointerIds: [first[0], second[0]],
      midpoint: {
        x: (first[1].point.x + second[1].point.x) / 2,
        y: (first[1].point.y + second[1].point.y) / 2,
      },
      distance: Math.max(1, Math.hypot(
        first[1].clientX - second[1].clientX,
        first[1].clientY - second[1].clientY,
      )),
      viewport: viewportRef.current,
    };
    panGesture.current = null;
  };

  // The first touch remains available to the current tool. Once a second touch
  // arrives, every tracked finger navigates until the last one leaves.
  const beginTouch = (event: PointerEvent): boolean => {
    if (event.pointerType !== 'touch') return false;
    const point = pointInViewport(event);
    if (!point || !stageRef.current) return false;
    touches.current.set(event.pointerId, { point, clientX: event.clientX, clientY: event.clientY });
    stageRef.current.setPointerCapture(event.pointerId);
    if (touches.current.size < 2) return touchNavigation.current;
    event.preventDefault();
    touchNavigation.current = true;
    if (!pinchGesture.current) startPinch();
    return true;
  };

  const continueTouch = (event: PointerEvent): boolean => {
    if (event.pointerType !== 'touch' || !touches.current.has(event.pointerId)) return false;
    const point = pointInViewport(event);
    if (point) {
      touches.current.set(event.pointerId, { point, clientX: event.clientX, clientY: event.clientY });
    }
    if (!touchNavigation.current) return false;
    event.preventDefault();
    const active = pinchGesture.current;
    if (!active) {
      continuePan(event);
      return true;
    }
    const first = touches.current.get(active.pointerIds[0]);
    const second = touches.current.get(active.pointerIds[1]);
    if (!first || !second || !point) return true;
    const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
    const zoom = Math.min(4, Math.max(0.5, active.viewport.zoom * distance / active.distance));
    const ratio = zoom / active.viewport.zoom;
    updateViewport({
      zoom,
      panX: (first.point.x + second.point.x) / 2 - 0.5
        - (active.midpoint.x - 0.5 - active.viewport.panX) * ratio,
      panY: (first.point.y + second.point.y) / 2 - 0.5
        - (active.midpoint.y - 0.5 - active.viewport.panY) * ratio,
    });
    return true;
  };

  const endTouch = (event: PointerEvent): boolean => {
    if (event.pointerType !== 'touch' || !touches.current.delete(event.pointerId)) return false;
    const consumed = touchNavigation.current;
    if (!consumed) return false;
    if (touches.current.size >= 2) {
      if (pinchGesture.current?.pointerIds.includes(event.pointerId)) startPinch();
    } else {
      pinchGesture.current = null;
      const [remaining] = touches.current.entries();
      panGesture.current = remaining ? {
        pointerId: remaining[0], start: remaining[1].point,
        panX: viewportRef.current.panX, panY: viewportRef.current.panY,
      } : null;
      if (!remaining) touchNavigation.current = false;
    }
    return true;
  };

  const setZoom = (zoom: number) => {
    updateViewport((current) => ({
      ...current,
      zoom: Math.min(4, Math.max(0.5, zoom)),
    }));
  };

  const fit = () => updateViewport({ zoom: 1, panX: 0, panY: 0 });

  const zoomWithWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) return;
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    updateViewport((current) => {
      const zoom = Math.min(4, Math.max(0.5, current.zoom * Math.exp(-event.deltaY * 0.002)));
      const ratio = zoom / current.zoom;
      return { zoom, panX: x - (x - current.panX) * ratio, panY: y - (y - current.panY) * ratio };
    });
  };

  return {
    viewport,
    previewRenderSize,
    pointInCanvas,
    beginPan,
    continuePan,
    endPan,
    beginTouch,
    continueTouch,
    endTouch,
    setZoom,
    fit,
    zoomWithWheel,
    worldTransform: `translate(${viewport.panX * 100}%, ${viewport.panY * 100}%) scale(${viewport.zoom})`,
    spacePressed,
  };
}
