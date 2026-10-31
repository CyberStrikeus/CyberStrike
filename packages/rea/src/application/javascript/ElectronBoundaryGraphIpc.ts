import {
  compareJavaScriptSourcePoints,
  javascriptSourceRangeKey,
  javascriptSourceRangeContains,
} from "../../domain/javascript/javascriptSourceCoordinates.js";
import type { ApplicationNode } from "../../domain/javascript/javascriptApplicationGraphSchemas.js";
import type { ElectronSenderValidationFinding } from "../../domain/javascript/electronStaticAnalysisTypes.js";
import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import {
  artifactLocalIdentity,
  javascriptAnalysisCoverage,
  type JavaScriptArtifactGraphContext,
  type JavaScriptArtifactGraphCoverage,
} from "./JavaScriptArtifactGraphContext.js";
import {
  astObservationEvidence,
  staticInferenceEvidence,
} from "./JavaScriptArtifactGraphEvidence.js";
import type {
  ElectronIpcContext,
  ElectronIpcRecord,
} from "./ElectronBoundaryAnalysis.js";
import {
  addElectronAstEdge,
  addElectronInferenceEdge,
  electronFindingSourceNode,
  electronObservationIdentity,
} from "./ElectronBoundaryGraphContext.js";

interface IpcGraphState {
  readonly context: JavaScriptArtifactGraphContext;
  readonly records: readonly ElectronIpcRecord[];
  readonly ipc: ElectronIpcContext;
  readonly channels: Map<string, ApplicationNode>;
  readonly handlers: Map<string, ApplicationNode>;
  readonly sources: Map<string, ApplicationNode>;
}

interface IpcHandlerInput {
  readonly context: JavaScriptArtifactGraphContext;
  readonly record: ElectronIpcRecord;
  readonly source: ApplicationNode;
  readonly channel: ApplicationNode;
  readonly coverage: JavaScriptArtifactGraphCoverage;
}

interface ValidationObservationInput {
  readonly context: JavaScriptArtifactGraphContext;
  readonly file: JavaScriptArtifactFile;
  readonly validation: ElectronSenderValidationFinding;
  readonly target: ApplicationNode;
  readonly coverage: JavaScriptArtifactGraphCoverage;
}

/** Project IPC syntax, handler locations, validations, and exact pairings. */
export const addElectronIpcBoundaries = (
  context: JavaScriptArtifactGraphContext,
  ipc: ElectronIpcContext,
): void => {
  const state: IpcGraphState = {
    context,
    records: ipc.records,
    ipc,
    channels: new Map(),
    handlers: new Map(),
    sources: new Map(),
  };
  for (const record of state.records) addIpcRecord(state, record);
  addValidationObservations(state);
  addLiteralPairings(state);
};

const addIpcRecord = (
  state: IpcGraphState,
  record: ElectronIpcRecord,
): void => {
  const { context } = state;
  const coverage = coverageFor(context, record.file);
  if (coverage === undefined) return;
  const source = electronFindingSourceNode(
    context,
    record.file,
    record.finding.module_key,
    record.finding.module_runtime,
  );
  if (source === undefined) return;
  state.sources.set(record.key, source);
  const channel = addChannelNode(
    context,
    record,
    coverage,
    state.ipc.owners.get(record.key) ?? null,
  );
  state.channels.set(record.key, channel);
  if (record.finding.mode === "listen" || record.finding.mode === "handle") {
    const handler = addHandlerNode({
      context,
      record,
      source,
      channel,
      coverage,
    });
    state.handlers.set(record.key, handler);
    return;
  }
  addElectronInferenceEdge(context, {
    source,
    target: channel,
    file: record.file,
    range: record.finding.location,
    coverage,
    relation: record.finding.mode === "invoke" ? "invokes" : "sends",
    operation: "map-ipc-transmission",
    properties: {
      side: record.finding.side,
      operation: record.finding.operation,
      channel: record.finding.channel,
      channel_expression: record.finding.channel_expression,
      resolution: record.finding.channel === null ? "dynamic" : "literal",
    },
  });
};

