import type { ElectronCallPath } from "../../domain/javascript/electronStaticAnalysisTypes.js";
import { sha256Text } from "../../domain/javascript/javascriptStaticAnalysisHelpers.js";

/** Keep wrapper-path identity source-scoped across both graph projections. */
export const electronCallPathId = (
  filePath: string,
  path: ElectronCallPath,
): string => sha256Text(JSON.stringify([filePath, path]));
