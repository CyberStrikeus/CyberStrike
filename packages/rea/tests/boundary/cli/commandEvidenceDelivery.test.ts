import { Cli, z } from "incur";
import pino from "pino";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { registerReverseEngineeringCommands } from "../../../src/cli/reverseEngineeringCommands.js";
import type { CliInstance } from "../../../src/cli/types.js";
import { CLI_COMMANDS } from "../../../src/cliCommandNames.js";
import {
  createEvidence,
  parseEvidence,
  evidenceSchema,
} from "../../../src/domain/evidence.js";
import { parseEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import { ok } from "../../../src/domain/result.js";
import { OwnedStagedOutput } from "../../../src/filesystem/OwnedStagedOutput.js";
import { GdbSessionManager } from "../../../src/gdb/GdbSessionManager.js";
import { TestReverseEngineeringService } from "../../support/reverseEngineeringService.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const kinds = ["objdump", "architectures", "gdb"] as const;
const fixture = async (kind: (typeof kinds)[number]) => {
  const directory = await createTestTempDirectory("rea-command-delivery-");
  const path = join(directory, "input.bin");
  await writeFile(path, "local CLI publication fixture");
  const runProvider = vi.fn(async () => ({
    stdout: "opaque provider output\n",
    stderr: "provider diagnostic\n",
  }));
  const service = new TestReverseEngineeringService({
    environment: {},
    run: runProvider,
  });
  const closeService = vi.spyOn(service, "close");
  const manager = new GdbSessionManager({ platform: "linux", environment: {} });
  const sessionId = "00000000-0000-4000-8000-000000000001";
  const report = {
    command: "show architecture",
    mi: "5^done",
    records: ['~"architecture\\n"', "unknown record", "5^done"],
    console: '~"architecture\\n"',
    target: "",
    log: "",
    completion_status: "complete" as const,
    output_truncated: false,
  };
  const parent = createEvidence(
    undefined,
    { id: "gdb", name: "GDB", version: null },
    {
      operation: "gdb_console",
      parameters: { session_id: sessionId, command: report.command },
      result: report,
      rawResult: report,
    },
  );
  const start = vi
    .spyOn(manager, "start")
    .mockResolvedValue(ok({ session_id: sessionId, mi_version: "mi3" }));
  vi.spyOn(manager, "execute").mockResolvedValue(
    ok({ result: report, evidence: parent }),
  );
  const close = vi
    .spyOn(manager, "close")
    .mockResolvedValue(ok({ target_state: "none_observed" }));
  const closeAll = vi.spyOn(manager, "closeAll").mockResolvedValue(undefined);
  const createManager = vi.fn(() => manager);
  const cli = Cli.create("rea-cli-delivery-test", {
    version: "1",
    sync: false,
  });
  registerReverseEngineeringCommands(
    cli as unknown as CliInstance,
    pino({ enabled: false }),
    {},
    createManager,
    () => service,
  );
  onTestFinished(async () => {
    await service.close();
    await manager.closeAll();
  });
  const commandName =
    kind === "gdb"
      ? CLI_COMMANDS.debugWithGdb
      : kind === "objdump"
        ? CLI_COMMANDS.inspectWithObjdump
        : CLI_COMMANDS.listObjdumpArchitectures;
  const command = Cli.toCommands.get(cli)?.get(commandName);
  if (command === undefined) throw new Error("CLI command was not registered");
  const argsSchema = Reflect.get(command, "args");
  const optionsSchema = Reflect.get(command, "options");
  const execute = Reflect.get(command, "run");
  if (
    !(argsSchema instanceof z.ZodObject) ||
    !(optionsSchema instanceof z.ZodObject) ||
    typeof execute !== "function"
  )
    throw new Error("Missing CLI command schemas or callback");
  const args =
    kind === "gdb"
      ? { command: report.command }
      : kind === "objdump"
        ? { path, operation: "file_headers" }
        : {};
  const invoke = async (options: Record<string, unknown>): Promise<unknown> =>
    execute({
      args: argsSchema.parse(args),
      options: optionsSchema.parse({
        ...(kind === "gdb" ? { inferiorTty: "/dev/pts/caller-fixture" } : {}),
        ...options,
      }),
    });
  return {
    directory,
    invoke,
    runProvider,
    createManager,
    start,
    close,
    closeAll,
    closeService,
    parent,
    report,
  };
};

it.each(kinds)(
  "publishes %s summaries with exact complete parents",
  async (kind) => {
    const f = await fixture(kind);
    const destination = join(f.directory, "complete.json");
    const output = z
      .object({
        summary: evidenceSchema,
        evidence_bundle: z.object({ path: z.string(), bytes: z.number() }),
      })
      .parse(
        await f.invoke({ detail: "summary", evidence_output: destination }),
      );
    const selected = parseEvidence(output.summary);
    const serialized = await readFile(destination, "utf8");
    const bundle = JSON.parse(serialized);
    expect(output.evidence_bundle.bytes).toBe(Buffer.byteLength(serialized));
    expect(bundle.records).toHaveLength(1);
    const parent = parseEvidence(bundle.records[0]);
    expect(parent.raw_result).toEqual(parent.normalized_result);
    expect(selected.normalized_result).toMatchObject({
      parent_evidence_id: parent.evidence_id,
      source_parameters: parent.parameters,
      source_provider: parent.provider,
    });
    expect(selected.raw_result).toBeNull();
    expect(output.evidence_bundle.path).toBe(destination);
    if (kind === "gdb") {
      expect(parent).toEqual(f.parent);
      expect(selected.normalized_result).toMatchObject({
        artifact: null,
        summary: { records: f.report.records },
      });
      expect(f.close).toHaveBeenCalledOnce();
      expect(f.closeAll).toHaveBeenCalledOnce();
    } else {
      expect(selected.normalized_result).toMatchObject({
        summary: parent.normalized_result,
      });
      expect(f.runProvider).toHaveBeenCalledOnce();
      expect(f.closeService).toHaveBeenCalledOnce();
    }
    if (kind !== "objdump") {
      expect(parent.subject).toBeNull();
      expect(selected.subject).toBeNull();
      expect(selected.normalized_result).toMatchObject({ artifact: null });
    }
  },
);

it.each(kinds)(
  "rejects %s summary without a destination before provider work",
  async (kind) => {
    const f = await fixture(kind);
    const output = await f.invoke({ detail: "summary" });
    expect(output).toMatchObject({ code: "invalid_request" });
    expect(JSON.stringify(output)).toContain("evidence_output");
    expect(f.createManager).not.toHaveBeenCalled();
    expect(f.start).not.toHaveBeenCalled();
    expect(f.runProvider).not.toHaveBeenCalled();
  },
);

it.each(kinds)(
  "preserves an existing %s destination and reports publication failure with source Evidence",
  async (kind) => {
    const f = await fixture(kind);
    const destination = join(f.directory, "existing.json");
    const original = Buffer.from("caller-selected content\n");
    await writeFile(destination, original);
    const output = await f.invoke({
      detail: "summary",
      evidence_output: destination,
    });
    expect(Buffer.compare(await readFile(destination), original)).toBe(0);
    expect(output).toHaveProperty("code");
    expect(output).not.toHaveProperty("summary");
    expect(output).toHaveProperty("details.partial_observation.evidence_id");
    if (kind === "gdb") {
      expect(f.close).toHaveBeenCalledOnce();
      expect(f.closeAll).toHaveBeenCalledOnce();
    } else expect(f.closeService).toHaveBeenCalledOnce();
  },
);

const interruptAt = (method: "assertReadyForPublication" | "close"): void => {
  const original = OwnedStagedOutput.prototype[method];
  const seam = vi
    .spyOn(OwnedStagedOutput.prototype, method)
    .mockImplementationOnce(async function (
      this: OwnedStagedOutput,
      ...arguments_: Parameters<OwnedStagedOutput[typeof method]>
    ) {
      await Reflect.apply(original, this, arguments_);
      process.emit("SIGINT");
    });
  onTestFinished(() => {
    seam.mockRestore();
    process.exitCode = undefined;
  });
};

it.each(kinds)(
  "keeps the committed %s receipt when SIGINT arrives during final staging cleanup",
  async (kind) => {
    const f = await fixture(kind);
    const destination = join(f.directory, "complete.json");
    interruptAt("close");
    const output = await f.invoke({
      detail: "summary",
      evidence_output: destination,
    });
    expect(process.exitCode).toBe(130);
    const serialized = await readFile(destination, "utf8");
    const parent = parseEvidenceBundle(JSON.parse(serialized)).records[0]!;
    expect(output).toMatchObject({
      code: "cancelled",
      details: {
        diagnostics: {
          evidence_bundle: {
            path: destination,
            bytes: Buffer.byteLength(serialized),
          },
        },
        partial_observation: {
          evidence_links: [parent.evidence_id],
          normalized_result: { parent_evidence_id: parent.evidence_id },
        },
      },
    });
    expect(await readdir(f.directory)).not.toContainEqual(
      expect.stringMatching(/^\.rea-write-/u),
    );
  },
);

it.each(kinds)(
  "publishes no %s bundle or receipt when SIGINT arrives before commit",
  async (kind) => {
    const f = await fixture(kind);
    const destination = join(f.directory, "complete.json");
    interruptAt("assertReadyForPublication");
    const output = await f.invoke({
      detail: "summary",
      evidence_output: destination,
    });
    expect(process.exitCode).toBe(130);
    expect(output).toMatchObject({ code: "cancelled" });
    expect(output).not.toHaveProperty("details.diagnostics");
    expect(JSON.stringify(output)).not.toContain(destination);
    expect(output).toHaveProperty("details.partial_observation.raw_result");
    expect(await readdir(f.directory)).toEqual(["input.bin"]);
  },
);
