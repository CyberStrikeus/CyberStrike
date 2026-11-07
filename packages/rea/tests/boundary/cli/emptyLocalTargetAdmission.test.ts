import { Cli } from "incur";
import { expect, it, vi } from "vitest";
import { registerCoreBinaryCommands } from "../../../src/cli/coreBinaryCommands.js";
import { registerCoreNativeCommands } from "../../../src/cli/coreNativeCommands.js";
import { registerManagedCommands } from "../../../src/cli/managedCommands.js";
import { registerUtilityCommands } from "../../../src/cli/utilityCommands.js";
import { silentLogger } from "../../../src/logger.js";

const registry = () => {
  const failure = {
    ok: false as const,
    error: { code: "invalid_request", message: "Admitted target control" },
  };
  const run = () =>
    vi.fn(async (_path: string, ..._rest: unknown[]) => failure);
  const runDirectAnalysis = run();
  const runProviderAnalysis = run();
  const cli = Cli.create("empty-target-admission", { sync: false });
  registerCoreBinaryCommands(cli, silentLogger, runDirectAnalysis, {});
  registerCoreNativeCommands(cli, silentLogger, runDirectAnalysis);
  registerManagedCommands(cli, silentLogger, runProviderAnalysis);
  registerUtilityCommands(
    cli,
    silentLogger,
    {},
    {
      runProviderAnalysis,
      runSessionStatus: async () => ({ ok: false, error: null }),
    },
  );
  const serve = async (argv: readonly string[]): Promise<unknown> => {
    let stdout = "";
    await cli.serve([...argv, "--json"], {
      env: {},
      stdout: (text) => {
        stdout += text;
      },
      exit: () => undefined,
    });
    return JSON.parse(stdout);
  };
  return { serve, runs: [runDirectAnalysis, runProviderAnalysis] };
};

// Each command with its other required arguments; the target comes first.
const commands: readonly (readonly string[])[] = [
  ["inspect"],
  ["decompile", "main"],
  ["xrefs", "0x1000"],
  ["trace", "feature"],
  ["function", "0x1000"],
  ["instructions", "0x1000"],
  ["search", "name"],
  ["search-bytes", "00"],
  ["inspect-native-load-image"],
  ["read-bytes", "0x1000"],
  ["address-to-file-offset", "0x1000"],
  ["trace-native-values", "main"],
  ["inspect-native-instruction", "0x1000"],
  ["resolve-native-call-targets", "0x1000"],
  ["inspect-native-dispatch-metadata"],
  ["trace-native-ui-action", "openDocument:"],
  ["inspect-native-api", "0x1000"],
  ["annotate-native-function", "main", "--name", "entry"],
  ["inspect-managed-artifact"],
  ["inspect-managed-members"],
  ["inspect-managed-native-boundaries"],
  ["observe-native-ui", "--pid", "1", "--window-id", "1"],
  [
    "capture-native-ui-scenario",
    "--pid",
    "1",
    "--window-id",
    "1",
    "--steps",
    '[{"kind":"wait","milliseconds":0}]',
  ],
  ["inspect-macho"],
  ["inspect-signature"],
  ["list-architectures"],
  ["inspect-plist"],
  ["demangle-swift", "$s4main"],
];

it.each(commands)(
  "rejects an empty %s target before resolution and admits explicit .",
  async (command, ...rest) => {
    const { serve, runs } = registry();
    // docs/cli.md: an empty string never selects the working directory.
    expect(await serve([command, "", ...rest])).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: [
        expect.objectContaining({ path: "path", code: "too_small" }),
      ],
    });
    for (const run of runs) expect(run).not.toHaveBeenCalled();
    await serve([command, ".", ...rest]);
    expect(runs.flatMap((run) => run.mock.calls.map(([path]) => path))).toEqual(
      ["."],
    );
  },
);

it.each([
  { argv: ["", "."], field: "leftPath" },
  { argv: [".", ""], field: "rightPath" },
])(
  "rejects an empty compare-managed-members $field before reading either input",
  async ({ argv, field }) => {
    const { serve } = registry();
    expect(await serve(["compare-managed-members", ...argv])).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: [
        expect.objectContaining({ path: field, code: "too_small" }),
      ],
    });
  },
);