const addChannelNode = (
  context: JavaScriptArtifactGraphContext,
  record: ElectronIpcRecord,
  coverage: JavaScriptArtifactGraphCoverage,
  owner: string | null,
): ApplicationNode => {
  const { finding, file } = record;
  const channelKey =
    finding.channel === null
      ? `dynamic:${record.key}`
      : `literal:${finding.channel}`;
  const identityKey =
    finding.receiver === undefined
      ? JSON.stringify([
          owner === null ? ["unknown", file.path] : ["application", owner],
          channelKey,
        ])
      : JSON.stringify([
          file.path,
          file.sha256,
          finding.module_runtime ?? null,
          finding.module_key,
          finding.receiver.kind,
          finding.receiver.owner_location,
          channelKey,
        ]);
  return context.accumulator.addNode({
    kind: "ipc-channel",
    identity:
      finding.resolution_basis === "wrapper-substitution"
        ? artifactLocalIdentity(
            file.sha256,
            "electron-inferred-ipc-channel",
            identityKey,
          )
        : electronObservationIdentity(
            context,
            "electron-ipc-channel",
            identityKey,
          ),
    observations: [
      {
        label: finding.channel ?? finding.channel_expression,
        properties: {
          ...(finding.receiver === undefined
            ? {}
            : { receiver: finding.receiver }),
          side: finding.side,
          operation: finding.operation,
          mode: finding.mode,
          channel: finding.channel,
          channel_expression: finding.channel_expression,
          resolution: finding.channel === null ? "dynamic" : "literal",
          ...(finding.invocation_location === undefined
            ? {}
            : { invocation_location: finding.invocation_location }),
        },
        evidence: (finding.resolution_basis === "wrapper-substitution"
          ? staticInferenceEvidence
          : astObservationEvidence)({
          sha256: file.sha256,
          path: file.path,
          range: finding.location,
          operation: "observe-ipc-channel-expression",
          coverage,
          limitations: [
            ...(finding.receiver === undefined
              ? []
              : [
                  "The receiver is a source-level allocation, not a runtime frame identity; registration and dispatch remain unverified.",
                ]),
            ...(finding.resolution_basis !== "wrapper-substitution"
              ? []
              : [
                  "The channel is inferred through lexical wrapper substitution; runtime registration and dispatch remain unverified.",
                ]),
            ...(finding.channel !== null
              ? []
              : [
                  "The channel expression is dynamic; its runtime value and pairings remain unknown.",
                ]),
          ],
        }),
      },
    ],
  });
};

const addHandlerNode = (input: IpcHandlerInput): ApplicationNode => {
  const { context, record, source, channel, coverage } = input;
  const { finding, file } = record;
  const handlerRange = finding.handler_location ?? finding.location;
  const handlerKey = `${finding.side}:${finding.operation}:${finding.channel ?? finding.channel_expression}:${javascriptSourceRangeKey(handlerRange)}`;
  const identityKey =
    finding.receiver === undefined
      ? JSON.stringify([file.path, handlerKey])
      : JSON.stringify([
          file.path,
          finding.module_runtime ?? null,
          finding.module_key,
          finding.receiver,
          handlerKey,
        ]);
  const handler = context.accumulator.addNode({
    kind: "ipc-handler",
    identity: artifactLocalIdentity(
      file.sha256,
      "electron-ipc-handler",
      identityKey,
    ),
    observations: [
      {
        label: finding.channel,
        properties: {
          ...(finding.receiver === undefined
            ? {}
            : { receiver: finding.receiver }),
          side: finding.side,
          operation: finding.operation,
          mode: finding.mode,
          channel: finding.channel,
          channel_expression: finding.channel_expression,
          handler_kind: finding.handler_kind,
          handler_location: finding.handler_location,
          ...(finding.invocation_location === undefined
            ? {}
            : { invocation_location: finding.invocation_location }),
        },
        evidence: (finding.resolution_basis === "wrapper-substitution"
          ? staticInferenceEvidence
          : astObservationEvidence)({
          sha256: file.sha256,
          path: file.path,
          range: handlerRange,
          operation: "observe-ipc-handler",
          coverage,
        }),
      },
    ],
  });
  addElectronAstEdge(context, {
    source,
    target: handler,
    file,
    range: handlerRange,
    coverage,
    relation: "contains",
    operation: "locate-ipc-handler",
    properties: { side: finding.side, operation: finding.operation },
  });
  addElectronInferenceEdge(context, {
    source: handler,
    target: channel,
    file,
    range: finding.location,
    coverage,
    relation: "handles",
    operation: "map-ipc-handler-registration",
    properties: {
      channel: finding.channel,
      channel_expression: finding.channel_expression,
      resolution: finding.channel === null ? "dynamic" : "literal",
      ...(finding.invocation_location === undefined
        ? {}
        : { invocation_location: finding.invocation_location }),
    },
  });
  return handler;
};

