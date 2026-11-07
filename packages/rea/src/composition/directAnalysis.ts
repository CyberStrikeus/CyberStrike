import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import { parseConfig } from "../config/parseConfig.js";
import type { DirectAnalysisDependencies } from "../application/DirectAnalysisDependencies.js";

type DirectAnalysisRuntime = typeof import("../application/DirectAnalysis.js");
type DirectAnalysisStatusRuntime =
  typeof import("../application/DirectAnalysisStatus.js");

type BoundOperation<Operation> = Operation extends (
  ...args: infer Arguments
) => infer Result
  ? (
      ...args: Arguments extends [unknown, ...infer BoundArguments]
        ? BoundArguments
        : never
    ) => Result
  : never;

/** Bind one-shot analysis and status commands to one caller-selected environment. */
export const createDirectAnalysis = (
  selectedEnvironment: Readonly<Record<string, string | undefined>>,
) => {
  const environment = snapshotEnvironment(selectedEnvironment);
  const dependencies: DirectAnalysisDependencies = {
    readConfiguration: () => parseConfig(environment),
    createBinarySession: async (config, logger) => {
      const { createBinarySession } = await import("./binary.js");
      return createBinarySession(config, logger, environment);
    },
    createManagedBinarySession: async () => {
      const { createManagedBinarySession } = await import("./binary.js");
      return createManagedBinarySession();
    },
    createNativeDispatchBinarySession: async (config, logger) => {
      const { createNativeDispatchBinarySession } = await import("./binary.js");
      return createNativeDispatchBinarySession(config, logger, environment);
    },
    createNativeBinarySession: async () => {
      const { createNativeBinarySession } = await import("./binary.js");
      return createNativeBinarySession(environment);
    },
    createArtifactBinarySession: async () => {
      const { createArtifactBinarySession } = await import("./binary.js");
      return createArtifactBinarySession(environment);
    },
  };
  const runDirectAnalysis: BoundOperation<
    DirectAnalysisRuntime["runDirectAnalysis"]
  > = async (...args) => {
    const { runDirectAnalysis } =
      await import("../application/DirectAnalysis.js");
    return runDirectAnalysis(dependencies, ...args);
  };
  const runProviderAnalysis: BoundOperation<
    DirectAnalysisRuntime["runProviderAnalysis"]
  > = async (...args) => {
    const { runProviderAnalysis } =
      await import("../application/DirectAnalysis.js");
    return runProviderAnalysis(dependencies, ...args);
  };
  const runSessionStatus: BoundOperation<
    DirectAnalysisStatusRuntime["runSessionStatus"]
  > = async (...args) => {
    const { runSessionStatus } =
      await import("../application/DirectAnalysisStatus.js");
    return runSessionStatus(dependencies, ...args);
  };
  return {
    runDirectAnalysis,
    runProviderAnalysis,
    runSessionStatus,
  };
};

/** Bound operations used by CLI command registration. */
export type DirectAnalysis = ReturnType<typeof createDirectAnalysis>;

/** Execute managed metadata without configuration or native provider candidates. */
export const runManagedProviderExecution: BoundOperation<
  DirectAnalysisRuntime["runManagedProviderExecution"]
> = async (...args) => {
  const { runManagedProviderExecution } =
    await import("../application/DirectAnalysis.js");
  return runManagedProviderExecution(
    {
      createManagedBinarySession: async () => {
        const { createManagedBinarySession } = await import("./binary.js");
        return createManagedBinarySession();
      },
    },
    ...args,
  );
};
