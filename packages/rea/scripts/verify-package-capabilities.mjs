import {
  expandCapabilitiesOutput,
  expandProviderOutput,
} from "./lib/mcp-verifier-results.mjs";

/** Verify packaged capabilities, providers, and non-Linux search results. */
export async function verifyPackageCapabilitiesAndSearch({
  commands,
  cli,
  environment,
}) {
  const capabilities = expandCapabilitiesOutput(
    JSON.parse(
      await commands.run(cli, ["capabilities", "--json"], environment),
    ),
  );
  if (!Array.isArray(capabilities.capabilities))
    throw new Error("packaged capabilities CLI failed");
  const providers = expandProviderOutput(
    JSON.parse(await commands.run(cli, ["providers", "--json"], environment)),
  );
  const candidates = providers.analysis_provider_candidates;
  if (
    !Array.isArray(candidates) ||
    candidates.some(
      (candidate) =>
        typeof candidate?.provider?.id !== "string" ||
        candidate.selected !== false,
    ) ||
    providers.analysis_provider_binding !== null ||
    candidates.find(({ provider }) => provider?.id === "hopper")?.target_support
      ?.status !== "unknown"
  )
    throw new Error("packaged providers CLI failed");
  if (process.platform !== "linux") {
    const searchResult = JSON.parse(
      await commands.run(
        cli,
        [
          "search",
          process.execPath,
          "fixture",
          "--provider",
          "hopper",
          "--json",
        ],
        environment,
      ),
    );
    if (
      searchResult.operation !== "search_strings" ||
      !Array.isArray(searchResult.normalized_result)
    )
      throw new Error(
        `packaged search CLI failed: ${JSON.stringify(searchResult)}`,
      );
  }
}
