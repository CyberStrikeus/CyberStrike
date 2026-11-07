import { isIP } from "node:net";

import type { ProcessScenario } from "../../domain/process/processScenario.js";

import { AnalysisResourceConstraintError } from "../../domain/analysisErrorCore.js";
import type {
  TerminalFrame,
  ProcessSample,
} from "../../domain/process/processCapture.js";

export type BoundedProcessTextNormalization =
  | {
      readonly state: "normalized";
      readonly value: string;
      readonly utf8Bytes: number;
    }
  | {
      readonly state: "over_budget";
      readonly reason: "normalization" | "retention";
    };

type RegexReplacement = (match: string, ...groups: string[]) => string;

type BoundedStageResult =
  | {
      readonly state: "bounded";
      readonly value: string;
      readonly utf8Bytes: number;
    }
  | { readonly state: "unchanged"; readonly value: string }
  | { readonly state: "over_budget" };

const createUtf8ByteCounter = (maxBytes: number) => {
  let bytes = 0;
  let pendingHighSurrogate = false;
  const addBytes = (added: number): void => {
    if (bytes > maxBytes || added > maxBytes - bytes) {
      bytes = Number.POSITIVE_INFINITY;
      return;
    }
    bytes += added;
  };
  return {
    add: (value: string): void => {
      if (bytes > maxBytes || value.length === 0) return;
      let index = 0;
      if (pendingHighSurrogate) {
        if (value.length > 0 && isLowSurrogate(value.charCodeAt(0))) {
          addBytes(4);
          index = 1;
        } else {
          addBytes(3);
        }
        pendingHighSurrogate = false;
      }
      for (; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 0x7f) addBytes(1);
        else if (code <= 0x7ff) addBytes(2);
        else if (isHighSurrogate(code)) {
          if (index + 1 === value.length) {
            pendingHighSurrogate = true;
          } else if (isLowSurrogate(value.charCodeAt(index + 1))) {
            addBytes(4);
            index += 1;
          } else addBytes(3);
        } else addBytes(3);
        if (bytes > maxBytes) return;
      }
    },
    finish: (): number => {
      if (pendingHighSurrogate) addBytes(3);
      return bytes;
    },
  };
};

const isHighSurrogate = (code: number): boolean =>
  code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean =>
  code >= 0xdc00 && code <= 0xdfff;

const boundedRegexReplace = (
  value: string,
  matcher: RegExp,
  replacement: RegexReplacement,
  maxBytes: number,
): BoundedStageResult => {
  const byteCounter = createUtf8ByteCounter(maxBytes);
  let cursor = 0;
  let changed = false;
  matcher.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(value)) !== null) {
    const index = match.index;
    const matched = match[0] ?? "";
    const nextCursor = index + matched.length;
    const replacementValue = replacement(matched, ...match.slice(1));
    changed ||= replacementValue !== matched;
    byteCounter.add(value.slice(cursor, index));
    byteCounter.add(replacementValue);
    cursor = nextCursor;
  }
  byteCounter.add(value.slice(cursor));
  const bytes = byteCounter.finish();
  if (bytes > maxBytes) {
    return changed ? { state: "over_budget" } : { state: "unchanged", value };
  }
  if (!changed) return { state: "unchanged", value };
  matcher.lastIndex = 0;
  const normalized = value.replace(matcher, replacement);
  return {
    state: "bounded",
    value: normalized,
    utf8Bytes: bytes,
  };
};

const boundedLiteralReplace = (
  value: string,
  pattern: string,
  replacement: string,
  maxBytes: number,
): BoundedStageResult => {
  const byteCounter = createUtf8ByteCounter(maxBytes);
  let cursor = 0;
  if (pattern === "") {
    if (replacement === "") return { state: "unchanged", value };
    for (let index = 0; index < value.length; index += 1) {
      byteCounter.add(replacement);
      byteCounter.add(value.slice(index, index + 1));
    }
    byteCounter.add(replacement);
    const bytes = byteCounter.finish();
    if (bytes > maxBytes) return { state: "over_budget" };
    return {
      state: "bounded",
      value: value.replaceAll(pattern, () => replacement),
      utf8Bytes: bytes,
    };
  }
  if (pattern === replacement) return { state: "unchanged", value };

  let index = value.indexOf(pattern, cursor);
  if (index === -1) return { state: "unchanged", value };
  while (index !== -1) {
    byteCounter.add(value.slice(cursor, index));
    byteCounter.add(replacement);
    cursor = index + pattern.length;
    index = value.indexOf(pattern, cursor);
  }
  byteCounter.add(value.slice(cursor));
  const bytes = byteCounter.finish();
  if (bytes > maxBytes) return { state: "over_budget" };
  return {
    state: "bounded",
    value: value.replaceAll(pattern, () => replacement),
    utf8Bytes: bytes,
  };
};

