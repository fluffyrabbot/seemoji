import type { EditorState, ExportSize } from '../../application/editor';
import type { PackSessionSnapshot } from '../../application/packSession';
import type { RenderCoordinator } from '../../application/renderCoordinator';
import type { AssetDeliveryService } from '../../application/assetDelivery';
import type { StorageHealth } from '../../application/services';
import type {
  ProjectConflictResolution,
  WorkspacePersistenceStatus,
  WorkspaceSnapshot,
} from '../../application/workspaceController';
import type {
  Appearance,
  BrushStroke,
  MaskStroke,
  RasterLayer,
  SceneLayer,
  Transform,
} from '../../domain/design';
import type { PackSnapshot, PackSummary } from '../../domain/pack';
import type { Project } from '../../domain/project';
import type { ProjectQuarantineRecord } from '../../domain/projectQuarantine';
import type { EmojiPackCatalog } from '../../ports/emojiPackCatalog';
import type { PressureCurve } from '../../domain/stroke';
import type { ReactNode } from 'react';

export type Notice = {
  readonly kind: 'status' | 'error';
  readonly message: string;
};

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

export interface ExportBarRenderProps {
  readonly size: ExportSize;
  readonly prepared: boolean;
  readonly copying: boolean;
  readonly onSizeChange: (size: ExportSize) => void;
  readonly onCopy: () => void;
  readonly onDownload: () => void;
}

export type ExportBarRenderer = (props: ExportBarRenderProps) => ReactNode;

type PersistenceStatus = 'loading' | WorkspacePersistenceStatus;

export interface LoadingEditorPageViewModel {
  readonly status: 'loading';
  readonly persistenceStatus: PersistenceStatus;
  readonly notice: Notice | null;
}

export interface ReadyEditorPageViewModel {
  readonly status: 'ready';
  readonly editor: EditorState;
  readonly editorSessionEpoch: number;
  readonly projectName: string;
  readonly currentProjectId: string;
  readonly projects: readonly Project[];
  readonly persistenceStatus: PersistenceStatus;
  readonly workspaceBusy: boolean;
  readonly recoveryBusy: boolean;
  readonly storageHealth: StorageHealth | null;
  readonly workspaceIssues: WorkspaceSnapshot['issues'];
  readonly hasConflicts: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly packs: PackSessionSnapshot;
  readonly pickerEmoji: string;
  readonly attributionPacks: readonly PackSummary[];
  readonly proportionsLocked: boolean;
  readonly tool: EditorTool;
  readonly brush: BrushSettings;
  readonly canvasSettings: CanvasSettings;
  readonly notice: Notice | null;
  readonly catalog: EmojiPackCatalog;
  readonly renderer: RenderCoordinator;
  readonly assetDelivery: AssetDeliveryService;
}

export type EditorPageViewModel =
  | LoadingEditorPageViewModel
  | ReadyEditorPageViewModel;

export type LayerKind = 'paint' | 'rectangle' | 'ellipse' | 'line' | 'text';
export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributionAxis = 'horizontal' | 'vertical';

export interface EditorPageCommands {
  readonly history: {
    readonly undo: () => void;
    readonly redo: () => void;
  };
  readonly projects: {
    readonly changeName: (name: string) => void;
    readonly create: () => Promise<void>;
    readonly open: (id: string) => Promise<void>;
    readonly save: () => Promise<void>;
    readonly toggleStar: () => Promise<void>;
    readonly delete: () => Promise<void>;
    readonly export: () => void;
    readonly import: (file: File) => Promise<void>;
    readonly useAsTemplate: (id: string) => Promise<void>;
    readonly resolveConflict: (
      conflictProjectId: string,
      resolution: ProjectConflictResolution,
    ) => Promise<void>;
  };
  readonly recovery: {
    readonly exportWorkspace: () => Promise<void>;
    readonly importWorkspace: (file: File) => Promise<void>;
    readonly exportQuarantined: (record: ProjectQuarantineRecord) => Promise<void>;
    readonly purgeQuarantined: (record: ProjectQuarantineRecord) => Promise<void>;
    readonly requestPersistentStorage: () => Promise<void>;
  };
  readonly emoji: {
    readonly select: (grapheme: string) => Promise<boolean>;
    readonly changePack: (snapshot: PackSnapshot) => Promise<void>;
  };
  readonly layers: {
    readonly select: (layerId: string, toggle: boolean) => void;
    readonly toggleVisibility: (layerId: string) => void;
    readonly move: (layerId: string, direction: 'forward' | 'backward') => void;
    readonly remove: (layerId: string) => void;
    readonly rename: (layerId: string, name: string) => void;
    readonly duplicate: (layerId: string) => void;
    readonly changeOpacity: (
      layerId: string,
      opacity: number,
      historyGroup: string,
    ) => void;
    readonly commit: () => void;
    readonly add: (kind: LayerKind) => void;
    readonly update: (layer: SceneLayer, historyGroup?: string) => void;
    readonly align: (mode: Alignment) => void;
    readonly distribute: (axis: DistributionAxis) => void;
    readonly copySelection: () => void;
    readonly pasteSelection: () => void;
    readonly duplicateSelection: () => void;
    readonly groupSelection: () => void;
    readonly ungroupSelection: () => void;
  };
  readonly canvas: {
    readonly changeTool: (tool: EditorTool) => void;
    readonly changeBrush: (brush: BrushSettings) => void;
    readonly changeSettings: (settings: CanvasSettings) => void;
    readonly paintStroke: (
      layerId: string,
      stroke: BrushStroke,
      createLayerName?: string,
    ) => void;
    readonly maskStroke: (layerId: string, stroke: MaskStroke) => void;
    readonly changeTransforms: (
      updates: readonly { readonly layerId: string; readonly transform: Transform }[],
      historyGroup?: string,
    ) => void;
    readonly changeSelection: (layerIds: readonly string[]) => void;
    readonly addRasterLayer: (layer: RasterLayer) => void;
    readonly commitTransform: () => void;
    readonly changeSize: (size: ExportSize) => void;
  };
  readonly controls: {
    readonly changeProportionsLocked: (locked: boolean) => void;
    readonly changeTransform: (transform: Transform, historyGroup?: string) => void;
    readonly changeAppearance: (appearance: Appearance, historyGroup?: string) => void;
    readonly applyStyle: (transform: Transform, appearance: Appearance) => void;
    readonly commit: () => void;
    readonly reset: () => void;
  };
  readonly notices: {
    readonly show: (notice: Notice) => void;
    readonly dismiss: () => void;
  };
}
