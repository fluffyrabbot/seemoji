import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { EXPORT_SIZES, type ExportSize } from '../application/editor';
import type { AppServices } from '../application/services';
import {
  DESIGN_LIMITS,
  getEmojiLayer,
  resetDesign,
  type BrushStroke,
  type DesignDocument,
  type MaskStroke,
  type RasterLayer,
  type SceneLayer,
  type StrokePoint,
  type Transform,
} from '../domain/design';
import { createFloodFillRuns } from '../domain/floodFill';
import {
  boundsIntersect,
  hitTestLayers,
  layerLocalToWorldMatrix,
  layerWorldBounds,
  layerWorldCorners,
  unionWorldBounds,
  worldPointToLayerLocal,
  type WorldBounds,
} from '../domain/sceneGeometry';
import {
  applyPressureCurve,
  simplifyStrokePoints,
  stabilizeStrokePoint,
  type PressureCurve,
} from '../domain/stroke';
import type { Notice } from './App';
import type { PackSummary } from '../domain/pack';
import { useCanvasViewport, type CanvasPoint } from './useCanvasViewport';

interface Props {
  readonly design: DesignDocument;
  readonly size: ExportSize;
  readonly services: AppServices;
  readonly packs: readonly PackSummary[];
  readonly proportionsLocked: boolean;
  readonly selectedLayerIds: readonly string[];
  readonly tool: EditorTool;
  readonly brush: BrushSettings;
  readonly canvasSettings: CanvasSettings;
  readonly onToolChange: (tool: EditorTool) => void;
  readonly onBrushChange: (brush: BrushSettings) => void;
  readonly onCanvasSettingsChange: (settings: CanvasSettings) => void;
  readonly onPaintStroke: (layerId: string, stroke: BrushStroke, createLayerName?: string) => void;
  readonly onMaskStroke: (layerId: string, stroke: MaskStroke) => void;
  readonly onTransformsChange: (updates: readonly { readonly layerId: string; readonly transform: Transform }[], historyGroup?: string) => void;
  readonly onSelectionChange: (layerIds: readonly string[]) => void;
  readonly onRasterLayer: (layer: RasterLayer) => void;
  readonly onTransformCommit: () => void;
  readonly onSizeChange: (size: ExportSize) => void;
  readonly onNotice: (notice: Notice) => void;
}

export type EditorTool = 'select' | 'brush' | 'eraser' | 'restore' | 'fill' | 'pan';

export interface BrushSettings {
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
  readonly stabilization: number;
  readonly pressureCurve: PressureCurve;
  readonly fillTolerance: number;
}

export interface CanvasSettings {
  readonly showGrid: boolean;
  readonly gridDivisions: number;
  readonly snap: boolean;
  readonly showGuides: boolean;
}

type Point = CanvasPoint;

type Gesture =
  | {
      readonly kind: 'move';
      readonly pointerId: number;
      readonly start: Point;
      readonly transforms: readonly { readonly layerId: string; readonly transform: Transform }[];
      readonly bounds: WorldBounds;
    }
  | {
      readonly kind: 'scale';
      readonly pointerId: number;
      readonly center: Point;
      readonly startLocal: Point;
      readonly startDistance: number;
      readonly transforms: readonly { readonly layerId: string; readonly transform: Transform }[];
    }
  | {
      readonly kind: 'rotate';
      readonly pointerId: number;
      readonly center: Point;
      readonly startAngle: number;
      readonly transforms: readonly { readonly layerId: string; readonly transform: Transform }[];
    };

interface Marquee {
  readonly pointerId: number;
  readonly start: Point;
  readonly current: Point;
  readonly additive: boolean;
}

interface DraftStroke {
  readonly kind: 'brush' | 'eraser' | 'restore';
  readonly pointerId: number;
  readonly targetLayerId: string;
  readonly createLayer: boolean;
  readonly layerLocal: boolean;
  readonly points: readonly StrokePoint[];
  readonly width: number;
  readonly color: string;
  readonly opacity: number;
}

interface HoverSample {
  readonly point: Point;
  readonly layerId: string | null;
}

const clamp = (value: number, [minimum, maximum]: readonly [number, number]) =>
  Math.min(maximum, Math.max(minimum, value));

const pointInLayerSpace = (point: Point, center: Point, rotate: number): Point => {
  const radians = (-rotate * Math.PI) / 180;
  const x = point.x - center.x;
  const y = point.y - center.y;
  return {
    x: x * Math.cos(radians) - y * Math.sin(radians),
    y: x * Math.sin(radians) + y * Math.cos(radians),
  };
};

const wrappedDegrees = (value: number): number => {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return clamp(wrapped, DESIGN_LIMITS.rotate);
};