const addLiteralPairings = (state: IpcGraphState): void => {
  for (const pairing of state.ipc.pairings) {
    const source = state.sources.get(pairing.transmission.key);
    const handler = state.handlers.get(pairing.handler.key);
    const coverage = coverageFor(state.context, pairing.transmission.file);
    if (source === undefined || handler === undefined || coverage === undefined)
      continue;
    addElectronInferenceEdge(state.context, {
      source,
      target: handler,
      file: pairing.transmission.file,
      range: pairing.transmission.finding.location,
      coverage,
      relation:
        pairing.transmission.finding.mode === "invoke" ? "invokes" : "sends",
      operation: "pair-ipc-literal-channel",
      properties: {
        channel: pairing.transmission.finding.channel,
        pairing_basis: "unique-exact-literal-channel",
        handler_path: pairing.handler.file.path,
        handler_operation: pairing.handler.finding.operation,
      },
      limitations: [
        "Literal channel equality does not prove that the handler is registered or reachable at runtime.",
      ],
    });
  }
};

const addValidationObservations = (state: IpcGraphState): void => {
  for (const analyzed of state.context.analysis.files) {
    const { file, javascript } = analyzed;
    if (javascript === null) continue;
    const coverage = javascriptAnalysisCoverage(javascript);
    for (const validation of javascript.electron.sender_validations) {
      const handlerRecord = containingHandler(state.records, file, validation);
      const target =
        handlerRecord === undefined
          ? electronFindingSourceNode(
              state.context,
              file,
              validation.module_key,
              validation.module_runtime,
            )
          : state.handlers.get(handlerRecord.key);
      if (target !== undefined)
        addValidationObservation({
          context: state.context,
          file,
          validation,
          target,
          coverage,
        });
    }
  }
};

const addValidationObservation = (input: ValidationObservationInput): void => {
  const { context, file, validation, target, coverage } = input;
  context.accumulator.addNode({
    kind: target.kind,
    identity: target.identity,
    observations: [
      {
        label: `${validation.subject} validation candidate`,
        properties: {
          fact_kind: "sender-validation-candidate",
          subject: validation.subject,
          mechanism: validation.mechanism,
          expected: validation.expected,
          enforcement: validation.enforcement,
        },
        evidence: astObservationEvidence({
          sha256: file.sha256,
          path: file.path,
          range: validation.location,
          operation: "observe-ipc-sender-validation-candidate",
          coverage,
          limitations: [
            "A comparison or string check is visible, but static syntax alone does not prove rejection, ordering, or complete sender validation.",
          ],
        }),
      },
    ],
  });
};

const containingHandler = (
  records: readonly ElectronIpcRecord[],
  file: JavaScriptArtifactFile,
  validation: ElectronSenderValidationFinding,
): ElectronIpcRecord | undefined => {
  let selected: ElectronIpcRecord | undefined;
  for (const record of records) {
    const location = record.finding.handler_location;
    if (
      record.file.path !== file.path ||
      location === null ||
      !javascriptSourceRangeContains(location, validation.location)
    )
      continue;
    const previous = selected?.finding.handler_location;
    // Parsed handler ranges nest: the innermost starts latest, then ends
    // earliest. Columns have no fixed upper bound in minified JavaScript.
    if (
      previous == null ||
      compareJavaScriptSourcePoints(location.start, previous.start) > 0 ||
      (compareJavaScriptSourcePoints(location.start, previous.start) === 0 &&
        compareJavaScriptSourcePoints(location.end, previous.end) < 0)
    )
      selected = record;
  }
  return selected;
};

const coverageFor = (
  context: JavaScriptArtifactGraphContext,
  file: JavaScriptArtifactFile,
): JavaScriptArtifactGraphCoverage | undefined => {
  const javascript = context.analysis.files.find(
    ({ file: candidate }) => candidate.path === file.path,
  )?.javascript;
  return javascript === null || javascript === undefined
    ? undefined
    : javascriptAnalysisCoverage(javascript);
};
