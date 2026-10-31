import type { CdpContextFrameClaim } from "./CdpScriptContextFacts.js";
import type { AsarHeaderAdmission } from "../config/asarHeaderAdmission.js";
import { digestCanonicalValue } from "../domain/canonicalDigest.js";
import type { ProgressReporter } from "../application/ProgressReporter.js";
import type {
  ElectronPageInspection,
  InspectElectronPageInput,
} from "../domain/javascript/electronObservation.js";
import { BrowserObservationError } from "../domain/browserObservationError.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import type { CdpConnection, CdpEvent } from "./CdpConnection.js";
import type { CdpEndpointDiscovery, CdpEndpointTarget } from "./CdpEndpoint.js";
import { CdpCaptureCompleteness } from "./CdpCaptureCompleteness.js";
import {
  delayWithCancellation,
  resourceContentSize,
  recordValue,
  recordsValue,
  type UnknownRecord,
  requiredRecord,
  cdpStringValue,
} from "./CdpCaptureValues.js";
import {
  frameTreeResources,
  cdpFrameUrl,
  snapshotDocuments,
  walkFrameTrees,
} from "./CdpCaptureDocuments.js";
import {
  cdpFrameRecordFacts,
  cdpFrameEventFacts,
  type CdpFrameFacts,
} from "./CdpFrameIdentity.js";
import { snapshotDocumentNodes, snapshotNodeAt } from "./CdpSnapshotNodes.js";
import { cdpSnapshotString } from "./CdpSnapshotStrings.js";
import {
  ingestElectronScriptEvent,
  type ElectronScriptDraft,
  type ElectronScriptMetadataRetention,
} from "./CdpElectronScriptEvents.js";
import { captureElectronScripts } from "./CdpElectronScripts.js";
import { captureElectronWorkers } from "./CdpElectronWorkers.js";
import { authorizedElectronFile } from "./ElectronFileScope.js";
import {
  compareUnicodeCodePoints,
  compositeKey,
} from "../domain/unicodeCodePointOrder.js";

interface ElectronContext {
  readonly connection: CdpConnection;
  readonly sessionId: string | undefined;
  readonly discovery: CdpEndpointDiscovery;
  readonly target: CdpEndpointTarget;
  readonly input: InspectElectronPageInput;
  /** Header admission resolved by the provider's composition root. */
  readonly asarHeaderAdmission: AsarHeaderAdmission;
  readonly signal?: AbortSignal;
  readonly progress?: ProgressReporter;
}

interface ElectronInspectionState {
  readonly completeness: CdpCaptureCompleteness;
  readonly scripts: ElectronScriptDraft[];
  readonly scriptMetadataRetention: ElectronScriptMetadataRetention;
  readonly executionContextFrames: Map<string, CdpContextFrameClaim>;
  readonly frameGenerations: Map<string, number>;
  readonly frameParents: Map<string, string | null>;
  readonly frameDocuments: Map<string, ElectronFrameDocument>;
  readonly authorizedFrameGenerations: Set<string>;
  readonly excludedFrameGenerations: Set<string>;
  readonly scriptGenerations: WeakMap<ElectronScriptDraft, number>;
  readonly limitations: string[];
  mainFrameId: string | undefined;
  navigationDuringCapture: boolean;
}

interface ElectronFrameInventory {
  readonly frames: ElectronPageInspection["frames"];
  readonly parents: ReadonlyMap<string, string | null>;
  readonly excludedFrameIds: ReadonlySet<string>;
}

interface ElectronFrameRead extends ElectronFrameInventory {
  readonly generations: ReadonlyMap<string, number>;
}

interface ElectronFrameDocument {
  readonly url: string;
  readonly loaderId: string;
  readonly parentId: string | null;
}