const boundedIdentity = (
  value: string,
  maxBytes: number,
): BoundedStageResult => {
  const utf8Bytes = Buffer.byteLength(value);
  return utf8Bytes <= maxBytes
    ? { state: "bounded", value, utf8Bytes }
    : { state: "unchanged", value };
};

/** Bucket one elapsed process-capture timestamp under scenario normalization. */
export const normalizeProcessElapsedTime = (
  elapsedMs: number,
  timeBucketMs: number,
): number => Math.floor(elapsedMs / timeBucketMs) * timeBucketMs;

type ProcessTextRule =
  | {
      readonly kind: "regex";
      readonly matcher: RegExp;
      readonly replace: RegexReplacement;
    }
  | {
      readonly kind: "literal";
      readonly pattern: string;
      readonly replacement: string;
    };

type ProcessIdentifierSource =
  | number
  | readonly number[]
  | (() => number | readonly number[]);

/** Encounter order defines one shared identity set for text and sampled rows. */
const processSampleIdentifiers = (
  samples: readonly ProcessSample[],
  rootPid: number,
): readonly number[] =>
  [
    ...new Set([
      rootPid,
      ...samples.flatMap((sample) => [
        sample.pid,
        sample.parent_pid,
        sample.process_group_id ?? 0,
        sample.session_id ?? 0,
      ]),
    ]),
  ].filter((pid) => pid > 0);

/** Reuse an immutable identifier snapshot until the root or retained samples change. */
export const createProcessIdentifierLookup = (
  samples: readonly ProcessSample[],
  rootPid: () => number,
): (() => readonly number[]) => {
  let count = -1;
  let root = -1;
  let identifiers: readonly number[] = [];
  return () => {
    const currentRoot = rootPid();
    if (currentRoot !== root || count !== samples.length) {
      root = currentRoot;
      count = samples.length;
      identifiers = processSampleIdentifiers(samples, root);
    }
    return identifiers;
  };
};

/** Compile one ordered policy for both bounded retention and unrestricted text. */
const createProcessTextRules = (
  scenario: ProcessScenario,
  temporaryRoot: string,
  pid: ProcessIdentifierSource,
): (() => readonly (ProcessTextRule | undefined)[]) => {
  const rules: (ProcessTextRule | undefined)[] = [];
  const pathRule = scenario.normalization.paths
    ? createPathRule(scenario, temporaryRoot)
    : undefined;
  if (pathRule !== undefined) rules.push({ kind: "regex", ...pathRule });
  if (scenario.normalization.ports)
    rules.push(
      {
        kind: "regex",
        matcher: PORT_ENDPOINT_MATCHER,
        replace: portEndpointReplacement,
      },
      {
        kind: "regex",
        matcher: PORT_FIELD_MATCHER,
        replace: portFieldReplacement,
      },
    );
  const pidIndex = rules.length;
  if (scenario.normalization.pids) rules.push(undefined);
  for (const pattern of scenario.normalization.patterns)
    rules.push({ kind: "literal", ...pattern });
  let previousPid: number | readonly number[] | undefined;
  return () => {
    if (scenario.normalization.pids) {
      const currentPid = typeof pid === "function" ? pid() : pid;
      if (currentPid !== previousPid) {
        previousPid = currentPid;
        const matcher = createPidMatcher(
          typeof currentPid === "number" ? [currentPid] : currentPid,
        );
        rules[pidIndex] =
          matcher === undefined
            ? undefined
            : { kind: "regex", matcher, replace: () => "<pid>" };
      }
    }
    return rules;
  };
};

/** Prepare capture-local matchers while retaining a live terminal PID lookup. */
export const createProcessTextNormalizer = (
  scenario: ProcessScenario,
  temporaryRoot: string,
  pid: ProcessIdentifierSource,
): ((value: string) => string) => {
  const rules = createProcessTextRules(scenario, temporaryRoot, pid);
  return (value) => {
    let normalized = value;
    for (const rule of rules()) {
      if (rule === undefined) continue;
      normalized =
        rule.kind === "regex"
          ? normalized.replace(rule.matcher, rule.replace)
          : normalized.replaceAll(rule.pattern, () => rule.replacement);
    }
    return normalized;
  };
};

