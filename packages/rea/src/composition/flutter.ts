import type { FlutterBuildAnalysisPort } from "../application/flutter/FlutterBuildAnalysisPort.js";
import { FlutterBuildProvider } from "../flutter/FlutterBuildProvider.js";

/** Construct one Flutter provider; it needs no external tools. */
export const createFlutterBuildAnalysisProvider =
  (): FlutterBuildAnalysisPort => new FlutterBuildProvider();
