import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  InspectWebEventListenersInput,
  WebEventListenersObservation,
} from "../../domain/webEventListeners.js";
import type { CdpRuntimeSources } from "./CdpRuntimeSources.js";
import { runtimeListenersSchema } from "./CdpRuntimeProtocol.js";
import { queryListenerSelector } from "./CdpListenerSelector.js";

/** Inspect native DOM listener descriptors without evaluating JavaScript or invoking handlers. */
export const captureWebEventListeners = async (
  input: InspectWebEventListenersInput,
  sources: CdpRuntimeSources,
  group: string,
): Promise<WebEventListenersObservation> => {
  const session = sources.session;
  session.beginCompletion();
  const unsubscribe = session.transport.connection.onEvent((event) =>
    sources.ingest(event),
  );
  try {
    for (const domain of ["Page", "Runtime", "Debugger", "DOM"])
      await session.enable(domain);
    await session.assertDocument();
    const document = z
      .object({ root: z.object({ nodeId: z.int().min(1) }) })
      .parse(await session.command("DOM.getDocument", { depth: 0 }));
    const selected = z
      .object({ nodeId: z.int().min(0) })
      .parse(
        await queryListenerSelector(
          session,
          document.root.nodeId,
          input.selector,
        ),
      );
    let backendNodeId: number | null = null;
    let descriptors: z.infer<typeof runtimeListenersSchema>["listeners"] = [];
    if (selected.nodeId !== 0) {
      const described = z
        .object({ node: z.object({ backendNodeId: z.int().min(1) }) })
        .parse(
          await session.command("DOM.describeNode", {
            nodeId: selected.nodeId,
          }),
        );
      backendNodeId = described.node.backendNodeId;
      const resolved = z
        .object({ object: z.object({ objectId: z.string().min(1) }) })
        .parse(
          await session.command("DOM.resolveNode", {
            nodeId: selected.nodeId,
            objectGroup: group,
          }),
        );
      descriptors = runtimeListenersSchema.parse(
        await session.command("DOMDebugger.getEventListeners", {
          objectId: resolved.object.objectId,
          depth: 0,
          pierce: false,
        }),
      ).listeners;
    }
    const retained = await sources.read(
      descriptors
        .map((listener) => listener.scriptId)
        .filter((id) => id.length > 0),
    );
    await session.assertDocument();
    sources.check();
    return {
      browser: session.discovery.version,
      target: session.target,
      inspected_at: new Date().toISOString(),
      selected_node: {
        selector: input.selector,
        match: selected.nodeId === 0 ? "not_found" : "found",
        backend_node_id: backendNodeId,
      },
      listeners: descriptors.map((listener) => ({
        type: listener.type,
        use_capture: listener.useCapture,
        passive: listener.passive,
        once: listener.once,
        location: sources.location(
          listener.scriptId,
          sources.scripts.get(listener.scriptId)?.url ?? null,
          listener.lineNumber,
          listener.columnNumber,
        ),
        execution: "unknown",
      })),
      sources: retained,
      cleanup: "unconfirmed",
      limitations: [
        ...(session.discovery.limitations ?? []),
        "Inspects listeners registered directly on the first native CSS match in the selected main document. Delegated ancestor listeners, descendants, closed shadow roots and framework registries are not enumerated.",
        "Native CDP listener descriptors report callback locations; registration time, dispatch history and UI causality remain unknown. REA does not dispatch an event, evaluate JavaScript or invoke a handler.",
        "Source identity uses this session's script ID and proven main-frame default-world metadata. Isolated or unknown worlds cannot establish website callback/source joins. A URL or sourceURL declaration never establishes identity or execution.",
        "Source text is retained inline with its independently computed UTF-8 digest; the producer hash is preserved separately. Missing source ownership or collected scripts remain explicit.",
        "REA releases its remote object group, disables enabled domains and detaches its transport; the externally owned page remains open.",
      ],
    };
  } finally {
    unsubscribe();
  }
};

/** Use an owned remote object namespace so cleanup does not release caller objects. */
export const eventListenerObjectGroup = (): string =>
  `rea-listeners-${randomUUID()}`;