/** Passively inspect one Electron file page from the selected CDP endpoint. */
export const inspectCdpElectronPage = async (
  context: ElectronContext,
): Promise<ElectronPageInspection> => {
  const state: ElectronInspectionState = {
    completeness: new CdpCaptureCompleteness(),
    scripts: [],
    scriptMetadataRetention: { bytes: 2 },
    executionContextFrames: new Map(),
    frameGenerations: new Map(),
    frameParents: new Map(),
    frameDocuments: new Map(),
    authorizedFrameGenerations: new Set(),
    excludedFrameGenerations: new Set(),
    scriptGenerations: new WeakMap(),
    limitations: [
      ...(context.discovery.limitations ?? []),
      "Local file paths exposed by the selected CDP target are retained in the observation.",
      "REA does not evaluate renderer JavaScript, invoke Electron APIs, navigate, click, or close the page.",
      "Select include_script_sources to retain script contents.",
      "Script file_path is the admitted local-file URL or sourceURL label, not a verification that disk bytes supplied the runtime code. has_source_url retains CDP's sourceURL declaration flag; null or an omitted historical field is unknown.",
      "Known script frame identity is retained independently from frame_scope authorization. Unknown frame scope is attach-limited; scripts from known excluded document generations are omitted before source reads.",
      ...(context.target.attached === null
        ? [
            "CDP discovery could not establish the target's debugger attachment state.",
          ]
        : []),
    ],
    mainFrameId: undefined,
    navigationDuringCapture: false,
  };
  const removeListener = context.connection.onEvent((event) => {
    if (event.sessionId !== context.sessionId) return;
    advanceFrameGeneration(event, state);
    const priorScripts = state.scripts.length;
    ingestElectronScriptEvent({
      event,
      scripts: state.scripts,
      executionContextFrames: state.executionContextFrames,
      completeness: state.completeness,
      retention: state.scriptMetadataRetention,
    });
    const script = state.scripts[priorScripts];
    if (script?.frameId != null)
      state.scriptGenerations.set(
        script,
        state.frameGenerations.get(script.frameId) ?? 0,
      );
  });
  try {
    return await runElectronInspection(
      context,
      state,
      new Date().toISOString(),
    );
  } finally {
    removeListener();
  }
};

const runElectronInspection = async (
  context: ElectronContext,
  state: ElectronInspectionState,
  startedAt: string,
): Promise<ElectronPageInspection> => {
  const initialRead = await authorizeInitialFrames(context, state);
  const initialFrames = initialRead.frames;
  const main = initialFrames.at(0);
  if (main === undefined)
    throw new BrowserObservationError("inspect_web_page", "target_not_allowed");
  if (unprovenFrameIds(initialRead, state).has(main.frame_id))
    throw new BrowserObservationError("inspect_web_page", "target_changed");
  state.mainFrameId = main.frame_id;
  authorizeFrameGenerations(initialRead, state);
  await enableElectronCapture(context);
  await delayWithCancellation(
    context.input.observation_ms,
    "inspect_electron_page",
    context.signal,
  );
  // Current inventory owns structural content; script attribution retains
  // separately authorized generations observed during the whole window.
  const currentRead = await readCurrentFrames(
    context,
    state,
    state.completeness,
  );
  const frames = currentRead.frames;
  authorizeFrameGenerations(currentRead, state);
  if (
    frameInventoryIdentity(initialFrames) !== frameInventoryIdentity(frames)
  ) {
    state.limitations.push(
      "The frame inventory changed during observation. Returned frames describe the current inventory; retained script frame IDs can identify earlier authorized frames.",
    );
  }
  const captured = await captureElectronContent(context, state, frames);
  const finalFrames = await assertStableMainFrame(
    context,
    state,
    main.file_path,
  );
  if (frameInventoryIdentity(frames) !== frameInventoryIdentity(finalFrames)) {
    for (const section of ["frames", "scripts", "workers"] as const)
      state.completeness.attachLimited(section);
    state.limitations.push(
      "The frame inventory changed during content capture; frame membership and dependent attribution are incomplete.",
    );
  }
  await report(context.progress, 3, "Electron inspection complete");
  if (state.navigationDuringCapture)
    throw new BrowserObservationError("inspect_web_page", "target_changed");
  return {
    browser: context.discovery.version,
    target: {
      target_id: context.target.id,
      type: context.target.type,
      title: context.target.title,
      file_path: main.file_path,
      attached: context.target.attached,
    },
    capture_window: {
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      observation_ms: context.input.observation_ms,
    },
    completeness: state.completeness.snapshot(),
    frames,
    ...captured,
    limitations: state.limitations,
  };
};

