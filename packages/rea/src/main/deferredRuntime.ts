import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  STDIO_DEFAULT_MAX_BUFFER_SIZE,
  type McpRequestContext,
} from "@modelcontextprotocol/server";
import {
  RECORDED_MCP_CATALOG_SHA256,
  type RecordedMcpCatalog,
} from "../recordedMcpCatalog.js";
import type { AppConfig } from "../config/types.js";
import {
  resolveMcpInputSchemaProfile,
  type McpInputSchemaProfile,
} from "../config/mcpInputSchemaProfile.js";
import { DeferredEvidenceMcpServer } from "../server/DeferredEvidenceMcpServer.js";
import { ToolResultDelivery } from "../server/ToolResultDelivery.js";
import { createLogger } from "../logger.js";
import { reportMcpShutdownFailure } from "./shutdown.js";
import type { McpServerHandle, RuntimeDependencies } from "./types.js";
import { SERVER_START_FAILED } from "./messages.js";
import { reportMcpTransportError } from "./reportMcpTransportError.js";
import { OwnedMcpServers } from "./OwnedMcpServers.js";

/** Verify the build-owned artifact before trusting its exact typed projection. */
const readCatalog = (profile: McpInputSchemaProfile): RecordedMcpCatalog => {
  const bytes = readFileSync(
    new URL(
      profile === "full" ? "../mcp-catalog-full.json" : "../mcp-catalog.json",
      import.meta.url,
    ),
  );
  if (
    createHash("sha256").update(bytes).digest("hex") !==
    RECORDED_MCP_CATALOG_SHA256?.[profile]
  )
    throw new Error(SERVER_START_FAILED);
  // The digest binds these bytes to the same compiled producer and SDK converter.
  const catalog: unknown = JSON.parse(bytes.toString("utf8"));
  if (
    typeof catalog !== "object" ||
    catalog === null ||
    Reflect.get(catalog, "version") !== 1
  )
    throw new Error(SERVER_START_FAILED);
  return catalog as RecordedMcpCatalog;
};

const initializeRuntime = async (
  server: DeferredEvidenceMcpServer,
  dependencies: RuntimeDependencies,
  context: McpRequestContext,
  config: AppConfig,
  startedAt: string,
): Promise<void> => {
  let shutdown: (() => Promise<void>) | undefined;
  let closeSession: (() => Promise<void>) | undefined;
  let sessionClosed = false;
  server.ownRuntimeCleanup(async () => {
    if (shutdown !== undefined) return shutdown();
    const results = await Promise.allSettled([
      server.closePartialRuntime(),
      (async () => {
        if (!sessionClosed && closeSession !== undefined) {
          await closeSession();
          sessionClosed = true;
        }
      })(),
    ]);
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, "MCP startup cleanup failed");
  });
  const [{ runEager }, { createServer }] = await Promise.all([
    import("./eagerRuntime.js"),
    import("../server/createServer.js"),
  ]);
  const result = await runEager(
    {
      ...dependencies,
      // The outer SDK transport already owns and frames this stream. Eager
      // materialization owns providers only, never another copy of raw input.
      stdin: undefined,
      registerShutdown: () => () => undefined,
      captureShutdown: (close) => {
        shutdown = close;
      },
      createServer: (source, options) => {
        if (source.kind === "session")
          closeSession = async () => {
            const result = await source.session.close({
              retainProviderDocuments: true,
            });
            if (!result.ok) throw result.error;
          };
        return createServer(source, {
          ...options,
          mcpServer: server,
          startedAt,
        });
      },
      serve: (factory) => {
        let close: (() => Promise<void>) | undefined;
        server.materialize(() => {
          const configured = factory(context);
          if (configured !== server) throw new Error(SERVER_START_FAILED);
          close = configured.close.bind(configured);
        });
        return { close: () => close?.() ?? Promise.resolve() };
      },
    },
    config,
  );
  if (result !== 0 || shutdown === undefined)
    throw new Error(SERVER_START_FAILED);
};

/** Own every SDK-created server, including discarded discovery instances. */
export const runDeferred = async (
  dependencies: RuntimeDependencies,
  config: AppConfig,
): Promise<number> => {
  const serverLogger = createLogger("mcp", config.logLevel).child({
    layer: "server",
  });
  const profile = resolveMcpInputSchemaProfile(config.mcpInputSchemaProfile);
  let firstCatalog: RecordedMcpCatalog | undefined = readCatalog(profile);
  const servers = new OwnedMcpServers<DeferredEvidenceMcpServer>();
  let handle: McpServerHandle | undefined;
  let attempt: Promise<void> | undefined;
  let unregister: () => void = () => undefined;
  let closing = false;
  let finishServing!: () => void;
  const serving = new Promise<void>((resolve) => {
    finishServing = resolve;
  });
  const close = (): Promise<void> => {
    closing = true;
    attempt ??= Promise.resolve()
      .then(async () => {
        // A transport published after shutdown begins is still ours to close.
        await serving;
        const ownedHandle = handle;
        const handleResults = Promise.allSettled(
          ownedHandle === undefined
            ? []
            : [
                Promise.resolve()
                  .then(() => ownedHandle.close())
                  .then(() => {
                    handle = undefined;
                  }),
              ],
        );
        // Servers published before the serving handle settles join this owner;
        // closeAll seals further publication before taking its snapshot.
        const [handles, instances] = await Promise.all([
          handleResults,
          servers.closeAll(),
        ]);
        const failures = [...handles, ...instances].flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (failures.length > 0)
          throw new AggregateError(failures, "MCP cleanup failed");
        unregister();
      })
      .catch((cause) => {
        attempt = undefined;
        throw cause;
      });
    return attempt;
  };
  const requestClose = () => {
    void close().catch((cause) =>
      reportMcpShutdownFailure(cause, dependencies, serverLogger),
    );
  };
  try {
    // Keep cleanup reachable even if serve creates a server and then throws.
    unregister = dependencies.registerShutdown(requestClose);
    dependencies.captureShutdown?.(close);
    try {
      handle = await dependencies.serve(
        (context) => {
          const server = servers.create(() => {
            const catalog = firstCatalog ?? readCatalog(profile);
            firstCatalog = undefined;
            const startedAt = new Date().toISOString();
            const server = new DeferredEvidenceMcpServer(
              catalog,
              new ToolResultDelivery(
                config.mcpMaxResponseBytes ?? STDIO_DEFAULT_MAX_BUFFER_SIZE,
              ),
              (target) =>
                initializeRuntime(
                  target,
                  dependencies,
                  context,
                  config,
                  startedAt,
                ).catch((cause) => {
                  dependencies.setExitCode(1);
                  throw cause;
                }),
              config.mcpMaxInputElements,
            );
            return server;
          });
          const previous = server.server.onclose;
          server.server.onclose = () => {
            previous?.();
            requestClose();
          };
          return server;
        },
        {
          onerror: (error) =>
            reportMcpTransportError(
              error,
              serverLogger,
              dependencies.writeStderr,
            ),
        },
      );
    } finally {
      finishServing();
    }
  } catch (cause) {
    finishServing();
    serverLogger.error(
      { error: cause instanceof Error ? cause.message : String(cause) },
      SERVER_START_FAILED,
    );
    try {
      await close();
    } catch (cleanupCause) {
      throw new AggregateError(
        [cause, cleanupCause],
        "MCP startup and cleanup failed",
      );
    }
    dependencies.writeStderr(`${SERVER_START_FAILED}\n`);
    return 1;
  }
  if (closing) await close();
  return 0;
};
