import { useRef, useState } from 'react';
import ConflictResolutionPanel from '../ConflictResolutionPanel';
import Controls from '../Controls';
import EmojiPicker from '../EmojiPicker';
import LayersPanel from '../LayersPanel';
import Preview from '../Preview';
import ProjectBar from '../ProjectBar';
import StarredProjectsBar from '../StarredProjectsBar';
import WorkspaceMenu from '../WorkspaceMenu';
import WorkspaceRecoveryPanel from '../WorkspaceRecoveryPanel';
import type {
  EditorPageCommands,
  EditorPageViewModel,
  ExportBarRenderer,
} from './contracts';

interface Props {
  readonly model: EditorPageViewModel;
  readonly commands: EditorPageCommands;
  readonly renderExportBar: ExportBarRenderer;
}

export default function EditorLayout({ model, commands, renderExportBar }: Props) {
  const conflictPanelRef = useRef<HTMLDivElement>(null);
  const licensesDialogRef = useRef<HTMLDialogElement>(null);
  const [panel, setPanel] = useState<'emoji' | 'layers' | 'adjust'>('emoji');

  if (model.status === 'loading') {
    return <main className="editor-layout" aria-busy="true">
      <p role={model.persistenceStatus === 'error' ? 'alert' : 'status'}>
        {model.notice?.message ?? 'Opening project workspace…'}
      </p>
    </main>;
  }

  const reviewConflicts = () => {
    conflictPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    conflictPanelRef.current?.focus({ preventScroll: true });
  };
  const currentProject = model.projects.find(
    (project) => project.id === model.currentProjectId,
  );
  const selectedLayer = model.editor.selectedLayerIds.length === 1
    ? model.editor.design.layers.find((layer) => layer.id === model.editor.selectedLayerIds[0])
    : null;
  const addText = () => {
    commands.layers.add('text');
    setPanel('adjust');
  };
  const chooseEmoji = () => {
    setPanel('emoji');
    requestAnimationFrame(() => document.getElementById('emoji-search')?.focus());
  };

  return (
    <>
      <header className="app-header">
        <div>
          <h1>seemoji</h1>
          <p>Pick a mood. Make it yours.</p>
        </div>
        <div className="history-actions" aria-label="Edit history">
          <button disabled={model.workspaceBusy || !model.canUndo}
            onClick={commands.history.undo} title="Undo (⌘Z)">↶ Undo</button>
          <button disabled={model.workspaceBusy || !model.canRedo}
            onClick={commands.history.redo} title="Redo (⇧⌘Z)">↷ Redo</button>
        </div>
      </header>

      <ProjectBar name={model.projectName} projects={model.projects}
        currentId={model.currentProjectId}
        persistenceStatus={model.persistenceStatus}
        busy={model.workspaceBusy}
        onNameChange={commands.projects.changeName}
        onNew={() => void commands.projects.create()}
        onOpen={(id) => void commands.projects.open(id)}
        menu={<WorkspaceMenu
          starred={currentProject?.starredAt != null}
          storageHealth={model.storageHealth}
          busy={model.recoveryBusy || model.workspaceBusy}
          onSaveNow={() => void commands.projects.save()}
          onToggleStar={() => void commands.projects.toggleStar()}
          onDelete={() => void commands.projects.delete()}
          onExportProject={commands.projects.export}
          onImportProject={(file) => void commands.projects.import(file)}
          onExportWorkspace={() => void commands.recovery.exportWorkspace()}
          onImportWorkspace={(file) => void commands.recovery.importWorkspace(file)}
          onRequestPersistence={() => void commands.recovery.requestPersistentStorage()}
        />} />

      {model.hasConflicts && (
        <section className="workspace-status-banner conflict" role="alert">
          <div>
            <strong>Concurrent edits are safe.</strong>
            <span>Compare the preserved versions and choose what to keep.</span>
          </div>
          <button type="button" disabled={model.workspaceBusy}
            onClick={reviewConflicts}>Review versions</button>
        </section>
      )}
      {model.workspaceBusy && (
        <section className="workspace-status-banner" role="status">
          <div>
            <strong>Updating the project workspace…</strong>
            <span>Editing will resume when the local transaction completes.</span>
          </div>
        </section>
      )}
      {model.persistenceStatus === 'error' && (
        <section className="workspace-status-banner error" role="alert">
          <div>
            <strong>Local changes could not be saved.</strong>
            <span>Your editor remains open. Try the save again before closing this tab.</span>
          </div>
          <button type="button" disabled={model.workspaceBusy}
            onClick={() => void commands.projects.save()}>Try saving again</button>
        </section>
      )}

      <WorkspaceRecoveryPanel
        issues={model.workspaceIssues}
        busy={model.recoveryBusy || model.workspaceBusy}
        onExportQuarantined={(record) => void commands.recovery.exportQuarantined(record)}
        onPurgeQuarantined={(record) => void commands.recovery.purgeQuarantined(record)}
      />

      <main className="editor-layout" data-panel={panel} inert={model.workspaceBusy}
        aria-busy={model.workspaceBusy}>
        <div className="editor-panel-tabs" aria-label="Editing panels">
          {(['emoji', 'layers', 'adjust'] as const).map((candidate) => (
            <button key={candidate} type="button" aria-pressed={panel === candidate}
              aria-controls={candidate === 'adjust' ? 'editing-controls' : 'emoji-source'}
              onClick={() => setPanel(candidate)}>
              {candidate === 'emoji' ? 'Emoji' : candidate === 'layers' ? 'Objects' : 'Edit'}
            </button>
          ))}
        </div>
        <section className="picker-region" id="emoji-source" aria-label="Emoji source">
          <div className="emoji-panel-shell">
            <EmojiPicker
              emoji={model.pickerEmoji}
              catalog={model.catalog}
              snapshot={model.packs.selected}
              packs={model.packs.packs}
              selectedLayer={selectedLayer?.kind === 'emoji' ? selectedLayer : null}
              onPick={async (emoji, target) => {
                const applied = await commands.emoji.select(emoji, target);
                if (applied) setPanel('adjust');
                return applied;
              }}
              onSnapshotChange={commands.emoji.changePack}
            />
          </div>
          <div className="layers-panel-shell">
            <LayersPanel
              design={model.editor.design}
              selectedLayerIds={model.editor.selectedLayerIds}
              editingGroupId={model.editor.editingGroupId}
              onSelect={commands.layers.select}
              onToggle={commands.layers.toggleVisibility}
              onMove={commands.layers.move}
              onRemove={commands.layers.remove}
              onDuplicate={commands.layers.duplicate}
              onAdd={commands.layers.add}
              onAlign={commands.layers.align}
              onDistribute={commands.layers.distribute}
              onCopy={commands.layers.copySelection}
              onPaste={commands.layers.pasteSelection}
              onDuplicateSelection={commands.layers.duplicateSelection}
              onGroup={commands.layers.groupSelection}
              onUngroup={commands.layers.ungroupSelection}
              onSelectGroup={commands.groups.select}
              onEditGroup={commands.groups.edit}
              onRenameGroup={commands.groups.rename}
              onUngroupGroup={commands.groups.ungroup}
            />
          <StarredProjectsBar
            projects={model.projects}
            renderer={model.renderer}
            busy={model.workspaceBusy}
            onOpen={(id) => void commands.projects.open(id)}
            onUseAsTemplate={(id) => void commands.projects.useAsTemplate(id)}
          />
          </div>
        </section>

        <section className="preview-region" aria-label="Canvas and export">
          <Preview
            key={model.editorSessionEpoch}
            design={model.editor.design}
            size={model.editor.exportSize}
            renderer={model.renderer}
            assetDelivery={model.assetDelivery}
            packs={model.packs.packs}
            proportionsLocked={model.proportionsLocked}
            selectedLayerIds={model.editor.selectedLayerIds}
            editingGroupId={model.editor.editingGroupId}
            onFinishGroupEdit={commands.groups.finishEditing}
            tool={model.tool}
            brush={model.brush}
            canvasSettings={model.canvasSettings}
            onToolChange={commands.canvas.changeTool}
            onAddText={addText}
            onChooseEmoji={chooseEmoji}
            onBrushChange={commands.canvas.changeBrush}
            onCanvasSettingsChange={commands.canvas.changeSettings}
            onPaintStroke={commands.canvas.paintStroke}
            onMaskStroke={commands.canvas.maskStroke}
            onTransformsChange={commands.canvas.changeTransforms}
            onSelectionChange={(ids) => {
              const selected = commands.canvas.changeSelection(ids);
              if (ids.length > 0) setPanel('adjust');
              return selected;
            }}
            onRasterLayer={commands.canvas.addRasterLayer}
            onTransformCommit={commands.canvas.commitTransform}
            onSizeChange={commands.canvas.changeSize}
            onNotice={commands.notices.show}
            renderExportBar={renderExportBar}
          />
          {model.hasConflicts && (
            <div ref={conflictPanelRef} tabIndex={-1} className="conflict-resolution-anchor">
              <ConflictResolutionPanel
                projects={model.projects}
                renderer={model.renderer}
                onResolve={(id, resolution) =>
                  void commands.projects.resolveConflict(id, resolution)}
              />
            </div>
          )}

        </section>

        <section className="controls-region" id="editing-controls" aria-label="Editing controls">
          <Controls
            key={model.editorSessionEpoch}
            design={model.editor.design}
            selectedLayerIds={model.editor.selectedLayerIds}
            renderer={model.renderer}
            emojiStyles={model.emojiStyles}
            proportionsLocked={model.proportionsLocked}
            onProportionsLockedChange={commands.controls.changeProportionsLocked}
            onTransformsChange={commands.canvas.changeTransforms}
            onAppearanceChange={commands.controls.changeAppearance}
            onApplyStyle={commands.controls.applyStyle}
            onUpdateLayer={commands.layers.update}
            onCommit={commands.controls.commit}
            onReset={commands.controls.reset}
          />
        </section>
      </main>

      <footer className="app-footer">
        <div>
          {model.attributionPacks.length > 0 ? model.attributionPacks.map((summary, index) => (
            <span key={summary.id}>
              {index > 0 ? ' ' : ''}{summary.license.attribution} under{' '}
              <a href={summary.license.noticeUrl} target="_blank" rel="noreferrer">
                {summary.license.spdx}
              </a>.
            </span>
          )) : <>
            Emoji artwork by{' '}
            <a href="https://github.com/jdecked/twemoji" target="_blank" rel="noreferrer">
              Twemoji
            </a>{' '}
            under{' '}
            <a href="https://creativecommons.org/licenses/by/4.0/"
              target="_blank" rel="noreferrer">CC BY 4.0</a>.
          </>}
        </div>
        <button type="button" onClick={() => licensesDialogRef.current?.showModal()}>
          All packs &amp; licenses
        </button>
      </footer>

      <dialog ref={licensesDialogRef} className="licenses-dialog"
        aria-labelledby="licenses-title">
        <div className="licenses-dialog-header">
          <div>
            <h2 id="licenses-title">Emoji packs &amp; licenses</h2>
            <p>License terms for every pack available in this build.</p>
          </div>
          <button type="button" aria-label="Close licenses"
            onClick={() => licensesDialogRef.current?.close()}>×</button>
        </div>
        <ul>
          {model.packs.packs.map((summary) => (
            <li key={summary.id}>
              <strong>{summary.name}</strong>
              <span>Unicode {summary.unicodeLevel} · version {summary.defaultVersion}</span>
              <span>{summary.license.attribution}</span>
              <a href={summary.license.noticeUrl} target="_blank" rel="noreferrer">
                {summary.license.spdx}{summary.license.shareAlike ? ' · share-alike' : ''}
              </a>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => licensesDialogRef.current?.close()}>Close</button>
      </dialog>

      {model.notice && (
        <div
          className={`notice ${model.notice.kind}`}
          role={model.notice.kind === 'error' ? 'alert' : 'status'}
          aria-live={model.notice.kind === 'error' ? 'assertive' : 'polite'}
        >
          <span>{model.notice.message}</span>
          <button aria-label="Dismiss notification" onClick={commands.notices.dismiss}>
            ×
          </button>
        </div>
      )}
    </>
  );
}
