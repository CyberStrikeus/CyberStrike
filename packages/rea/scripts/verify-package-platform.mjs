/** Run platform-specific deep-analysis smoke tests. */
export async function verifyPackagePlatform({
  commands,
  cli,
  environment,
  platform = process.platform,
}) {
  if (platform === "linux") {
    const unsupportedExecution = await commands.runWithStatus(
      cli,
      ["analyze", process.execPath, "--provider", "hopper", "--json"],
      environment,
    );
    assertLinuxPackageProviderFailure(unsupportedExecution);
  } else {
    const overview = JSON.parse(
      await commands.run(
        cli,
        ["analyze", process.execPath, "--provider", "hopper", "--json"],
        environment,
      ),
    );
    if (!hasPositiveProcedureCount(overview))
      throw new Error(
        `packaged Hopper-backed analyze CLI failed: ${JSON.stringify(overview)}`,
      );
    const inspected = JSON.parse(
      await commands.run(
        cli,
        ["inspect", process.execPath, "--provider", "hopper", "--json"],
        environment,
      ),
    );
    if (!hasPositiveProcedureCount(inspected))
      throw new Error("packaged inspect CLI failed");
    const functionResult = JSON.parse(
      await commands.run(
        cli,
        [
          "function",
          process.execPath,
          "0x1000",
          "--provider",
          "hopper",
          "--json",
        ],
        environment,
      ),
    );
    if (
      functionResult.operation !== "analyze_function" ||
      functionResult.provider?.id !== "hopper" ||
      functionResult.normalized_result?.procedure?.address !== "0x1000"
    )
      throw new Error(
        `packaged function CLI failed: ${JSON.stringify(functionResult)}`,
      );
    const xrefs = JSON.parse(
      await commands.run(
        cli,
        ["xrefs", process.execPath, "0x1000", "--provider", "hopper", "--json"],
        environment,
      ),
    );
    if (
      xrefs.operation !== "xrefs" ||
      JSON.stringify(xrefs.normalized_result) !== JSON.stringify(["0x1000"])
    )
      throw new Error(`packaged xrefs CLI failed: ${JSON.stringify(xrefs)}`);
    const trace = JSON.parse(
      await commands.run(
        cli,
        [
          "trace",
          process.execPath,
          "fixture",
          "--provider",
          "hopper",
          "--json",
        ],
        environment,
      ),
    );
    if (trace.operation !== "trace_feature")
      throw new Error(`packaged trace CLI failed: ${JSON.stringify(trace)}`);
  }
}

/** One owner for unsupported-launch evidence across package and real-Hopper verification. */
export const isUnsupportedHopperLaunchFailure = (failure) => {
  const details = failure?.details;
  const unsupportedBuild =
    details?.failure_code === "unsupported_hopper_build" &&
    details.exit_code === 72;
  const publisherRejection =
    details?.stage === "launch" &&
    details.launch_rejection?.boundary === "publisher_verification" &&
    details.launch_rejection.reason === "unsupported_hopper_build" &&
    details.exit_code === undefined &&
    details.launcher === undefined;
  return (
    failure?.code === "provider_unavailable" &&
    (publisherRejection || unsupportedBuild)
  );
};

/** Require an exact pre-execution rejection, observed helper exit, or missing-Xvfb diagnostic. */
export const assertLinuxPackageProviderFailure = (execution) => {
  const failure = JSON.parse(execution.stdout);
  const details = failure?.details;
  const diagnostic = details?.diagnostics;
  const missingDisplayDependency =
    details?.failure_code === "runtime_dependency_unavailable" &&
    details.exit_code === 79 &&
    diagnostic?.component === "hopper_private_display" &&
    diagnostic.operation === "probe" &&
    diagnostic.reason === "missing_xvfb" &&
    diagnostic.status === "error" &&
    diagnostic.failure_code === "runtime_dependency_unavailable" &&
    diagnostic.strategy === "unavailable";
  if (
    execution.status !== 1 ||
    failure?.code !== "provider_unavailable" ||
    (!isUnsupportedHopperLaunchFailure(failure) && !missingDisplayDependency)
  )
    throw new Error(
      `packaged Linux Hopper verification did not fail closed: ${JSON.stringify(failure)}`,
    );
};

const hasPositiveProcedureCount = (result) =>
  typeof result === "object" &&
  result !== null &&
  result.operation === "binary_overview" &&
  Number.isInteger(result.normalized_result?.procedure_count) &&
  result.normalized_result.procedure_count > 0;
