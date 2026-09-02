import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackableProductEvent } from '../../ports/productEvents';
import type {
  EditorPageCommands,
  EditorPageViewModel,
  ExportBarRenderer,
} from '../editor/contracts';

vi.mock('../editor/EditorLayout', () => ({
  default: ({ renderExportBar }: { readonly renderExportBar: ExportBarRenderer }) =>
    createElement('div', null, renderExportBar({
      size: 128,
      prepared: true,
      copying: false,
      onSizeChange: () => undefined,
      onCopy: () => undefined,
      onDownload: () => undefined,
    })),
}));

import EditorExperience from './EditorExperience';
import type { EditorExperimentClient } from './contracts';

const loadingModel: EditorPageViewModel = {
  status: 'loading',
  persistenceStatus: 'loading',
  notice: null,
};
const readyModel = { status: 'ready' } as EditorPageViewModel;
const commands = {} as EditorPageCommands;

class ExperimentClient implements EditorExperimentClient {
  readonly calls: string[] = [];
  readonly variant: 'control-a' | 'control-b';
  readonly acceptReady: boolean;

  constructor(
    variant: 'control-a' | 'control-b',
    acceptReady = true,
  ) {
    this.variant = variant;
    this.acceptReady = acceptReady;
  }

  variantFor(): 'control-a' | 'control-b' {
    return this.variant;
  }

  expose(): void {
    this.calls.push('expose');
  }

  captureOnce(event: TrackableProductEvent): boolean {
    this.calls.push(event.name);
    return this.acceptReady;
  }

  capture(): void {}
}

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.replaceChildren();
});

const render = (model: EditorPageViewModel, experiments: EditorExperimentClient) => {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  root.render(createElement(EditorExperience, { model, commands, experiments }));
  return container;
};

describe('EditorExperience', () => {
  it('records eligibility before exposure only after the editor is ready', async () => {
    const experiments = new ExperimentClient('control-a');
    const container = render(loadingModel, experiments);
    await vi.waitFor(() => expect(container.querySelector('.export-bar')).not.toBeNull());
    expect(experiments.calls).toEqual([]);

    root!.render(createElement(EditorExperience, {
      model: readyModel,
      commands,
      experiments,
    }));
    await vi.waitFor(() => expect(experiments.calls).toEqual(['editor_ready', 'expose']));
  });

  it('does not expose when the denominator event was not accepted', async () => {
    const experiments = new ExperimentClient('control-b', false);
    const container = render(readyModel, experiments);
    await vi.waitFor(() => expect(experiments.calls).toEqual(['editor_ready']));
    expect(container.querySelector('.export-bar')?.getAttribute('data-experiment-variant'))
      .toBe('control-b');
  });
});