/** Sibling enumeration order is not a change to frame identity or ownership. */
const frameInventoryIdentity = (
  frames: ElectronPageInspection["frames"],
): string =>
  digestCanonicalValue(
    frames
      .map((frame) =>
        compositeKey([frame.frame_id, frame.parent_frame_id, frame.file_path]),
      )
      .sort(compareUnicodeCodePoints),
  );

const authorizeFrameGenerations = (
  read: ElectronFrameRead,
  state: ElectronInspectionState,
): void => {
  const unproven = markUnstableFrameRead(read, state);
  for (const [id, parent] of read.parents)
    if (!unproven.has(id)) state.frameParents.set(id, parent);
  for (const frame of read.frames) {
    const generation = read.generations.get(frame.frame_id) ?? 0;
    if (unproven.has(frame.frame_id)) continue;
    state.authorizedFrameGenerations.add(
      compositeKey([frame.frame_id, generation]),
    );
  }
  for (const id of read.excludedFrameIds)
    if (!unproven.has(id))
      state.excludedFrameGenerations.add(
        compositeKey([id, read.generations.get(id) ?? 0]),
      );
};

/** A changed ancestor also invalidates descendants first discovered in this tree. */
const unprovenFrameIds = (
  read: ElectronFrameRead,
  state: ElectronInspectionState,
): Set<string> => {
  const children = new Map<string, string[]>();
  const unproven = new Set<string>();
  for (const [id, parent] of read.parents) {
    if (
      (read.generations.get(id) ?? 0) !== (state.frameGenerations.get(id) ?? 0)
    )
      unproven.add(id);
    if (parent === null) continue;
    if (!read.parents.has(parent)) unproven.add(id);
    const siblings = children.get(parent) ?? [];
    siblings.push(id);
    children.set(parent, siblings);
  }
  const pending = [...unproven];
  while (pending.length > 0) {
    const parent = pending.pop();
    if (parent === undefined) continue;
    for (const child of children.get(parent) ?? []) {
      if (unproven.has(child)) continue;
      unproven.add(child);
      pending.push(child);
    }
  }
  return unproven;
};

/** Lifecycle events invalidate future attribution, never earlier script facts. */
const advanceFrameGeneration = (
  event: CdpEvent,
  state: ElectronInspectionState,
): void => {
  const facts = cdpFrameEventFacts(event);
  // A same-document event changes the cached identity, never its generation
  // or authority. Later full-frame replay must compare with that current URL.
  if (event.method === "Page.navigatedWithinDocument") {
    const id = facts.frameId;
    if (id === null) return;
    if (id === state.mainFrameId) state.navigationDuringCapture = true;
    const previous = state.frameDocuments.get(id);
    if (previous === undefined) return;
    const url = cdpFrameUrl(facts.source);
    if (url === undefined || url === "") state.frameDocuments.delete(id);
    else state.frameDocuments.set(id, { ...previous, url });
    return;
  }
  if (
    ![
      "Page.frameNavigated",
      "Page.frameDetached",
      "Page.frameAttached",
    ].includes(event.method)
  )
    return;
  const id = facts.frameId;
  if (id === null) return;
  const document =
    facts.kind === "navigated" ? frameDocument(facts) : undefined;
  const previous = state.frameDocuments.get(id);
  if (
    document !== undefined &&
    previous !== undefined &&
    sameFrameDocument(document, previous) &&
    document.url === previous.url
  )
    return;
  invalidateFrameGenerations(id, state);
  // Event ancestry only invalidates future facts; it never authorizes a frame.
  const parent = facts.parentId;
  if (facts.parentRelation === "child" && parent !== null)
    state.frameParents.set(id, parent);
  else state.frameParents.delete(id);
  if (document !== undefined) retainFrameDocument(id, document, state);
};

