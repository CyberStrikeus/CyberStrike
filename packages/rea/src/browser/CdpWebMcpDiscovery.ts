import {
  cdpFrameRecordFacts,
  cdpFrameEventFacts,
  type CdpFrameFacts,
} from "./CdpFrameIdentity.js";
import { createHash } from "node:crypto";

import type { ProgressReporter } from "../application/ProgressReporter.js";
import type {
  DiscoverWebMcpToolsInput,
  WebMcpDiscovery,
} from "../domain/webMcpDiscovery.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import { digestCanonicalValue } from "../domain/canonicalDigest.js";
import {
  compareUnicodeCodePoints,
  compositeKey,
} from "../domain/unicodeCodePointOrder.js";
import type { CdpEndpointDiscovery, CdpEndpointTarget } from "./CdpEndpoint.js";
import type { CdpConnection, CdpEvent } from "./CdpConnection.js";
import { CdpCaptureCompleteness } from "./CdpCaptureCompleteness.js";
import { BrowserObservationError } from "../domain/browserObservationError.js";
import { cdpOriginScopeRefusal } from "./CdpOriginScopeError.js";
import {
  allowedSanitizedUrl,
  delayWithCancellation,
  numberValue,
  recordValue,
  cdpStringValue,
  type UnknownRecord,
} from "./CdpCaptureValues.js";
import {
  classifyCdpFrameUrl,
  observeCdpFrameUrl,
  mainFrameUrl,
  observeMainFrameUrl,
  walkFrameTrees,
} from "./CdpCaptureDocuments.js";
import { optionalCdpCommand } from "./CdpOptionalCommand.js";
import {
  cdpSourceCoordinates,
  topCallFrame,
} from "./CdpCaptureEventHelpers.js";

interface DiscoveryContext {
  readonly connection: CdpConnection;
  readonly sessionId: string | undefined;
  readonly discovery: CdpEndpointDiscovery;
  readonly target: CdpEndpointTarget;
  readonly input: DiscoverWebMcpToolsInput;
  readonly signal?: AbortSignal;
  readonly progress?: ProgressReporter;
}

/** Discover WebMCP registrations without evaluating or invoking page code. */
export const discoverWebMcp = async (
  context: DiscoveryContext,
): Promise<WebMcpDiscovery> => {
  const origins = new Set(context.input.allowed_origins);
  const limitations = [
    "Page-declared tool metadata is untrusted and is never registered or invoked by REA.",
    "Discovery uses only WebMCP.enable and toolsAdded/toolsRemoved; WebMCP.invokeTool is never called.",
  ];
  const completeness = new CdpCaptureCompleteness();
  await context.connection.send(
    "Page.enable",
    {},
    context.sessionId,
    context.signal,
  );
  const frameTree = await context.connection.send(
    "Page.getFrameTree",
    {},
    context.sessionId,
    context.signal,
  );
  const initialUrl = requiredDiscoveryFrameUrl(frameTree, origins);
  const frameUrls = new Map<string, FrameScopeFrame>();
  const tools = new Map<string, WebMcpDiscovery["tools"]["items"][number]>();
  const frameScope = {
    origins,
    frames: frameUrls,
    tools,
    completeness,
    transientFrames: new Set<string>(),
    resolvedTransientFrames: new Set<string>(),
  };
  ingestInitialFrameTree(frameTree, frameScope);
  if (
    [...frameUrls.values()].some(
      (frame) => frame.parentFrameId !== null && frame.origin !== null,
    )
  ) {
    completeness.attachLimited("webmcp_tools");
    limitations.push(
      "WebMCP.enable replay does not establish coverage of pre-existing subframe registrations. Later live registrations are retained, but cannot recover descriptors omitted before attachment.",
    );
  }
  const removeListener = context.connection.onEvent((event) => {
    if (event.sessionId !== context.sessionId) return;
    if (ingestFrameScopeEvent(event, frameScope)) return;
    ingestWebMcpEvent({
      event,
      input: context.input,
      frames: frameUrls,
      tools,
      completeness,
      transientFrames: frameScope.transientFrames,
      resolvedTransientFrames: frameScope.resolvedTransientFrames,
    });
  });
  await context.progress?.report({
    phase: "browser_observation",
    completed: 1,
    total: 2,
    message: "Enabling passive WebMCP discovery",
  });
  try {
    const enabled = await optionalCdpCommand(
      context,
      "WebMCP.enable",
      {},
      limitations,
    );
    const available = enabled !== undefined;
    if (!available) {
      completeness.unavailable("webmcp_tools");
    } else
      // CDP sends the enable response before the required toolsAdded replay.
      await delayWithCancellation(
        context.input.observation_ms,
        "discover_webmcp_tools",
        context.signal,
      );
    await assertStableAuthorizedFrame(context, initialUrl, origins);
    if (frameScope.transientFrames.size > 0)
      completeness.attachLimited("webmcp_tools");
    return buildWebMcpResult({
      context,
      frameTree,
      tools,
      completeness,
      limitations,
      available,
    });
  } finally {
    removeListener();
    await context.progress?.report({
      phase: "browser_observation",
      completed: 2,
      total: 2,
      message: "WebMCP discovery complete",
      terminal: true,
    });
  }
};