/** Normalize terminal text without materializing an intermediate over its byte budget. */
export const createBoundedProcessTextNormalizer = (
  scenario: ProcessScenario,
  temporaryRoot: string,
  pid: ProcessIdentifierSource,
): ((value: string, maxBytes: number) => BoundedProcessTextNormalization) => {
  const rules = createProcessTextRules(scenario, temporaryRoot, pid);
  return (value, maxBytes) => {
    let normalized = value;
    for (const rule of rules()) {
      if (rule === undefined) continue;
      const result =
        rule.kind === "regex"
          ? boundedRegexReplace(
              normalized,
              rule.matcher,
              rule.replace,
              maxBytes,
            )
          : boundedLiteralReplace(
              normalized,
              rule.pattern,
              rule.replacement,
              maxBytes,
            );
      if (result.state === "over_budget")
        return { state: "over_budget", reason: "normalization" };
      normalized = result.value;
    }
    const identity = boundedIdentity(normalized, maxBytes);
    return identity.state === "bounded"
      ? {
          state: "normalized",
          value: identity.value,
          utf8Bytes: identity.utf8Bytes,
        }
      : { state: "over_budget", reason: "retention" };
  };
};

/** Normalize one payload when its caller does not retain a capture-local matcher. */
export const normalizeProcessText = (
  value: string,
  scenario: ProcessScenario,
  temporaryRoot: string,
  pid: number,
): string => createProcessTextNormalizer(scenario, temporaryRoot, pid)(value);

// `/dir/` and `/dir/.` name the same directory as `/dir`. Keep one spelling so
// descendants such as `/dir/file` still meet the path-delimiter lookahead.
const directoryIdentity = (path: string): string => {
  let identity = path;
  while (identity.length > 1 && /\/\.?$/u.test(identity))
    identity = identity.replace(/\/\.?$/u, "") || "/";
  return identity;
};

/** Match original paths once, preferring the most specific selected identity. */
const createPathRule = (
  scenario: ProcessScenario,
  temporaryRoot: string,
):
  | { readonly matcher: RegExp; readonly replace: RegexReplacement }
  | undefined => {
  const aliases = new Map<string, string>();
  const selected: readonly (readonly [string, string])[] = [
    [temporaryRoot, "<temporary-root>"],
    [directoryIdentity(scenario.working_directory), "<working-directory>"],
    [scenario.executable, "<executable>"],
    ...scenario.filesystem_observation_paths.map(
      (root, index): readonly [string, string] => [
        directoryIdentity(root),
        `<filesystem-root-${String(index)}>`,
      ],
    ),
  ];
  for (const [path, alias] of selected)
    if (path !== "" && !aliases.has(path)) aliases.set(path, alias);
  const paths = [...aliases.keys()].sort(
    (left, right) => right.length - left.length,
  );
  if (paths.length === 0) return undefined;
  const pattern = paths
    .map((path) =>
      path === "/"
        ? "/(?!/)(?=([^\\s\"']?))"
        : `${path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?=$|/|[\\s"'])`,
    )
    .join("|");
  // A selected path is an identity, not an arbitrary text prefix. Only match
  // it at a clear text delimiter; keep the parent-directory case (`/root` in
  // `/root/file`) while leaving punctuation-adjacent names untouched.
  const matcher = new RegExp(`(^|[\\s"'=:(\\[{<])(${pattern})`, "gu");
  return {
    matcher,
    replace: (match, prefix, path, rootChild) =>
      path === "/" && prefix === "<"
        ? match
        : `${prefix}${aliases.get(path) ?? path}${path === "/" && rootChild ? "/" : ""}`,
  };
};

// A port may end a sentence, but a period followed by a letter, digit, or
// underscore continues a decimal, version, or host name. A period ending a PTY
// chunk stays unnormalized because its continuation may arrive in the next one.
const PORT_ENDPOINT_MATCHER =
  /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/?#"'<>]+|\blocalhost|\b(?:\d{1,3}\.){3}\d{1,3}|\[[\da-f:.%]+\]):(\d{1,5})(?![\p{L}\p{N}_@:]|\.(?:[\p{L}\p{N}_]|$))/giu;
