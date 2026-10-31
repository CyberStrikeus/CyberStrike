import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { Logger } from "pino";

import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import { FridaInstrumentationService } from "../application/frida/FridaInstrumentationService.js";
import type {
  FridaInstrumentationPort,
  FridaRemoteConnection,
} from "../application/frida/FridaInstrumentationPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import { logToolExecution } from "./toolLogging.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import type { ToolResultDelivery } from "./ToolResultDelivery.js";

/** Register Frida device discovery and persistent instrumentation operations. */
export const registerFridaTools = (
  server: McpServer,
  provider: FridaInstrumentationPort,
  logger: Logger,
  delivery: ToolResultDelivery,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  evidenceById?: EvidenceLookup,
): void => {
  const service = new FridaInstrumentationService(provider);
  const listDevices = toolContract("list_frida_devices");
  const listProcesses = toolContract("list_frida_processes");
  const start = toolContract("start_frida_session");
  const load = toolContract("load_frida_script");
  const resume = toolContract("resume_frida_session");
  const unload = toolContract("unload_frida_script");
  const status = toolContract("frida_session_status");
  const close = toolContract("close_frida_session");
  const instrument = toolContract("instrument_with_frida");

  server.registerTool(
    listDevices.name,
    toolRegistrationOptions(listDevices),
    async (input) => {
      const result = await logToolExecution(logger, listDevices.name, () =>
        service.listDevices(remoteConnection(input.remote)),
      );
      return delivery.toCallToolResult(result, listDevices);
    },
  );
  server.registerTool(
    listProcesses.name,
    toolRegistrationOptions(listProcesses),
    async (input) => {
      const remote = remoteConnection(input.remote);
      const result = await logToolExecution(logger, listProcesses.name, () =>
        service.listProcesses({
          ...(input.device_id === undefined
            ? {}
            : { deviceId: input.device_id }),
          ...(remote === undefined ? {} : { remote }),
        }),
      );
      return delivery.toCallToolResult(result, listProcesses);
    },
  );
  server.registerTool(
    start.name,
    toolRegistrationOptions(start),
    async (input, context: ServerContext) => {
      const remote = remoteConnection(input.remote);
      const selected = {
        ...(input.device_id === undefined ? {} : { deviceId: input.device_id }),
        ...(remote === undefined ? {} : { remote }),
      };
      const result = await logToolExecution(logger, start.name, () =>
        input.mode === "attach" && input.pid !== undefined
          ? service.startSession(
              {
                ...selected,
                mode: input.mode,
                pid: input.pid,
              },
              context.mcpReq.signal,
            )
          : input.mode === "spawn" && input.program !== undefined
            ? service.startSession(
                {
                  ...selected,
                  mode: input.mode,
                  program: input.program,
                  ...(input.argv === undefined ? {} : { argv: input.argv }),
                },
                context.mcpReq.signal,
              )
            : Promise.resolve({
                ok: false as const,
                error: new AnalysisInputError(start.name),
              }),
      );
      if (!result.ok)
        return delivery.toPartialErrorToolResult(
          result.error,
          start.returnsTargetContent,
          recordEvidence,
        );
      return delivery.toCallToolResult(
        {
          ok: true,
          value: jsonValueSchema.parse(sessionOutput(result.value)),
        },
        start,
      );
    },
  );
  server.registerTool(
    load.name,
    toolRegistrationOptions(load),
    async (input, context: ServerContext) => {
      const result = await logToolExecution(logger, load.name, () =>
        input.source_kind === "inline" && input.source !== undefined
          ? service.loadScript(
              input.session_id,
              {
                sourceKind: "inline",
                source: input.source,
              },
              context.mcpReq.signal,
            )
          : input.source_kind === "file" && input.path !== undefined
            ? service.loadScript(
                input.session_id,
                {
                  sourceKind: "file",
                  path: input.path,
                },
                context.mcpReq.signal,
              )
            : Promise.resolve({
                ok: false as const,
                error: new AnalysisInputError(load.name),
              }),
      );
      if (!result.ok)
        return delivery.toPartialErrorToolResult(
          result.error,
          load.returnsTargetContent,
          recordEvidence,
        );
      return delivery.toEvidenceToolResult(
        result.value,
        load,
        recordEvidence?.(result.value),
      );
    },
  );
  server.registerTool(
    resume.name,
    toolRegistrationOptions(resume),
    async (input, context: ServerContext) => {
      const result = await logToolExecution(logger, resume.name, () =>
        service.resumeSession(input.session_id, context.mcpReq.signal),
      );
      return result.ok
        ? delivery.toCallToolResult(
            { ok: true, value: { state: "running" } },
            resume,
          )
        : delivery.toCallToolResult(result, resume);
    },
  );
  server.registerTool(
    unload.name,
    toolRegistrationOptions(unload),
    async (input, context: ServerContext) => {
      const result = await logToolExecution(logger, unload.name, () =>
        service.unloadScript(
          input.session_id,
          input.script_id,
          context.mcpReq.signal,
        ),
      );
      return result.ok
        ? delivery.toCallToolResult(
            { ok: true, value: { unloaded: true } },
            unload,
          )
        : delivery.toCallToolResult(result, unload);
    },
  );
  server.registerTool(
    status.name,
    toolRegistrationOptions(status),
    async (input) => {
      const result = service.inspectStatus(input, {
        recordEvidence,
        evidenceById,
      });
      if (!result.ok) return delivery.toCallToolResult(result, status);
      return delivery.toEvidenceToolResult(
        result.value,
        status,
        recordEvidence?.(result.value),
      );
    },
  );
  server.registerTool(
    close.name,
    toolRegistrationOptions(close),
    async (input) => {
      const result = await logToolExecution(logger, close.name, () =>
        service.closeSession(input.session_id),
      );
      return result.ok
        ? delivery.toCallToolResult(
            { ok: true, value: { target_state: "unknown" } },
            close,
          )
        : delivery.toCallToolResult(result, close);
    },
  );
  server.registerTool(
    instrument.name,
    toolRegistrationOptions(instrument),
    async (input, context: ServerContext) => {
      const remote = remoteConnection(input.remote);
      const selected = {
        ...(input.device_id === undefined ? {} : { deviceId: input.device_id }),
        ...(remote === undefined ? {} : { remote }),
      };
      const source =
        input.source_kind === "inline" && input.source !== undefined
          ? { sourceKind: "inline" as const, source: input.source }
          : input.source_kind === "file" && input.path !== undefined
            ? { sourceKind: "file" as const, path: input.path }
            : undefined;
      if (source === undefined)
        return delivery.toCallToolResult(
          { ok: false, error: new AnalysisInputError(instrument.name) },
          instrument,
        );
      const operation =
        input.mode === "attach" && input.pid !== undefined
          ? service.instrument(
              {
                ...selected,
                mode: "attach",
                pid: input.pid,
                source,
                durationMs: input.duration_ms,
              },
              context.mcpReq.signal,
            )
          : input.mode === "spawn" && input.program !== undefined
            ? service.instrument(
                {
                  ...selected,
                  mode: "spawn",
                  program: input.program,
                  ...(input.argv === undefined ? {} : { argv: input.argv }),
                  source,
                  durationMs: input.duration_ms,
                },
                context.mcpReq.signal,
              )
            : Promise.resolve({
                ok: false as const,
                error: new AnalysisInputError(instrument.name),
              });
      const result = await logToolExecution(
        logger,
        instrument.name,
        () => operation,
      );
      if (!result.ok)
        return delivery.toPartialErrorToolResult(
          result.error,
          instrument.returnsTargetContent,
          recordEvidence,
        );
      return delivery.toEvidenceToolResult(
        result.value.evidence,
        instrument,
        recordEvidence?.(result.value.evidence),
      );
    },
  );
};

const remoteConnection = (
  input:
    | {
        readonly address: string;
        readonly token?: string | undefined;
        readonly certificate?: string | undefined;
        readonly origin?: string | undefined;
        readonly keepalive_interval?: number | undefined;
      }
    | undefined,
): FridaRemoteConnection | undefined =>
  input === undefined
    ? undefined
    : {
        address: input.address,
        ...(typeof input.token === "string" ? { token: input.token } : {}),
        ...(typeof input.certificate === "string"
          ? { certificate: input.certificate }
          : {}),
        ...(typeof input.origin === "string" ? { origin: input.origin } : {}),
        ...(typeof input.keepalive_interval === "number"
          ? { keepaliveInterval: input.keepalive_interval }
          : {}),
      };

const sessionOutput = (session: {
  readonly sessionId: string;
  readonly deviceId: string;
  readonly target: string;
  readonly pid: number;
  readonly mode: "attach" | "spawn";
  readonly state: "paused" | "running" | "detached";
}) => ({
  session_id: session.sessionId,
  device_id: session.deviceId,
  target: session.target,
  pid: session.pid,
  mode: session.mode,
  state: session.state,
});