/** A stable loader and parent identify the document independently of its URL. */
const sameFrameDocument = (
  left: ElectronFrameDocument,
  right: ElectronFrameDocument,
): boolean =>
  left.loaderId === right.loaderId && left.parentId === right.parentId;

/** URL observations can move without replacing the loader-owned document. */
const retainFrameDocument = (
  id: string,
  document: ElectronFrameDocument,
  state: ElectronInspectionState,
): void => {
  const previous = state.frameDocuments.get(id);
  if (
    previous !== undefined &&
    sameFrameDocument(previous, document) &&
    previous.url === document.url
  )
    return;
  if (
    id === state.mainFrameId &&
    previous !== undefined &&
    previous.url !== document.url
  )
    state.navigationDuringCapture = true;
  state.frameDocuments.set(id, document);
};

/** Tree and event observations invalidate the same document generation. */
const invalidateFrameGenerations = (
  id: string,
  state: ElectronInspectionState,
): void => {
  const pending = [id];
  const changed = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || changed.has(current)) continue;
    changed.add(current);
    if (current === state.mainFrameId) state.navigationDuringCapture = true;
    state.frameGenerations.set(
      current,
      (state.frameGenerations.get(current) ?? 0) + 1,
    );
    state.frameDocuments.delete(current);
    for (const [child, parent] of state.frameParents)
      if (parent === current) pending.push(child);
  }
};

/** Only a known URL and loader together can prove a duplicate document event. */
const frameDocument = (
  facts: CdpFrameFacts,
): ElectronFrameDocument | undefined => {
  const url = cdpFrameUrl(facts.source);
  if (
    url === undefined ||
    url === "" ||
    facts.loaderId === undefined ||
    facts.loaderId === "" ||
    facts.loaderIssue !== null ||
    (facts.parentRelation !== "root" && facts.parentRelation !== "child")
  )
    return undefined;
  return { url, loaderId: facts.loaderId, parentId: facts.parentId };
};

/** Protocol identities are observations, separate from asynchronous file authorization. */
const seedFrameDocuments = (
  result: unknown,
  generations: ReadonlyMap<string, number>,
  documents: ReadonlyMap<string, ElectronFrameDocument>,
  state: ElectronInspectionState,
): void => {
  const tree = recordValue(recordValue(result)?.frameTree);
  if (tree === undefined) return;
  for (const entry of walkFrameTrees(tree)) {
    const facts = cdpFrameRecordFacts(recordValue(entry.frame));
    const id = facts.frameId;
    const document = frameDocument(facts);
    if (
      id !== null &&
      document !== undefined &&
      // A same-document event can update identity without changing generation.
      // Do not overwrite that newer observation with this in-flight tree.
      state.frameDocuments.get(id) === documents.get(id) &&
      (generations.get(id) ?? 0) === (state.frameGenerations.get(id) ?? 0)
    ) {
      const previous = documents.get(id);
      if (previous !== undefined && !sameFrameDocument(previous, document))
        invalidateFrameGenerations(id, state);
      retainFrameDocument(id, document, state);
    }
  }
};

const authorizeInitialFrames = async (
  context: ElectronContext,
  state: ElectronInspectionState,
): Promise<ElectronFrameRead> => {
  await report(context.progress, 1, "Authorizing Electron file frames");
  await context.connection.send(
    "Page.enable",
    {},
    context.sessionId,
    context.signal,
  );
  // Initial frames authorize attachment; the later inventory owns coverage.
  return await readCurrentFrames(context, state, new CdpCaptureCompleteness());
};