interface FrameScopeState {
  readonly origins: ReadonlySet<string>;
  readonly frames: Map<string, FrameScopeFrame>;
  readonly tools: Map<string, WebMcpDiscovery["tools"]["items"][number]>;
  readonly completeness: CdpCaptureCompleteness;
  readonly transientFrames: Set<string>;
  readonly resolvedTransientFrames: Set<string>;
}

interface FrameScopeFrame {
  readonly url: string;
  readonly origin: string | null;
  readonly parentFrameId: string | null;
  readonly loaderId?: string | undefined;
}

const ingestInitialFrameTree = (
  frameTree: unknown,
  state: FrameScopeState,
): void => {
  const root = recordValue(recordValue(frameTree)?.frameTree);
  if (root === undefined) {
    state.completeness.exclude("webmcp_tools", "invalid_protocol_value");
    return;
  }
  for (const tree of walkFrameTrees(root, (omittedCount) =>
    state.completeness.exclude(
      "webmcp_tools",
      "invalid_protocol_value",
      omittedCount,
    ),
  )) {
    const facts = cdpFrameRecordFacts(recordValue(tree.frame));
    if (tree !== root && facts.parentRelation === "root") {
      invalidateFrameFacts(facts, state);
      continue;
    }
    handleFrameUpdate(facts, state, true);
  }
};

const ingestFrameScopeEvent = (
  event: CdpEvent,
  state: FrameScopeState,
): boolean => {
  const facts = cdpFrameEventFacts(event);
  switch (facts.kind) {
    case "detached":
      if (facts.identityIssue !== null || facts.frameId === null) {
        invalidateFrameFacts(facts, state);
        return true;
      }
      removeFrame(facts.frameId, state.frames, state.tools);
      state.transientFrames.delete(facts.frameId);
      state.resolvedTransientFrames.delete(facts.frameId);
      return true;
    case "navigated":
      return handleFrameUpdate(facts, state, true);
    case "within_document":
      return handleFrameUpdate(facts, state, false);
    default:
      return false;
  }
};

/** Malformed declarations cannot preserve cached authority for an attributable frame. */
const invalidateFrameFacts = (
  facts: CdpFrameFacts,
  state: FrameScopeState,
): void => {
  state.completeness.exclude("webmcp_tools", "invalid_protocol_value");
  if (facts.frameId === null) return;
  removeFrame(facts.frameId, state.frames, state.tools);
  state.transientFrames.delete(facts.frameId);
  state.resolvedTransientFrames.delete(facts.frameId);
};