const PORT_FIELD_MATCHER =
  /(\b(?:port|tcp_port|udp_port|listen)\b["']?\s*[:=]\s*)(\d{1,5})(?![\p{L}\p{N}_]|\.(?:[\p{L}\p{N}_]|$))/giu;

const portEndpointReplacement: RegexReplacement = (match, endpoint, port) => {
  if (Number(port) > 65_535) return match;
  const isEndpoint = endpoint.includes("://")
    ? URL.canParse(`${endpoint}:${port}`)
    : endpoint.toLowerCase() === "localhost" ||
      isIP(endpoint.replace(/^\[|\]$/gu, "")) !== 0;
  return isEndpoint ? `${endpoint}:<port>` : match;
};

const portFieldReplacement: RegexReplacement = (match, prefix, port) =>
  Number(port) <= 65_535 ? `${prefix}<port>` : match;

/** Project sampled observations under the caller-selected normalization rules. */
export const normalizeProcessSamples = (
  samples: readonly ProcessSample[],
  scenario: ProcessScenario,
  rootPid: number,
): readonly ProcessSample[] => {
  const identifiers = processSampleIdentifiers(samples, rootPid);
  const mapping = new Map(
    identifiers.map((identifier, index) => [identifier, index + 1]),
  );
  const normalizeText = createProcessTextNormalizer(
    scenario,
    "<no-temporary-root>",
    identifiers,
  );
  const normalizeCommand = (command: string): string =>
    normalizeText(command).trim();
  return samples.map((sample) => ({
    at_ms: normalizeProcessElapsedTime(
      sample.at_ms,
      scenario.normalization.time_bucket_ms,
    ),
    pid: scenario.normalization.pids
      ? (mapping.get(sample.pid) ?? 1)
      : sample.pid,
    parent_pid: scenario.normalization.pids
      ? (mapping.get(sample.parent_pid) ?? 0)
      : sample.parent_pid,
    process_group_id:
      !scenario.normalization.pids || sample.process_group_id === null
        ? sample.process_group_id
        : (mapping.get(sample.process_group_id) ?? 0),
    session_id:
      !scenario.normalization.pids || sample.session_id === null
        ? sample.session_id
        : (mapping.get(sample.session_id) ?? 0),
    command: normalizeCommand(sample.command),
  }));
};

const createPidMatcher = (
  identifiers: readonly number[],
): RegExp | undefined => {
  const tokens = [...new Set(identifiers)]
    .filter((identifier) => Number.isSafeInteger(identifier) && identifier > 0)
    .sort((left, right) => right - left)
    .map(String);
  if (tokens.length === 0) return undefined;
  return new RegExp(`(?<!\\d)(?:${tokens.join("|")})(?!\\d)`, "gu");
};

/** Reproject retained raw chunks atomically when later samples reveal more identifiers. */
export const normalizeRetainedTerminalFrames = (
  frames: TerminalFrame[],
  normalize: (
    value: string,
    maxBytes: number,
  ) => BoundedProcessTextNormalization,
  maximumBytes: number,
  reason: "sampled-identifiers" | "sensitive-input" = "sampled-identifiers",
): number => {
  let bytes = 0;
  const projected: TerminalFrame[] = [];
  for (const frame of frames) {
    const raw = frame.raw_data ?? frame.data;
    const value = normalize(raw, maximumBytes - bytes);
    if (value.state === "over_budget")
      throw new AnalysisResourceConstraintError(
        "capture_process",
        "capacity",
        `Retained terminal text exceeded the selected output budget after ${reason} projection.`,
        {
          maximum_output_bytes: maximumBytes,
          frame_index: frame.sequence,
          boundary:
            reason === "sampled-identifiers"
              ? "terminal-pid-normalization"
              : "terminal-sensitive-input-normalization",
        },
        {
          retryable: false,
          remediationAction:
            "Increase limits.output_bytes within its advertised range, or select a narrower scenario. Completed raw PTY chunks remain in partial observations; the corrected normalized representation did not fit.",
        },
      );
    bytes += value.utf8Bytes;
    projected.push({
      sequence: frame.sequence,
      at_ms: frame.at_ms,
      data: value.value,
      ...(value.value === raw ? {} : { raw_data: raw }),
    });
  }
  for (const [index, frame] of projected.entries()) frames[index] = frame;
  return bytes;
};
