import { z } from "zod";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { BrowserObservationError } from "../../domain/browserObservationError.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import type {
  ObserveWebExecutionInput,
  WebExecution,
  WebExecutionObservation,
} from "../../domain/webExecution.js";
import { CdpExecutionCollection } from "./CdpExecutionCollection.js";
import { preciseCoverageSchema } from "./CdpRuntimeProtocol.js";
import { normalizePreciseCoverage } from "./CdpPreciseCoverage.js";
import type { CdpRuntimeSources } from "./CdpRuntimeSources.js";

/** Capture one explicit resetting coverage sample and its request-source relationships. */
export const captureWebExecution = async (
  input: ObserveWebExecutionInput,
  sources: CdpRuntimeSources,
): Promise<WebExecutionObservation> => {
  const session = sources.session;
  const collection = new CdpExecutionCollection(sources);
  const { window, requests } = collection;
  try {
    for (const domain of ["Page", "Runtime", "Debugger", "Network", "Profiler"])
      await session.enable(domain);
    await session.assertDocument();
    sources.check();
    session.preciseCoverageMayBeActive = true;
    const started = z.object({ timestamp: z.number().min(0) }).parse(
      await session.command("Profiler.startPreciseCoverage", {
        callCount: true,
        detailed: true,
        allowTriggeredUpdates: false,
      }),
    );
    sources.check();
    window.check();
    if (window.reason !== undefined)
      throw new BrowserObservationError(
        session.operation,
        window.reason === "session_detached"
          ? "target_session_detached"
          : "target_changed",
        {
          detail: executionWindowEndDetail(
            session.target.target_id,
            window.reason,
          ),
        },
      );
    const waiting = window.start(input.observation_ms);
    // Cancellation may arrive while asynchronous progress is being delivered.
    void waiting.catch(() => undefined);
    await session.options.progress?.report({
      phase: "browser_execution",
      completed: 1,
      total: 2,
      message:
        "Browser execution observation armed; perform the requested action now",
    });
    const reason = await waiting;
    session.beginCompletion();
    if (session.options.signal?.aborted)
      throw new AnalysisCancelledError(session.operation, {
        cause: session.options.signal.reason,
      });
    sources.check();
    requests.check();
    let raw: unknown;
    if (reason === "window_elapsed") {
      await session.assertDocument();
      raw = await session.command("Profiler.takePreciseCoverage");
    }
    collection.freezeMetadata();
    await stopPreciseCoverage(session, reason);
    session.preciseCoverageMayBeActive = false;
    const requestItems = requests.result();
    const parsed =
      raw === undefined ? undefined : preciseCoverageSchema.safeParse(raw);
    if (parsed !== undefined && !parsed.success)
      throw new AnalysisOutputError(
        session.operation,
        `Malformed precise coverage: ${parsed.error.message}`,
      );
    const mainScripts = [...sources.scripts.keys()].filter((id) =>
      sources.belongsToDocument(id),
    );
    const reportedIds = new Set(
      parsed?.success === true
        ? parsed.data.result.map((script) => script.scriptId)
        : [],
    );
    const ids = [
      ...mainScripts,
      ...requestItems
        .flatMap((request) => request.callsites.map((site) => site.script_id))
        .filter((id) => id.length > 0),
    ];
    const retained = await sources.read(ids);
    if (reason === "window_elapsed") await session.assertDocument();
    sources.check();
    const verifiedRequests = requests.result();
    const verifiedMainScripts = mainScripts.filter((id) =>
      sources.belongsToDocument(id),
    );
    const sample =
      parsed?.success === true
        ? normalizePreciseCoverage(parsed.data, sources, retained)
        : undefined;
    await session.options.progress?.report({
      phase: "browser_execution",
      completed: 2,
      total: 2,
      message: "Browser execution observation ended",
      terminal: true,
    });
    return {
      browser: session.discovery.version,
      target: session.target,
      window: {
        armed_at: window.armedAt ?? new Date().toISOString(),
        ended_at: window.endedAt ?? new Date().toISOString(),
        requested_ms: input.observation_ms,
        end_reason: reason,
        producer_started_seconds: started.timestamp,
        producer_sampled_seconds: sample?.timestamp ?? null,
      },
      coverage: sample?.coverage ?? {
        state: "unavailable",
        reason: `The observation ended with ${reason}; no complete final precise-coverage sample was retained.`,
        offset_units: "utf16-code-units",
        end_offset: "exclusive",
        scripts: [],
        excluded_scripts: 0,
      },
      requests: verifiedRequests,
      excluded_requests: requests.excluded,
      script_inventory: {
        main_document_scripts: verifiedMainScripts.length,
        not_reported_script_ids: verifiedMainScripts.filter(
          (id) => !reportedIds.has(id),
        ),
        coverage_absence: "unknown",
      },
      sources: retained,
      instrumentation: {
        resets_execution_counters: true,
        disables_optimized_execution: true,
        takes_one_resetting_sample: sample !== undefined,
        executes_selected_code: false,
        cleanup: "unconfirmed",
        page_ownership: "external",
      },
      limitations: [
        ...(session.discovery.limitations ?? []),
        "Website source ownership requires the selected main frame and a proven default execution world. Isolated, worker and unknown worlds are excluded from coverage/source joins; referenced producer context metadata is retained.",
        "Precise coverage resets counters, retains execution records and prevents optimized execution until stopped. Timing and JIT behavior are affected.",
        "Only the selected main document's proven frame/context scripts are attributed. Child frames, workers, service workers, WebAssembly and scripts without ownership metadata remain outside this operation.",
        "V8 reports nested function/block ranges and counts, not a chronological trace. Counts must not be summed across overlapping ranges; zero counts concern this instrumented window only.",
        "Previously parsed scripts may be absent from a precise sample. Their source inventory is retained, but missing coverage never means zero execution or an unexecuted function.",
        "A detailed-coverage request does not guarantee block granularity for already compiled functions. When is_block_coverage is false, branch execution is unknown; REA preserves the function-only producer ranges.",
        "The local armed/end clock and backend coverage timestamps are distinct clocks. Counters start when the backend accepts instrumentation, before the armed receipt, and end at the resetting sample after the requested window. Counts may include execution during those command intervals; requests are restricted to the locally armed window.",
        "Source metadata is collected through the final resetting sample, then frozen for source joins. Known identities remain checked during asynchronous source completion; newly parsed scripts after that cutoff are outside this evidence.",
        "Request callsites are producer-reported initiators associated by session script ID; they do not establish UI causality. Unresolved asynchronous parent IDs are retained without fetching their stacks.",
        "Producer hashes and UTF-8 digests of retained text are distinct identities. Inline script locations use reported resource offsets; anonymous/eval/sourceURL names are declarations.",
        "Metadata has an 8 MiB script budget and 8 MiB request budget; complete retained sources have a 32 MiB budget. Resource failures return no partial success. The externally owned browser's CPU and memory are not controlled by REA.",
      ],
    };
  } finally {
    collection.close();
  }
};

const stopPreciseCoverage = async (
  session: CdpRuntimeSources["session"],
  reason: WebExecution["window"]["end_reason"],
): Promise<void> => {
  try {
    await session.command("Profiler.stopPreciseCoverage");
  } catch (cause: unknown) {
    if (
      (reason !== "target_terminated" && reason !== "session_detached") ||
      !(cause instanceof AnalysisError)
    )
      throw cause;
    cause.retainDiagnostics({
      observed_window: {
        target_id: session.target.target_id,
        end_reason: reason,
      },
    });
    throw cause;
  }
};

const executionWindowEndDetail = (
  targetId: string,
  reason: WebExecution["window"]["end_reason"],
): string => {
  if (reason === "session_detached")
    return `The debugging session for selected target ${targetId} detached before execution observation could be armed; the target may still exist.`;
  if (reason === "target_terminated")
    return `Selected target ${targetId} crashed before execution observation could be armed.`;
  return `Selected target ${targetId} changed documents before execution observation could be armed.`;
};