const handleFrameUpdate = (
  sourceFacts: CdpFrameFacts,
  state: FrameScopeState,
  documentCommitted: boolean,
): boolean => {
  const frameId = sourceFacts.frameId;
  if (
    sourceFacts.identityIssue !== null ||
    sourceFacts.parentIssue !== null ||
    sourceFacts.loaderIssue !== null ||
    frameId === null
  ) {
    invalidateFrameFacts(sourceFacts, state);
    return true;
  }
  const observation = observeCdpFrameUrl(sourceFacts.source);
  const facts = classifyCdpFrameUrl(observation, state.origins);
  if (observation.kind !== "observed") {
    removeFrameTools(frameId, state.tools);
    state.frames.delete(frameId);
    state.resolvedTransientFrames.delete(frameId);
    state.completeness.exclude("webmcp_tools", "invalid_protocol_value");
    if (facts.scope === "outside_policy") {
      state.transientFrames.delete(frameId);
      state.completeness.exclude("webmcp_tools", "out_of_target_scope");
    } else state.transientFrames.add(frameId);
    return true;
  }
  // Chromium can briefly commit an inherited, empty document while replacing
  // a subframe. That intermediate URL says nothing about the frame's eventual
  // scope or its registered tools; wait for a committed URL and fresh replay.
  // Without those observations, discovery remains attach-limited.
  if (isTransientFrameUrl(observation.scopeUrl)) {
    if (documentCommitted) {
      removeFrameTools(frameId, state.tools);
      state.transientFrames.add(frameId);
      state.resolvedTransientFrames.delete(frameId);
    }
    return true;
  }
  updateFrameScope(sourceFacts, frameId, facts, state, documentCommitted);
  return true;
};

const updateFrameScope = (
  sourceFacts: CdpFrameFacts,
  frameId: string,
  facts: ReturnType<typeof classifyCdpFrameUrl>,
  state: FrameScopeState,
  documentCommitted: boolean,
): void => {
  if (facts.url === undefined || facts.origin === null) {
    removeFrameTools(frameId, state.tools);
    state.frames.delete(frameId);
    state.transientFrames.delete(frameId);
    state.resolvedTransientFrames.delete(frameId);
    state.completeness.exclude("webmcp_tools", "out_of_target_scope");
    return;
  }
  const previous = state.frames.get(frameId);
  const loaderId = documentCommitted
    ? sourceFacts.loaderId
    : previous?.loaderId;
  if (hasNewDocument(documentCommitted, previous, facts.url, loaderId))
    removeFrameTools(frameId, state.tools);
  if (documentCommitted && state.transientFrames.has(frameId))
    state.resolvedTransientFrames.add(frameId);
  state.frames.set(frameId, {
    url: facts.url,
    origin: facts.origin,
    ...(loaderId === undefined ? {} : { loaderId }),
    parentFrameId:
      sourceFacts.parentRelation === "not_applicable"
        ? (previous?.parentFrameId ?? null)
        : sourceFacts.parentId,
  });
};

const hasNewDocument = (
  documentCommitted: boolean,
  previous: FrameScopeFrame | undefined,
  url: string,
  loaderId: string | undefined,
): boolean =>
  documentCommitted &&
  previous !== undefined &&
  (previous.url !== url ||
    (loaderId !== undefined &&
      previous.loaderId !== undefined &&
      previous.loaderId !== loaderId));

const removeFrameTools = (
  frameId: string,
  tools: Map<string, WebMcpDiscovery["tools"]["items"][number]>,
): void => {
  for (const [key, tool] of tools)
    if (tool.frame_id === frameId) tools.delete(key);
};

const isTransientFrameUrl = (url: string): boolean => {
  if (url === "") return true;
  try {
    const base = new URL(url);
    return (
      base.protocol === "about:" &&
      base.search === "" &&
      (base.pathname === "blank" || base.pathname === "srcdoc")
    );
  } catch (cause: unknown) {
    void cause;
    return false;
  }
};

const removeFrame = (
  frameId: string,
  frames: Map<string, FrameScopeFrame>,
  tools: Map<string, WebMcpDiscovery["tools"]["items"][number]>,
): void => {
  const pending = [frameId];
  const removed = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || removed.has(current)) continue;
    removed.add(current);
    for (const [candidate, frame] of frames)
      if (frame.parentFrameId === current) pending.push(candidate);
    frames.delete(current);
  }
  for (const [key, tool] of tools)
    if (removed.has(tool.frame_id)) tools.delete(key);
};

const assertStableAuthorizedFrame = async (
  context: DiscoveryContext,
  initialUrl: string | undefined,
  origins: ReadonlySet<string>,
): Promise<void> => {
  const finalTree = await context.connection.send(
    "Page.getFrameTree",
    {},
    context.sessionId,
    context.signal,
  );
  const finalUrl = requiredDiscoveryFrameUrl(finalTree, origins);
  if (finalUrl !== initialUrl)
    throw new BrowserObservationError("inspect_web_page", "target_changed");
};