const readCurrentFrames = async (
  context: ElectronContext,
  state: ElectronInspectionState,
  completeness: CdpCaptureCompleteness,
): Promise<ElectronFrameRead> => {
  // Snapshot before the asynchronous protocol and filesystem boundaries.
  // A tree can only authorize the generations for which it was requested.
  const generations = new Map(state.frameGenerations);
  const documents = new Map(state.frameDocuments);
  const result = await context.connection.send(
    "Page.getFrameTree",
    {},
    context.sessionId,
    context.signal,
  );
  seedFrameDocuments(result, generations, documents, state);
  const inventory = await captureFrames(
    result,
    completeness,
    context.asarHeaderAdmission,
    context.signal,
  );
  const main = inventory.frames[0];
  if (main === undefined || inventory.parents.get(main.frame_id) !== null)
    throw new BrowserObservationError("inspect_web_page", "target_not_allowed");
  return { ...inventory, generations };
};

const markUnstableFrameRead = (
  read: ElectronFrameRead,
  state: ElectronInspectionState,
): Set<string> => {
  const unproven = unprovenFrameIds(read, state);
  if (unproven.size === 0) return unproven;
  for (const section of ["frames", "scripts", "workers"] as const)
    state.completeness.attachLimited(section);
  state.limitations.push(
    "A frame or its ancestry could not be verified across the tree read and local file checks; this read cannot authorize an unchecked document.",
  );
  return unproven;
};

const enableElectronCapture = async (
  context: ElectronContext,
): Promise<void> => {
  await context.connection.send(
    "Runtime.enable",
    {},
    context.sessionId,
    context.signal,
  );
  await context.connection.send(
    "Debugger.enable",
    {},
    context.sessionId,
    context.signal,
  );
};

const captureElectronContent = async (
  context: ElectronContext,
  state: ElectronInspectionState,
  frames: ElectronPageInspection["frames"],
): Promise<
  Pick<ElectronPageInspection, "dom" | "scripts" | "resources" | "workers">
> => {
  await report(context.progress, 2, "Capturing Electron structure");
  const frameIds = new Set(frames.map((frame) => frame.frame_id));
  const resources = await captureResources(context, state.completeness);
  const dom = await captureDom(context, state.completeness);
  const scripts = await captureElectronScripts({
    connection: context.connection,
    sessionId: context.sessionId,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
    request: context.input,
    scripts: state.scripts,
    frameScopeForScript: (script) => {
      const generation = state.scriptGenerations.get(script);
      if (script.frameId !== null && generation !== undefined) {
        const key = compositeKey([script.frameId, generation]);
        if (state.excludedFrameGenerations.has(key))
          return { state: "excluded" };
        if (state.authorizedFrameGenerations.has(key))
          return { state: "authorized", frameId: script.frameId };
      }
      return { state: "unknown", frameId: script.frameId };
    },
    completeness: state.completeness,
    asarHeaderAdmission: context.asarHeaderAdmission,
  });
  const workers = await captureElectronWorkers({
    connection: context.connection,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
    target: context.target,
    request: context.input,
    frameIds,
    completeness: state.completeness,
    limitations: state.limitations,
    asarHeaderAdmission: context.asarHeaderAdmission,
  });
  return { dom, scripts, resources, workers };
};

const assertStableMainFrame = async (
  context: ElectronContext,
  state: ElectronInspectionState,
  expectedPath: string,
): Promise<ElectronPageInspection["frames"]> => {
  const generations = new Map(state.frameGenerations);
  const documents = new Map(state.frameDocuments);
  const result = await context.connection.send(
    "Page.getFrameTree",
    {},
    context.sessionId,
    context.signal,
  );
  seedFrameDocuments(result, generations, documents, state);
  const afterPath = await mainFilePath(
    result,
    context.asarHeaderAdmission,
    context.signal,
  );

  if (afterPath === undefined)
    throw new BrowserObservationError("inspect_web_page", "target_not_allowed");
  if (state.navigationDuringCapture || afterPath !== expectedPath)
    throw new BrowserObservationError("inspect_web_page", "target_changed");
  const completeness = new CdpCaptureCompleteness();
  const inventory = await captureFrames(
    result,
    completeness,
    context.asarHeaderAdmission,
    context.signal,
  );
  const { frames } = inventory;
  if (
    state.navigationDuringCapture ||
    (state.mainFrameId !== undefined &&
      (generations.get(state.mainFrameId) ?? 0) !==
        (state.frameGenerations.get(state.mainFrameId) ?? 0))
  )
    throw new BrowserObservationError("inspect_web_page", "target_changed");
  markUnstableFrameRead({ ...inventory, generations }, state);
  if (
    completeness
      .snapshot()
      .conditions.some((condition) => condition !== "complete_within_window")
  ) {
    for (const section of ["frames", "scripts", "workers"] as const)
      state.completeness.attachLimited(section);
    state.limitations.push(
      "The final frame inventory was incomplete; frame stability could not be fully verified.",
    );
  }
  return frames;
};

