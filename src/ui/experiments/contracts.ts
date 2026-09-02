import type { VariantFor } from '../../experimentation/definitions';
import type { ExperimentClient } from '../../ports/experiments';

export type EditorExperimentVariants = {
  readonly exportBarAa: VariantFor<'exportBarAa'>;
};

export type EditorExperimentClient = ExperimentClient<EditorExperimentVariants>;