const requiredDiscoveryFrameUrl = (
  result: unknown,
  origins: ReadonlySet<string>,
): string => {
  const observed = observeMainFrameUrl(result);
  const facts = classifyCdpFrameUrl(observed, origins);
  if (facts.scope === "outside_policy" || facts.scope === "unsupported")
    throw cdpOriginScopeRefusal("discover_webmcp_tools");
  if (observed.kind !== "observed")
    throw new BrowserObservationError("inspect_web_page", "protocol_error");
  if (facts.url === undefined)
    throw new BrowserObservationError("inspect_web_page", "target_not_allowed");
  return observed.url;
};

interface WebMcpIngestOptions {
  readonly event: CdpEvent;
  readonly input: DiscoverWebMcpToolsInput;
  readonly frames: ReadonlyMap<
    string,
    { readonly url: string; readonly origin: string | null }
  >;
  readonly tools: Map<string, WebMcpDiscovery["tools"]["items"][number]>;
  readonly completeness: CdpCaptureCompleteness;
  readonly transientFrames: Set<string>;
  readonly resolvedTransientFrames: Set<string>;
}

const ingestWebMcpEvent = (options: WebMcpIngestOptions): void => {
  const {
    event,
    input,
    frames,
    tools,
    completeness,
    transientFrames,
    resolvedTransientFrames,
  } = options;
  if (
    event.method !== "WebMCP.toolsAdded" &&
    event.method !== "WebMCP.toolsRemoved"
  )
    return;
  const params = recordValue(event.params);
  if (params === undefined) {
    completeness.exclude("webmcp_tools", "invalid_protocol_value");
    return;
  }
  if (event.method === "WebMCP.toolsRemoved") {
    for (const removed of webMcpEventTools(params.tools, completeness)) {
      const name = cdpStringValue(removed.name);
      const frameId = cdpStringValue(removed.frameId);
      if (name === undefined || frameId === undefined) {
        completeness.exclude("webmcp_tools", "invalid_protocol_value");
        continue;
      }
      for (const [key, tool] of tools)
        if (tool.name === name && tool.frame_id === frameId) tools.delete(key);
    }
    return;
  }
  for (const declared of webMcpEventTools(params.tools, completeness)) {
    const frameId = cdpStringValue(declared.frameId);
    if (frameId !== undefined && transientFrames.has(frameId)) {
      if (!resolvedTransientFrames.has(frameId)) continue;
      transientFrames.delete(frameId);
      resolvedTransientFrames.delete(frameId);
    }
    const normalized = normalizeTool(declared, input, frames, completeness);
    if (normalized === undefined) continue;
    tools.set(normalized.tool_key, normalized);
  }
};

const webMcpEventTools = (
  value: unknown,
  completeness: CdpCaptureCompleteness,
): UnknownRecord[] => {
  if (!Array.isArray(value)) {
    completeness.exclude("webmcp_tools", "invalid_protocol_value");
    return [];
  }
  const records: UnknownRecord[] = [];
  for (const item of value) {
    const record = recordValue(item);
    if (record === undefined) {
      completeness.exclude("webmcp_tools", "invalid_protocol_value");
      continue;
    }
    records.push(record);
  }
  return records;
};