export const captureFrames = async (
  result: unknown,
  completeness: CdpCaptureCompleteness,
  asarHeaderAdmission: AsarHeaderAdmission,
  signal?: AbortSignal,
): Promise<ElectronFrameInventory> => {
  const frameTree = recordValue(requiredRecord(result).frameTree);
  if (frameTree === undefined)
    throw new BrowserObservationError("inspect_web_page", "protocol_error");
  const frames: ElectronPageInspection["frames"] = [];
  const enclosingParents = new Map<UnknownRecord, string>();
  const parents = new Map<string, string | null>();
  const excludedFrameIds = new Set<string>();
  for (const tree of walkFrameTrees(frameTree, (count) =>
    completeness.exclude("frames", "invalid_protocol_value", count),
  )) {
    throwIfElectronInspectionCancelled(signal);
    const frame = recordValue(tree.frame);
    const facts = cdpFrameRecordFacts(frame);
    const frameId = facts.frameId;
    const parentId = facts.parentId;
    // Only the enclosing tree root may omit its parent. Children must agree
    // with a structurally proved enclosing frame, independent of its file policy.
    // Malformed ancestry cannot grant proof to a frame or its descendants.
    const ancestryKnown =
      tree === frameTree
        ? facts.parentRelation === "root"
        : facts.parentRelation === "child" &&
          parentId !== null &&
          parentId === enclosingParents.get(tree);
    if (frame === undefined || frameId === null || !ancestryKnown) {
      completeness.exclude("frames", "invalid_protocol_value");
      continue;
    }
    parents.set(frameId, parentId ?? null);
    for (const child of recordsValue(tree.childFrames))
      enclosingParents.set(child, frameId);
    const path = await authorizedElectronFile(
      cdpStringValue(frame.url) ?? "",
      signal,
      "inspect_electron_page",
      asarHeaderAdmission,
    );
    if (path === undefined) {
      completeness.exclude("frames", "out_of_target_scope");
      excludedFrameIds.add(frameId);
      continue;
    }
    frames.push({
      frame_id: frameId,
      parent_frame_id: parentId ?? null,
      file_path: path,
    });
  }
  return { frames, parents, excludedFrameIds };
};

const captureResources = async (
  context: ElectronContext,
  completeness: CdpCaptureCompleteness,
): Promise<ElectronPageInspection["resources"]> => {
  const result = await context.connection.send(
    "Page.getResourceTree",
    {},
    context.sessionId,
    context.signal,
  );
  const root = recordValue(requiredRecord(result).frameTree);
  if (root === undefined)
    throw new BrowserObservationError("inspect_web_page", "protocol_error");
  const resources: ElectronPageInspection["resources"] = [];
  const seen = new Set<string>();
  for (const resource of frameTreeResources(root, (count) =>
    completeness.exclude("resources", "invalid_protocol_value", count),
  )) {
    throwIfElectronInspectionCancelled(context.signal);
    const path = await authorizedElectronFile(
      cdpStringValue(resource.url) ?? "",
      context.signal,
      "inspect_electron_page",
      context.asarHeaderAdmission,
    );
    if (path === undefined) {
      completeness.exclude("resources", "out_of_target_scope");
      continue;
    }
    const contentSize = resourceContentSize(resource.contentSize);
    if (!contentSize.ok)
      completeness.exclude("resources", "invalid_protocol_value");
    const item = {
      file_path: path,
      type: cdpStringValue(resource.type) ?? "Other",
      mime_type: cdpStringValue(resource.mimeType) ?? "",
      content_size: contentSize.ok ? contentSize.value : null,
    };
    const resourceKey = `electron_resource_${digestCanonicalValue(item, "CDP capture")}`;
    if (seen.has(resourceKey)) continue;
    seen.add(resourceKey);
    resources.push({
      resource_key: resourceKey,
      ...item,
    });
  }
  return resources.sort((left, right) =>
    compareUnicodeCodePoints(left.resource_key, right.resource_key),
  );
};

