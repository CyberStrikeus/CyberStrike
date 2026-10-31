import type { ElectronIpcContext } from "./ElectronBoundaryAnalysis.js";
import type { JavaScriptArtifactGraphContext } from "./JavaScriptArtifactGraphContext.js";
import { addElectronIpcBoundaries } from "./ElectronBoundaryGraphIpc.js";
import { addElectronNativeBoundaries } from "./ElectronBoundaryGraphNative.js";
import { addElectronProtocolBoundaries } from "./ElectronBoundaryGraphProtocols.js";
import { addElectronWindowBoundaries } from "./ElectronBoundaryGraphWindows.js";
import { addElectronCallPaths } from "./ElectronBoundaryGraphCallPaths.js";

/** Add every static Electron process and security-boundary fact to the JAG. */
export const addElectronBoundaries = (
  context: JavaScriptArtifactGraphContext,
  ipc: ElectronIpcContext,
): void => {
  addElectronWindowBoundaries(context);
  addElectronIpcBoundaries(context, ipc);
  addElectronNativeBoundaries(context);
  addElectronProtocolBoundaries(context);
  addElectronCallPaths(context, ipc);
};