const normalizeTool = (
  value: UnknownRecord,
  input: DiscoverWebMcpToolsInput,
  frames: ReadonlyMap<
    string,
    { readonly url: string; readonly origin: string | null }
  >,
  completeness: CdpCaptureCompleteness,
): WebMcpDiscovery["tools"]["items"][number] | undefined => {
  const frameId = cdpStringValue(value.frameId);
  const name = cdpStringValue(value.name);
  const frame = frameId === undefined ? undefined : frames.get(frameId);
  if (frameId === undefined || name === undefined) {
    completeness.exclude("webmcp_tools", "invalid_protocol_value");
    return undefined;
  }
  if (frame?.origin === null || frame === undefined) {
    completeness.exclude("webmcp_tools", "out_of_target_scope");
    return undefined;
  }
  const description = cdpStringValue(value.description) ?? "";
  const annotations = recordValue(value.annotations);
  const malformedAnnotations =
    Object.hasOwn(value, "annotations") && annotations === undefined;
  if (malformedAnnotations)
    completeness.exclude("webmcp_tools", "invalid_protocol_value");
  const annotation = (key: string): boolean | null => {
    if (annotations === undefined || !Object.hasOwn(annotations, key))
      return null;
    const hint = annotations[key];
    if (typeof hint === "boolean") return hint;
    completeness.exclude("webmcp_tools", "invalid_protocol_value");
    return null;
  };
  const consequential = annotation("consequential");
  const unknownConsequential =
    malformedAnnotations ||
    (annotations !== undefined &&
      Object.hasOwn(annotations, "consequential") &&
      typeof annotations.consequential !== "boolean");
  const declaration = Object.hasOwn(value, "inputSchema")
    ? jsonValueSchema.safeParse(value.inputSchema)
    : undefined;
  if (declaration?.success === false)
    completeness.exclude("webmcp_tools", "invalid_protocol_value");
  const schema = declaration?.success === true ? declaration.data : null;
  const registrationFrame = topCallFrame(value.stackTrace);
  const coordinates = cdpSourceCoordinates(
    registrationFrame.ok ? registrationFrame.value : undefined,
  );
  if (!registrationFrame.ok || coordinates.invalid)
    completeness.exclude("webmcp_tools", "invalid_protocol_value");
  return {
    tool_key: toolKey(frame.url, frameId, name),
    name,
    description,
    frame_id: frameId,
    frame_url: frame.url,
    owner_origin: frame.origin,
    declaration_kind:
      numberValue(value.backendNodeId) === undefined
        ? "imperative"
        : "declarative",
    input_schema: schema,
    input_schema_sha256:
      declaration?.success === true ? digestCanonicalValue(schema) : null,
    annotations: {
      read_only: annotation("readOnly"),
      untrusted_content: annotation("untrustedContent"),
      ...(unknownConsequential ? {} : { consequential }),
      autosubmit: annotation("autosubmit"),
    },
    registration_source: registrationSource(
      registrationFrame.ok && !coordinates.invalid
        ? registrationFrame.value
        : undefined,
      new Set(input.allowed_origins),
    ),
    trust: "page-declared-untrusted",
  };
};

const registrationSource = (
  frame: UnknownRecord | undefined,
  allowedOrigins: ReadonlySet<string>,
): WebMcpDiscovery["tools"]["items"][number]["registration_source"] => {
  const url = allowedSanitizedUrl(frame?.url, allowedOrigins);
  const coordinates = cdpSourceCoordinates(frame);
  return frame === undefined || url === undefined
    ? null
    : {
        url: url.url,
        line: coordinates.line,
        column: coordinates.column,
      };
};

interface WebMcpResultOptions {
  readonly context: DiscoveryContext;
  readonly frameTree: unknown;
  readonly tools: ReadonlyMap<
    string,
    WebMcpDiscovery["tools"]["items"][number]
  >;
  readonly completeness: CdpCaptureCompleteness;
  readonly limitations: string[];
  readonly available: boolean;
}

const buildWebMcpResult = (options: WebMcpResultOptions): WebMcpDiscovery => {
  const { context, frameTree, tools, completeness, limitations, available } =
    options;
  const targetUrl = mainFrameUrl(frameTree) ?? context.target.url;
  const sanitized = allowedSanitizedUrl(
    targetUrl,
    new Set(context.input.allowed_origins),
  );
  return {
    browser: context.discovery.version,
    target: {
      target_id: context.target.id,
      url: sanitized?.url ?? "[unsupported-url]",
      origin: sanitized?.origin ?? "",
    },
    status: available ? "available" : "unavailable",
    tools: {
      total: tools.size + completeness.droppedTotal,
      items: [...tools.values()].sort((left, right) =>
        compareUnicodeCodePoints(left.tool_key, right.tool_key),
      ),
    },
    completeness: completeness.snapshot(),
    limitations,
  };
};

const toolKey = (frameUrl: string, frameId: string, name: string): string =>
  // Registrations without a known admitted frame are excluded above, so the
  // frame ID here always distinguishes owners. Composite tuple keeps a NUL
  // inside one field from collapsing two registrations before hashing.
  `webmcp_${createHash("sha256")
    .update(compositeKey([frameUrl, frameId, name]))
    .digest("hex")}`;
