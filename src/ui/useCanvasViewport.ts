import {
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

export function useCanvasViewport(stageRef: RefObject<HTMLDivElement | null>) {
  const panGesture = useRef<PanGesture | null>(null);
  const [viewport, setViewport] = useState<CanvasViewportState>({
    zoom: 1,
    panX: 0,
    panY: 0,
  });
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
    return {
      x: (point.x - 0.5 - viewport.panX) / viewport.zoom + 0.5,
      y: (point.y - 0.5 - viewport.panY) / viewport.zoom + 0.5,
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
      panX: viewport.panX,
      panY: viewport.panY,
    };
    return true;
  };

  const continuePan = (event: PointerEvent): boolean => {
    const active = panGesture.current;
    if (active?.pointerId !== event.pointerId) return false;
    const point = pointInViewport(event);
    if (!point) return true;
    setViewport((current) => ({
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

  const setZoom = (zoom: number) => {
    setViewport((current) => ({
      ...current,
      zoom: Math.min(4, Math.max(0.5, zoom)),
    }));
  };

  const fit = () => setViewport({ zoom: 1, panX: 0, panY: 0 });

  const zoomWithWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    setViewport((current) => ({
      ...current,
      zoom: Math.min(4, Math.max(0.5, current.zoom * Math.exp(-event.deltaY * 0.002))),
    }));
  };

  return {
    viewport,
    previewRenderSize,
    pointInCanvas,
    beginPan,
    continuePan,
    endPan,
    setZoom,
    fit,
    zoomWithWheel,
    worldTransform: `translate(${viewport.panX * 100}%, ${viewport.panY * 100}%) scale(${viewport.zoom})`,
  };
}