const svgLayerTransform = (layer: SceneLayer, size: number): string => {
  const { a, b, c, d, e, f } = layerLocalToWorldMatrix(layer);
  return `matrix(${a} ${b} ${c} ${d} ${e * size} ${f * size})`;
};

export default function Preview({
  design,
  size,
  services,
  packs,
  proportionsLocked,
  selectedLayerIds,
  tool,
  brush,
  canvasSettings,
  onToolChange,
  onBrushChange,
  onCanvasSettingsChange,
  onPaintStroke,
  onMaskStroke,
  onTransformsChange,
  onSelectionChange,
  onRasterLayer,
  onTransformCommit,
  onSizeChange,
  onNotice,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const renderSequence = useRef(0);
  const gesture = useRef<Gesture | null>(null);
  const draftRef = useRef<DraftStroke | null>(null);
  const marqueeRef = useRef<Marquee | null>(null);
  const [draft, setDraft] = useState<DraftStroke | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [snapGuides, setSnapGuides] = useState<{ readonly x?: number; readonly y?: number }>({});
  const [hoverSample, setHoverSample] = useState<HoverSample | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const {
    viewport,
    previewRenderSize,
    pointInCanvas,
    beginPan,
    continuePan,
    endPan,
    setZoom,
    fit,
    zoomWithWheel,
    worldTransform,
  } = useCanvasViewport(stageRef);
  const previewDesign = useMemo(
    () => (showOriginal ? resetDesign(design) : design),
    [design, showOriginal],
  );
  const renderKey = `${size}:${JSON.stringify(design)}`;
  const previewKey = `${previewRenderSize}:${JSON.stringify(previewDesign)}`;
  const [paintedPreviewKey, setPaintedPreviewKey] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{ readonly key: string; readonly blob: Blob } | null>(
    null,
  );
  const [copying, setCopying] = useState(false);
  const png = prepared?.key === renderKey ? prepared.blob : null;
  const rendering = png === null;
  const layer = getEmojiLayer(design);
  const shareAlikeApplies = design.layers.some((candidate) =>
    candidate.kind === 'emoji'
    && candidate.visible
    && packs.find((pack) => pack.id === candidate.source.pack)?.license.shareAlike === true);
  const selectedLayers = design.layers.filter((candidate) => selectedLayerIds.includes(candidate.id));
  const selectedLayer = selectedLayers[0] ?? layer;
  const drawingLayer = tool === 'eraser' || tool === 'restore'
    ? selectedLayer
    : tool === 'brush' && selectedLayer.kind === 'strokes'
      ? selectedLayer
      : null;
  const draftLayer = draft?.layerLocal
    ? design.layers.find((candidate) => candidate.id === draft.targetLayerId) ?? null
    : null;
  const hoverLayer = hoverSample?.layerId
    ? design.layers.find((candidate) => candidate.id === hoverSample.layerId) ?? null
    : null;
  const selectionBounds = unionWorldBounds(selectedLayers) ?? layerWorldBounds(selectedLayer);
  const worldCorners = selectedLayers.length === 1 ? layerWorldCorners(selectedLayer) : [
    { x: selectionBounds.left, y: selectionBounds.top },
    { x: selectionBounds.right, y: selectionBounds.top },
    { x: selectionBounds.right, y: selectionBounds.bottom },
    { x: selectionBounds.left, y: selectionBounds.bottom },
  ];
  const corners = worldCorners.map((point) => ({ x: point.x * previewRenderSize, y: point.y * previewRenderSize }));
  const top = {
    x: ((corners[0]?.x ?? 0) + (corners[1]?.x ?? 0)) / 2,
    y: ((corners[0]?.y ?? 0) + (corners[1]?.y ?? 0)) / 2,
  };
  const center = {
    x: (selectionBounds.left + selectionBounds.right) * previewRenderSize / 2,
    y: (selectionBounds.top + selectionBounds.bottom) * previewRenderSize / 2,
  };
  const topDistance = Math.hypot(top.x - center.x, top.y - center.y) || 1;
  const rotateHandle = {
    x: top.x + ((top.x - center.x) / topDistance) * previewRenderSize * 0.09 / viewport.zoom,
    y: top.y + ((top.y - center.y) / topDistance) * previewRenderSize * 0.09 / viewport.zoom,
  };

  useEffect(() => {
    const sequence = ++renderSequence.current;
    services.renderer
      .render(previewDesign, previewRenderSize)
      .then((frame) => {
        if (sequence !== renderSequence.current || !canvasRef.current) return;
        const canvasContext = canvasRef.current.getContext('2d');
        if (!canvasContext) throw new Error('Canvas 2D rendering is unavailable');
        canvasContext.clearRect(0, 0, previewRenderSize, previewRenderSize);
        canvasContext.drawImage(frame.canvas, 0, 0);
        setPaintedPreviewKey(previewKey);
        if (frame.warnings.length > 0) {
          onNotice({ kind: 'error', message: frame.warnings.join(' ') });
        }
        return services.renderer.png(design, size);
      })
      .then((blob) => {
        if (sequence === renderSequence.current && blob) {
          setPrepared({ key: renderKey, blob });
        }
      })
      .catch((cause: unknown) => {
        if (sequence === renderSequence.current) {
          onNotice({ kind: 'error', message: `Render failed: ${String(cause)}` });
        }
      });
  }, [design, previewDesign, previewRenderSize, size, services.renderer, onNotice, renderKey, previewKey]);

  const strokePointInStage = (
    event: PointerEvent,
    coordinateLayer: SceneLayer | null,
  ): StrokePoint | null => {
    const worldPoint = pointInCanvas(event);
    if (!worldPoint) return null;
    const point = coordinateLayer
      ? worldPointToLayerLocal(coordinateLayer, worldPoint)
      : worldPoint;
    if (!point) return null;
    return {
      x: clamp(point.x, [0, 1]),
      y: clamp(point.y, [0, 1]),
      pressure: applyPressureCurve(
        clamp(event.pressure > 0 ? event.pressure : 0.5, [0, 1]),
        brush.pressureCurve,
      ),
    };
  };

  const beginPaint = (event: PointerEvent<HTMLDivElement>) => {
    if (!stageRef.current) return;
    if (tool === 'pan' || event.button === 1) {
      beginPan(event);
      return;
    }
    if (event.button !== 0) return;
    if (tool === 'select') {
      const point = pointInCanvas(event);
      if (!point || !stageRef.current) return;
      const hit = hitTestLayers(design.layers, point);
      if (hit) {
        const next = event.shiftKey
          ? selectedLayerIds.includes(hit.id)
            ? selectedLayerIds.filter((id) => id !== hit.id)
            : [...selectedLayerIds, hit.id]
          : [hit.id];
        onSelectionChange(next.length > 0 ? next : [hit.id]);
        return;
      }
      event.preventDefault();
      stageRef.current.setPointerCapture(event.pointerId);
      const next = { pointerId: event.pointerId, start: point, current: point, additive: event.shiftKey };
      marqueeRef.current = next;
      setMarquee(next);
      return;
    }
    if (tool === 'fill') {
      if (paintedPreviewKey !== previewKey) {
        onNotice({
          kind: 'status',
          message: 'Wait for the current preview to finish rendering before filling.',
        });
        return;
      }
      const point = pointInCanvas(event);
      const source = canvasRef.current;
      if (!point || !source) return;
      try {
        const resolution = 128;
        const sample = document.createElement('canvas');
        sample.width = resolution;
        sample.height = resolution;
        const sampleContext = sample.getContext('2d', { willReadFrequently: true });
        if (!sampleContext) throw new Error('Canvas pixel access is unavailable');
        sampleContext.drawImage(source, 0, 0, resolution, resolution);
        const pixels = sampleContext.getImageData(0, 0, resolution, resolution).data;
        const runs = createFloodFillRuns({ pixels, width: resolution, height: resolution,
          seedX: point.x * resolution, seedY: point.y * resolution,
          tolerance: brush.fillTolerance, color: brush.color });
        if (runs.length === 0) throw new Error('The selected region is too large to fill safely');
        onRasterLayer({ id: crypto.randomUUID(), kind: 'raster', name: 'Fill', visible: true,
          opacity: 1, transform: { x: 0, y: 0, rotate: 0, scaleX: 1, scaleY: 1,
            skewX: 0, skewY: 0, flipH: false, flipV: false }, mask: [], resolution, runs });
        onToolChange('select');
      } catch (cause) {
        onNotice({ kind: 'error', message: `Fill failed: ${String(cause)}` });
      }
      return;
    }
    const targetIsStrokeLayer = selectedLayer.kind === 'strokes';
    const targetLayerId = tool === 'brush' && !targetIsStrokeLayer
      ? crypto.randomUUID()
      : selectedLayer.id;
    const coordinateLayer = tool === 'brush'
      ? targetIsStrokeLayer ? selectedLayer : null
      : selectedLayer;
    const point = strokePointInStage(event, coordinateLayer);
    if (!point) return;
    event.preventDefault();
    stageRef.current.setPointerCapture(event.pointerId);
    const next: DraftStroke = {
      kind: tool,
      pointerId: event.pointerId,
      targetLayerId,
      createLayer: tool === 'brush' && !targetIsStrokeLayer,
      layerLocal: coordinateLayer !== null,
      points: [point],
      width: brush.width,
      color: brush.color,
      opacity: brush.opacity,
    };
    draftRef.current = next;
    setDraft(next);
  };

  const beginGesture = (kind: Gesture['kind'], event: PointerEvent) => {
    const point = pointInCanvas(event);
    if (!point || !stageRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    stageRef.current.setPointerCapture(event.pointerId);
    if (kind === 'move') {
      gesture.current = {
        kind,
        pointerId: event.pointerId,
        start: point,
        transforms: selectedLayers.map((candidate) => ({ layerId: candidate.id, transform: candidate.transform })),
        bounds: selectionBounds,
      };
      return;
    }
    const gestureCenter = {
      x: (selectionBounds.left + selectionBounds.right) / 2,
      y: (selectionBounds.top + selectionBounds.bottom) / 2,
    };
    if (kind === 'scale') {
      gesture.current = {
        kind,
        pointerId: event.pointerId,
        center: gestureCenter,
        startLocal: pointInLayerSpace(point, gestureCenter, selectedLayers.length === 1 ? selectedLayer.transform.rotate : 0),
        startDistance: Math.hypot(point.x - gestureCenter.x, point.y - gestureCenter.y),
        transforms: selectedLayers.map((candidate) => ({ layerId: candidate.id, transform: candidate.transform })),
      };
      return;
    }
    gesture.current = {
      kind,
      pointerId: event.pointerId,
      center: gestureCenter,
      startAngle: Math.atan2(point.y - gestureCenter.y, point.x - gestureCenter.x),
      transforms: selectedLayers.map((candidate) => ({ layerId: candidate.id, transform: candidate.transform })),
    };
  };

  const continueGesture = (event: PointerEvent) => {
    const worldPoint = pointInCanvas(event);
    if (tool === 'brush' || tool === 'eraser' || tool === 'restore') {
      const localPoint = worldPoint && drawingLayer
        ? worldPointToLayerLocal(drawingLayer, worldPoint)
        : worldPoint;
      setHoverSample(localPoint ? { point: localPoint, layerId: drawingLayer?.id ?? null } : null);
    }
    if (continuePan(event)) return;
    const activeMarquee = marqueeRef.current;
    if (activeMarquee?.pointerId === event.pointerId && worldPoint) {
      const next = { ...activeMarquee, current: worldPoint };
      marqueeRef.current = next;
      setMarquee(next);
      return;
    }
    const activeDraft = draftRef.current;
    if (activeDraft?.pointerId === event.pointerId) {
      const coordinateLayer = activeDraft.layerLocal
        ? design.layers.find((candidate) => candidate.id === activeDraft.targetLayerId) ?? null
        : null;
      const rawPoint = strokePointInStage(event, coordinateLayer);
      const previous = activeDraft.points.at(-1);
      const point = rawPoint && previous
        ? stabilizeStrokePoint(previous, rawPoint, brush.stabilization)
        : rawPoint;
      if (!point || !previous || Math.hypot(point.x - previous.x, point.y - previous.y) < 0.002 / viewport.zoom) {
        return;
      }
      const next = { ...activeDraft, points: [...activeDraft.points, point] };
      draftRef.current = next;
      setDraft(next);
      return;
    }
    const active = gesture.current;
    const point = pointInCanvas(event);
    if (!active || active.pointerId !== event.pointerId || !point) return;
    if (active.kind === 'move') {
      let dx = point.x - active.start.x;
      let dy = point.y - active.start.y;
      const moved = { left: active.bounds.left + dx, right: active.bounds.right + dx,
        top: active.bounds.top + dy, bottom: active.bounds.bottom + dy };
      const otherBounds = design.layers.filter((candidate) => !selectedLayerIds.includes(candidate.id) && candidate.visible)
        .map(layerWorldBounds);
      const gridTargets = Array.from({ length: canvasSettings.gridDivisions + 1 }, (_, index) =>
        index / canvasSettings.gridDivisions);
      const xTargets = [0, 0.5, 1, ...gridTargets, ...otherBounds.flatMap((bounds) =>
        [bounds.left, (bounds.left + bounds.right) / 2, bounds.right])];
      const yTargets = [0, 0.5, 1, ...gridTargets, ...otherBounds.flatMap((bounds) =>
        [bounds.top, (bounds.top + bounds.bottom) / 2, bounds.bottom])];
      const xAnchors = [moved.left, (moved.left + moved.right) / 2, moved.right];
      const yAnchors = [moved.top, (moved.top + moved.bottom) / 2, moved.bottom];
      const threshold = 0.012 / viewport.zoom;
      let bestX: { delta: number; guide: number } | undefined;
      let bestY: { delta: number; guide: number } | undefined;
      for (const target of canvasSettings.snap ? xTargets : []) for (const anchor of xAnchors) {
        const delta = target - anchor;
        if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) bestX = { delta, guide: target };
      }
      for (const target of canvasSettings.snap ? yTargets : []) for (const anchor of yAnchors) {
        const delta = target - anchor;
        if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) bestY = { delta, guide: target };
      }
      if (bestX) dx += bestX.delta;
      if (bestY) dy += bestY.delta;
      setSnapGuides({ ...(bestX ? { x: bestX.guide } : {}), ...(bestY ? { y: bestY.guide } : {}) });
      onTransformsChange(active.transforms.map(({ layerId, transform }) => ({ layerId, transform: {
        ...transform,
        x: clamp(transform.x + dx, DESIGN_LIMITS.x),
        y: clamp(transform.y + dy, DESIGN_LIMITS.y),
      } })), 'canvas:move');
      return;
    }
    if (active.kind === 'rotate') {
      const angle = Math.atan2(point.y - active.center.y, point.x - active.center.x);
      const radians = angle - active.startAngle;
      onTransformsChange(active.transforms.map(({ layerId, transform }) => {
        const x = 0.5 + transform.x - active.center.x;
        const y = 0.5 + transform.y - active.center.y;
        return { layerId, transform: { ...transform,
          x: clamp(active.center.x + x * Math.cos(radians) - y * Math.sin(radians) - 0.5, DESIGN_LIMITS.x),
          y: clamp(active.center.y + x * Math.sin(radians) + y * Math.cos(radians) - 0.5, DESIGN_LIMITS.y),
          rotate: wrappedDegrees(transform.rotate + (radians * 180) / Math.PI) } };
      }), 'canvas:rotate');
      return;
    }
    const local = pointInLayerSpace(point, active.center,
      selectedLayers.length === 1 ? selectedLayer.transform.rotate : 0);
    const uniform = Math.hypot(point.x - active.center.x, point.y - active.center.y)
      / Math.max(0.001, active.startDistance);
    const ratioX = proportionsLocked || selectedLayers.length > 1 ? uniform
      : Math.abs(local.x / Math.max(0.001, active.startLocal.x));
    const ratioY = proportionsLocked || selectedLayers.length > 1 ? uniform
      : Math.abs(local.y / Math.max(0.001, active.startLocal.y));
    onTransformsChange(active.transforms.map(({ layerId, transform }) => ({ layerId, transform: {
      ...transform,
      x: clamp(active.center.x + (0.5 + transform.x - active.center.x) * ratioX - 0.5, DESIGN_LIMITS.x),
      y: clamp(active.center.y + (0.5 + transform.y - active.center.y) * ratioY - 0.5, DESIGN_LIMITS.y),
      scaleX: clamp(transform.scaleX * ratioX, DESIGN_LIMITS.scaleX),
      scaleY: clamp(transform.scaleY * ratioY, DESIGN_LIMITS.scaleY),
    } })), 'canvas:scale');
  };

  const endGesture = (event: PointerEvent) => {
    if (endPan(event)) return;
    const activeMarquee = marqueeRef.current;
    if (activeMarquee?.pointerId === event.pointerId) {
      const left = Math.min(activeMarquee.start.x, activeMarquee.current.x);
      const right = Math.max(activeMarquee.start.x, activeMarquee.current.x);
      const top = Math.min(activeMarquee.start.y, activeMarquee.current.y);
      const bottom = Math.max(activeMarquee.start.y, activeMarquee.current.y);
      const found = design.layers.filter((candidate) => candidate.visible
        && boundsIntersect({ left, top, right, bottom }, layerWorldBounds(candidate))).map((candidate) => candidate.id);
      onSelectionChange(activeMarquee.additive ? [...new Set([...selectedLayerIds, ...found])] : found.length > 0 ? found : selectedLayerIds);
      marqueeRef.current = null;
      setMarquee(null);
      return;
    }
    const activeDraft = draftRef.current;
    if (activeDraft?.pointerId === event.pointerId) {
      const coordinateLayer = activeDraft.layerLocal
        ? design.layers.find((candidate) => candidate.id === activeDraft.targetLayerId) ?? null
        : null;
      const rawPoint = strokePointInStage(event, coordinateLayer);
      const previous = activeDraft.points.at(-1);
      const point = rawPoint && previous
        ? stabilizeStrokePoint(previous, rawPoint, brush.stabilization)
        : rawPoint;
      const sampled = point ? [...activeDraft.points, point] : activeDraft.points;
      const points = simplifyStrokePoints(sampled);
      if (activeDraft.kind === 'brush') {
        onPaintStroke(
          activeDraft.targetLayerId,
          {
            id: crypto.randomUUID(),
            points,
            width: activeDraft.width,
            color: activeDraft.color,
            opacity: activeDraft.opacity,
          },
          activeDraft.createLayer
            ? `Paint ${design.layers.filter((layer) => layer.kind === 'strokes').length + 1}`
            : undefined,
        );
      } else {
        onMaskStroke(activeDraft.targetLayerId, {
          id: crypto.randomUUID(),
          mode: activeDraft.kind === 'restore' ? 'restore' : 'erase',
          points,
          width: activeDraft.width,
        });
      }
      draftRef.current = null;
      setDraft(null);
      return;
    }
    if (gesture.current?.pointerId !== event.pointerId) return;
    gesture.current = null;
    setSnapGuides({});
    onTransformCommit();
  };

  const cancelGesture = (event: PointerEvent) => {
    if (endPan(event)) return;
    if (draftRef.current?.pointerId === event.pointerId) {
      draftRef.current = null;
      setDraft(null);
      return;
    }
    if (marqueeRef.current?.pointerId === event.pointerId) {
      marqueeRef.current = null;
      setMarquee(null);
      return;
    }
    endGesture(event);
  };

  const nudge = (event: KeyboardEvent<HTMLDivElement>) => {
    if (tool !== 'select') return;
    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!direction) return;
    event.preventDefault();
    const amount = event.shiftKey ? 0.05 : 0.01;
    onTransformsChange(selectedLayers.map((candidate) => ({ layerId: candidate.id, transform: {
      ...candidate.transform,
      x: clamp(candidate.transform.x + (direction[0] ?? 0) * amount, DESIGN_LIMITS.x),
      y: clamp(candidate.transform.y + (direction[1] ?? 0) * amount, DESIGN_LIMITS.y),
    } })), 'canvas:nudge');
  };

  const copy = async () => {
    if (!png) return;
    setCopying(true);
    const outcome = await services.clipboard.writePng(png);
    setCopying(false);
    switch (outcome.kind) {
      case 'copied':
        onNotice({ kind: 'status', message: 'PNG copied to your clipboard.' });
        break;
      case 'unsupported':
        onNotice({ kind: 'error', message: 'PNG clipboard writes are unsupported here. Use Download PNG.' });
        break;
      case 'denied':
        onNotice({ kind: 'error', message: 'Clipboard permission was denied. Use Download PNG.' });
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
          <h2>Canvas</h2>
          <p>Drag to move · corner to resize · round handle to rotate</p>
        </div>
        <div className="viewport-actions">
          <button type="button" aria-label="Zoom out"
            onClick={() => setZoom(viewport.zoom / 1.25)}>−</button>
          <output aria-label="Canvas zoom">{Math.round(viewport.zoom * 100)}%</output>
          <button type="button" aria-label="Zoom in"
            onClick={() => setZoom(viewport.zoom * 1.25)}>＋</button>
          <button type="button" onClick={fit}>Fit</button>
          <details className="canvas-settings">
            <summary>Grid</summary>
            <label><input type="checkbox" checked={canvasSettings.showGrid}
              onChange={(event) => onCanvasSettingsChange({ ...canvasSettings, showGrid: event.target.checked })} /> Show grid</label>
            <label><input type="checkbox" checked={canvasSettings.snap}
              onChange={(event) => onCanvasSettingsChange({ ...canvasSettings, snap: event.target.checked })} /> Snap</label>
            <label><input type="checkbox" checked={canvasSettings.showGuides}
              onChange={(event) => onCanvasSettingsChange({ ...canvasSettings, showGuides: event.target.checked })} /> Guides</label>
            <label>Divisions <select aria-label="Grid divisions" value={canvasSettings.gridDivisions}
              onChange={(event) => onCanvasSettingsChange({ ...canvasSettings, gridDivisions: Number(event.target.value) })}>
              {[4, 8, 12, 16, 24, 32].map((value) => <option key={value}>{value}</option>)}
            </select></label>
          </details>
          <button
            type="button"
            className="compare-button"
            onPointerDown={() => setShowOriginal(true)}
            onPointerUp={() => setShowOriginal(false)}
            onPointerCancel={() => setShowOriginal(false)}
            onPointerLeave={() => setShowOriginal(false)}
          >
            Hold to compare
          </button>
        </div>
      </div>

      <div className="paint-toolbar" aria-label="Canvas tools">
        <div className="tool-buttons">
          {(['select', 'brush', 'eraser', 'restore', 'fill', 'pan'] as const).map((candidate) => (
            <button type="button" key={candidate} aria-pressed={tool === candidate}
              onClick={() => onToolChange(candidate)}>
              <span aria-hidden="true">
                {candidate === 'select' ? '↖'
                  : candidate === 'brush' ? '✎'
                    : candidate === 'eraser' ? '⌫'
                      : candidate === 'restore' ? '↺'
                        : candidate === 'fill' ? '▨' : '✥'}
              </span>
              {candidate[0]!.toUpperCase() + candidate.slice(1)}
            </button>
          ))}
        </div>
        {(tool === 'brush' || tool === 'eraser' || tool === 'restore' || tool === 'fill') && (
          <div className="brush-settings">
            {(tool === 'brush' || tool === 'fill') && (
              <label className="brush-color">
                <span>Color</span>
                <input type="color" value={brush.color}
                  onChange={(event) => onBrushChange({ ...brush, color: event.target.value })} />
              </label>
            )}
            {tool === 'fill' && (
              <label>
                <span>Tolerance</span>
                <input type="range" aria-label="Fill tolerance" min="0" max="255" step="1"
                  value={brush.fillTolerance}
                  onChange={(event) => onBrushChange({ ...brush, fillTolerance: Number(event.target.value) })} />
                <output>{brush.fillTolerance}</output>
              </label>
            )}
            {tool !== 'fill' && (
              <label>
                <span>Size</span>
                <input type="range" aria-label="Brush size" min={DESIGN_LIMITS.strokeWidth[0]}
                  max={DESIGN_LIMITS.strokeWidth[1]} step={0.002} value={brush.width}
                  onChange={(event) => onBrushChange({ ...brush, width: Number(event.target.value) })} />
                <output>{Math.round(brush.width * 100)}%</output>
              </label>
            )}
            {tool === 'brush' && (
              <label>
                <span>Opacity</span>
                <input type="range" aria-label="Brush opacity" min="0.05" max="1" step="0.05"
                  value={brush.opacity}
                  onChange={(event) => onBrushChange({ ...brush, opacity: Number(event.target.value) })} />
                <output>{Math.round(brush.opacity * 100)}%</output>
              </label>
            )}
            {tool === 'brush' && (
              <details className="stroke-feel">
                <summary>Stroke feel</summary>
                <label>
                  <span>Stabilize</span>
                  <input type="range" aria-label="Stroke stabilization" min="0" max="0.9"
                    step="0.05" value={brush.stabilization}
                    onChange={(event) => onBrushChange({
                      ...brush,
                      stabilization: Number(event.target.value),
                    })} />
                  <output>{Math.round(brush.stabilization * 100)}%</output>
                </label>
                <label>
                  <span>Pressure</span>
                  <select aria-label="Pressure curve" value={brush.pressureCurve}
                    onChange={(event) => onBrushChange({
                      ...brush,
                      pressureCurve: event.target.value as PressureCurve,
                    })}>
                    <option value="soft">Soft</option>
                    <option value="linear">Linear</option>
                    <option value="firm">Firm</option>
                  </select>
                </label>
              </details>
            )}
          </div>
        )}
      </div>

      <div className="preview-stage" aria-busy={rendering || paintedPreviewKey !== previewKey}>
        <div
          ref={stageRef}
          className={`preview-viewport interactive-canvas tool-${tool}`}
          tabIndex={0}
          aria-label={`Interactive emoji canvas. ${tool === 'select' ? 'Use arrow keys to move selected layers.' : `Drag to use the ${tool}.`}`}
          onPointerDown={tool === 'fill' ? undefined : beginPaint}
          onClick={tool === 'fill'
            ? (event) => beginPaint(event as unknown as PointerEvent<HTMLDivElement>)
            : undefined}
          onKeyDown={nudge}
          onKeyUp={onTransformCommit}
          onPointerMove={continueGesture}
          onPointerUp={endGesture}
          onPointerCancel={cancelGesture}
          onPointerLeave={() => setHoverSample(null)}
          onWheel={zoomWithWheel}
        >
          <div className="checkerboard canvas-world" style={{ transform: worldTransform }}>
            <canvas
              ref={canvasRef}
              width={previewRenderSize}
              height={previewRenderSize}
              aria-label={`Preview of ${layer.source.grapheme}`}
            />
            {canvasSettings.showGrid && (
              <svg className="grid-overlay" viewBox={`0 0 ${previewRenderSize} ${previewRenderSize}`} aria-hidden="true">
                {Array.from({ length: canvasSettings.gridDivisions - 1 }, (_, index) => {
                  const position = (index + 1) * previewRenderSize / canvasSettings.gridDivisions;
                  return <g key={index}><line x1={position} x2={position} y1="0" y2={previewRenderSize} />
                    <line x1="0" x2={previewRenderSize} y1={position} y2={position} /></g>;
                })}
              </svg>
            )}
            {draft && (
              <svg className="draft-overlay"
                viewBox={`0 0 ${previewRenderSize} ${previewRenderSize}`} aria-hidden="true">
                <g transform={draftLayer ? svgLayerTransform(draftLayer, previewRenderSize) : undefined}>
                  <polyline
                    className={draft.kind === 'brush' ? 'draft-brush' : 'draft-eraser'}
                    points={draft.points.map((point) =>
                      `${point.x * previewRenderSize},${point.y * previewRenderSize}`).join(' ')}
                    style={{
                      stroke: draft.kind === 'brush'
                        ? draft.color
                        : draft.kind === 'restore' ? '#65e6a5' : '#ffffff',
                      strokeWidth: draft.width * previewRenderSize,
                      opacity: draft.opacity,
                    }}
                  />
                </g>
            </svg>
            )}
            {!draft && hoverSample && (tool === 'brush' || tool === 'eraser' || tool === 'restore') && (
              <svg className="tool-cursor-overlay"
                viewBox={`0 0 ${previewRenderSize} ${previewRenderSize}`} aria-hidden="true">
                <g transform={hoverLayer ? svgLayerTransform(hoverLayer, previewRenderSize) : undefined}>
                  <circle cx={hoverSample.point.x * previewRenderSize}
                    cy={hoverSample.point.y * previewRenderSize}
                    r={brush.width * previewRenderSize / 2} />
                </g>
              </svg>
            )}
            {!showOriginal && tool === 'select' && (
              <svg className="transform-overlay"
                viewBox={`0 0 ${previewRenderSize} ${previewRenderSize}`} aria-hidden="true">
              <line className="rotate-stem" x1={top.x} y1={top.y}
                x2={rotateHandle.x} y2={rotateHandle.y} />
              <polygon
                className="selection-box move-handle"
                points={corners.map((point) => `${point.x},${point.y}`).join(' ')}
                onPointerDown={(event) => beginGesture('move', event)}
              />
              {corners.map((point, index) => (
                <circle key={index} className="corner-handle" cx={point.x} cy={point.y}
                  r={previewRenderSize * 0.025 / viewport.zoom}
                  onPointerDown={(event) => beginGesture('scale', event)} />
              ))}
              <circle className="rotate-handle" cx={rotateHandle.x} cy={rotateHandle.y}
                r={previewRenderSize * 0.028 / viewport.zoom}
                onPointerDown={(event) => beginGesture('rotate', event)} />
              {canvasSettings.showGuides && snapGuides.x !== undefined && <line className="snap-guide"
                x1={snapGuides.x * previewRenderSize} x2={snapGuides.x * previewRenderSize}
                y1="0" y2={previewRenderSize} />}
              {canvasSettings.showGuides && snapGuides.y !== undefined && <line className="snap-guide"
                x1="0" x2={previewRenderSize}
                y1={snapGuides.y * previewRenderSize} y2={snapGuides.y * previewRenderSize} />}
              {marquee && <rect className="marquee-box"
                x={Math.min(marquee.start.x, marquee.current.x) * previewRenderSize}
                y={Math.min(marquee.start.y, marquee.current.y) * previewRenderSize}
                width={Math.abs(marquee.current.x - marquee.start.x) * previewRenderSize}
                height={Math.abs(marquee.current.y - marquee.start.y) * previewRenderSize} />}
            </svg>
            )}
          </div>
        </div>
        {rendering && <span className="render-status">Rendering…</span>}
      </div>

      <div className="export-bar">
        <label className="size-control">
          <span>Export size</span>
          <select value={size}
            onChange={(event) => onSizeChange(Number(event.target.value) as ExportSize)}>
            {EXPORT_SIZES.map((candidate) => (
              <option key={candidate} value={candidate}>{candidate} × {candidate}px</option>
            ))}
          </select>
        </label>
        <div className="preview-actions">
          <button className="primary" disabled={!png || copying} onClick={() => void copy()}>
            {!png ? 'Preparing PNG…' : copying ? 'Copying…' : 'Copy PNG'}
          </button>
          <button disabled={!png}
            onClick={() => png && services.fileExport.download(png, 'seemoji.png')}>
            Download PNG
          </button>
        </div>
      </div>
      {shareAlikeApplies && (
        <p className="share-alike-notice">
          This PNG is a CC BY-SA 4.0 derivative. Share-alike applies if you distribute it.
        </p>
      )}
    </div>
  );
}