const captureDom = async (
  context: ElectronContext,
  completeness: CdpCaptureCompleteness,
): Promise<ElectronPageInspection["dom"]> => {
  const nodeValueLengthUnit = "utf8-bytes";
  const result = requiredRecord(
    await context.connection.send(
      "DOMSnapshot.captureSnapshot",
      { computedStyles: [], includePaintOrder: false, includeDOMRects: false },
      context.sessionId,
      context.signal,
    ),
  );
  const invalid = (count: number | null) =>
    completeness.exclude("dom", "invalid_protocol_value", count);
  if (!Array.isArray(result.strings)) {
    invalid(null);
    return {
      total_nodes: 0,
      node_value_length_unit: nodeValueLengthUnit,
      nodes: [],
    };
  }
  const strings = result.strings.map(cdpStringValue);
  const nodes: ElectronPageInspection["dom"]["nodes"] = [];
  let total = 0;
  for (const document of snapshotDocuments(result.documents, invalid)) {
    throwIfElectronInspectionCancelled(context.signal);
    const documentUrl = cdpSnapshotString(strings, document.documentURL);
    if (documentUrl === undefined) {
      invalid(1);
      continue;
    }
    if (
      (await authorizedElectronFile(
        documentUrl,
        context.signal,
        "inspect_electron_page",
        context.asarHeaderAdmission,
      )) === undefined
    ) {
      completeness.exclude("dom", "out_of_target_scope");
      continue;
    }
    // The shared snapshot owner validates the parallel node arrays.
    const documentNodes = snapshotDocumentNodes(document.nodes, strings);
    if (documentNodes === undefined) {
      invalid(1);
      continue;
    }
    if (documentNodes.excessAttributes > 0)
      invalid(documentNodes.excessAttributes);
    const baseIndex = total;
    total += documentNodes.nodeTypes.length;
    for (let index = 0; index < documentNodes.nodeTypes.length; index += 1) {
      const admitted = snapshotNodeAt(documentNodes, index);
      if (!admitted.ok) {
        invalid(1);
        continue;
      }
      const { nodeType, nodeName, nodeValue, parent, attributes } =
        admitted.value;
      nodes.push({
        index: baseIndex + index,
        parent_index: parent < 0 ? -1 : baseIndex + parent,
        node_type: nodeType,
        node_name: nodeName,
        node_value_length: Buffer.byteLength(nodeValue),
        attribute_names: attributes.map(([name]) => name),
      });
    }
  }
  return {
    total_nodes: total,
    node_value_length_unit: nodeValueLengthUnit,
    nodes,
  };
};

const mainFilePath = async (
  result: unknown,
  asarHeaderAdmission: AsarHeaderAdmission,
  signal?: AbortSignal,
): Promise<string | undefined> => {
  const frameTree = recordValue(requiredRecord(result).frameTree);
  const frame = recordValue(frameTree?.frame);
  return await authorizedElectronFile(
    cdpStringValue(frame?.url) ?? "",
    signal,
    "inspect_electron_page",
    asarHeaderAdmission,
  );
};

const throwIfElectronInspectionCancelled = (signal?: AbortSignal): void => {
  if (signal?.aborted === true)
    throw new AnalysisCancelledError("inspect_electron_page", {
      cause: signal.reason,
    });
};

const report = async (
  progress: ProgressReporter | undefined,
  completed: number,
  message: string,
): Promise<void> =>
  await progress?.report({
    phase: "browser_observation",
    completed,
    total: 3,
    message,
    ...(completed === 3 ? { terminal: true } : {}),
  });
