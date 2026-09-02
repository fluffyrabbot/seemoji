import { useEffect } from 'react';
import EditorLayout from '../editor/EditorLayout';
import type {
  EditorPageCommands,
  EditorPageViewModel,
  ExportBarRenderer,
} from '../editor/contracts';
import ExportBarAa from './ExportBarAa';
import type { EditorExperimentClient } from './contracts';

const renderControlAExportBar: ExportBarRenderer = (props) =>
  <ExportBarAa {...props} diagnosticVariant="control-a" />;

const renderControlBExportBar: ExportBarRenderer = (props) =>
  <ExportBarAa {...props} diagnosticVariant="control-b" />;

interface Props {
  readonly model: EditorPageViewModel;
  readonly commands: EditorPageCommands;
  readonly experiments: EditorExperimentClient;
}

/**
 * The only editor-layout experiment switch. Both A/A branches deliberately
 * render the same layout until a durable event sink is installed and validated.
 */
export default function EditorExperience({ model, commands, experiments }: Props) {
  const variant = experiments.variantFor('exportBarAa');

  useEffect(() => {
    if (
      model.status === 'ready'
      && experiments.captureOnce({ name: 'editor_ready', properties: {} })
    ) experiments.expose('exportBarAa');
  }, [experiments, model.status]);

  const renderExportBar = variant === 'control-b'
    ? renderControlBExportBar
    : renderControlAExportBar;
  return <EditorLayout
    model={model}
    commands={commands}
    renderExportBar={renderExportBar}
  />;
}
