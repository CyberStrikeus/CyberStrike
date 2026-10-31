import { BeamService } from "../application/erlang/BeamService.js";
import { BeamProvider } from "../erlang/BeamProvider.js";

/** Compose bundled BEAM inspection without an Erlang installation or any child process. */
export const createBeamService = (): BeamService =>
  new BeamService(new BeamProvider());
