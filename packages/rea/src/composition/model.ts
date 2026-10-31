import { ModelArtifactService } from "../application/model/ModelArtifactService.js";
import { ModelArtifactProvider } from "../model/ModelArtifactProvider.js";

/** Construct the local reader without acquiring files, processes or network resources. */
export const createModelArtifactService = (): ModelArtifactService =>
  new ModelArtifactService(new ModelArtifactProvider());
