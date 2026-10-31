import { PRE_66_NULL_COVERAGE_EVIDENCE } from "./evidenceLegacy.fixture.js";
import { fc, it } from "@fast-check/vitest";
import { describe, expect } from "vitest";

import { createAnalysisProfile } from "./analysisProfile.js";
import {
  RAW_ONLY_ARCHITECTURES,
  type BinaryTarget,
} from "./binaryTargetTypes.js";
import {
  createEvidence,
  evidenceSchema,
  parseEvidence,
  immutableEvidence,
  withEvidenceCallerInputPath,
  rebindEvidenceToTargetPath,
} from "./evidence.js";
import {
  MAX_JSON_DEPTH,
  jsonValueSchema,
  type JsonValue,
} from "./jsonValue.js";
import { AnalysisResourceConstraintError } from "./analysisErrorCore.js";
import { projectAnalysisError } from "./analysisErrorProjection.js";
import { createEvidenceBundle } from "./evidenceBundle.js";
import { freezeJsonSnapshot } from "./immutableJson.js";

const TARGET: BinaryTarget = {
  path: "/tmp/fixture",
  sha256: "a".repeat(64),
  kind: "executable",
  format: "mach-o",
  architecture: "arm64",
  availableArchitectures: ["arm64"],
};
const PROVIDER = { id: "fixture", name: "Fixture provider", version: "1" };
const PROFILE = createAnalysisProfile(PROVIDER, { loader: "default" });

it.each(RAW_ONLY_ARCHITECTURES)(
  "rejects a detected Evidence subject with the raw-only %s architecture",
  (architecture) => {
    const selected = {
      path: TARGET.path,
      sha256: TARGET.sha256,
      format: "raw-binary" as const,
      architecture,
    };
    expect(
      createEvidence(selected, PROVIDER, {
        operation: "inspect",
        parameters: {},
        result: null,
      }).subject,
    ).toMatchObject({ format: "raw-binary", architecture });
    const malformed = {
      ...selected,
      format: "pe" as const,
    };
    expect(() =>
      createEvidence(malformed, PROVIDER, {
        operation: "inspect",
        parameters: {},
        result: null,
      }),
    ).toThrow();
  },
);

it("keeps 6502 confined to explicit raw Evidence subjects alongside iNES", () => {
  const selected = {
    path: TARGET.path,
    sha256: TARGET.sha256,
    format: "raw-binary" as const,
    architecture: "6502" as const,
  };
  expect(
    createEvidence(selected, PROVIDER, {
      operation: "inspect",
      parameters: {},
      result: null,
    }).subject,
  ).toMatchObject({ format: "raw-binary", architecture: "6502" });
  expect(
    createEvidence(
      {
        path: selected.path,
        sha256: selected.sha256,
        format: "ines",
      },
      PROVIDER,
      { operation: "inspect", parameters: {}, result: null },
    ).subject,
  ).toMatchObject({ format: "ines", architecture: null });
  for (const format of ["pe", "ines"] as const) {
    expect(() =>
      createEvidence({ ...selected, format }, PROVIDER, {
        operation: "inspect",
        parameters: {},
        result: null,
      }),
    ).toThrow();
  }
});

it("preserves omitted relationship diagnostics and authenticates reported diagnostics", () => {
  const observation = {
    operation: "procedure_callees",
    parameters: { procedure: "0x1000" },
    result: ["0x2000"],
  };
  const historical = createEvidence(TARGET, PROVIDER, {
    ...observation,
    relationshipCoverage: { status: "complete" },
  });
  expect(historical.relationship_coverage).toEqual({ status: "complete" });
  expect(parseEvidence(JSON.parse(JSON.stringify(historical)))).toEqual(
    historical,
  );
  const diagnosed = createEvidence(TARGET, PROVIDER, {
    ...observation,
    relationshipCoverage: {
      status: "complete",
      diagnostics: ["Only resolved direct call references are observed."],
    },
  });
  expect(parseEvidence(JSON.parse(JSON.stringify(diagnosed)))).toEqual(
    diagnosed,
  );
  expect(diagnosed.evidence_id).not.toBe(historical.evidence_id);
  expect(() =>
    parseEvidence({
      ...historical,
      relationship_coverage: diagnosed.relationship_coverage,
    }),
  ).toThrow("semantic identifier");
});

it("requires explicit coverage in serialized Evidence while producers encode omission as unknown", () => {
  const evidence = createEvidence(TARGET, PROVIDER, {
    operation: "procedure_callees",
    parameters: { procedure: "0x1000" },
    result: ["0x2000"],
  });

  expect(evidence.relationship_coverage).toBeNull();
  expect(parseEvidence(JSON.parse(JSON.stringify(evidence)))).toEqual(evidence);
  const oldEnvelope = { ...evidence } as Record<string, unknown>;
  delete oldEnvelope.relationship_coverage;
  expect(evidenceSchema.safeParse(oldEnvelope).success).toBe(false);
  expect(() => parseEvidence(oldEnvelope)).toThrow();
});

it("projects known provider fields and preserves open JSON payloads", () => {
  const liveProvider = { ...PROVIDER, transient_status: "starting" };
  const evidence = createEvidence(TARGET, liveProvider, {
    operation: "inspect",
    parameters: { caller_metadata: { note: "kept" } },
    result: { producer_extension: { value: "kept" } },
    analysisProfile: PROFILE,
    environment: {
      id: "fixture",
      platform: "linux",
      architecture: "x86_64",
      isolation: "process",
    },
    locations: [{ kind: "address", address: "0x1000" }],
  });

  expect(evidence.provider).toEqual(PROVIDER);
  expect(evidence.parameters).toEqual({ caller_metadata: { note: "kept" } });
  expect(evidence.normalized_result).toEqual({
    producer_extension: { value: "kept" },
  });
  expect(parseEvidence(evidence)).toEqual(evidence);
});

it("admits typed semantic payloads with omitted optional facts without changing inputs or identity", () => {
  interface Selection {
    readonly procedure: string;
    readonly address?: string;
  }
  interface SymbolRow {
    readonly name: string;
    readonly size?: number;
  }
  interface NativeRecord {
    readonly producer: string;
    readonly diagnostic?: string;
  }
  const parameters: Selection = { procedure: "main" };
  const row: SymbolRow = { name: "main" };
  const result = { symbols: [row] };
  const rawResult: NativeRecord = { producer: "authored fixture" };
  const evidence = createEvidence(TARGET, PROVIDER, {
    operation: "inspect",
    parameters,
    result,
    rawResult,
  });
  const equivalent = createEvidence(TARGET, PROVIDER, {
    operation: "inspect",
    parameters: { procedure: "main" },
    result: { symbols: [{ name: "main" }] },
    rawResult: { producer: "authored fixture" },
  });

  expect(evidence).toEqual(equivalent);
  expect(evidence.evidence_id).toBe(equivalent.evidence_id);
  expect(parameters).toEqual({ procedure: "main" });
  expect(result).toEqual({ symbols: [{ name: "main" }] });
  expect(result.symbols[0]).toBe(row);
  expect(rawResult).toEqual({ producer: "authored fixture" });
  expect(Object.hasOwn(parameters, "address")).toBe(false);
  expect(Object.hasOwn(row, "size")).toBe(false);
  expect(Object.hasOwn(rawResult, "diagnostic")).toBe(false);
  expect(Object.isFrozen(parameters)).toBe(false);
  expect(Object.isFrozen(result)).toBe(false);
  expect(Object.isFrozen(row)).toBe(false);
  expect(Object.isFrozen(rawResult)).toBe(false);
});

it("keeps an omitted, undefined, or null raw payload equivalent", () => {
  const observation = { operation: "inspect", parameters: {}, result: true };
  const omitted = createEvidence(TARGET, PROVIDER, observation);
  const explicitUndefined = createEvidence(TARGET, PROVIDER, {
    ...observation,
    rawResult: undefined,
  });
  const explicitNull = createEvidence(TARGET, PROVIDER, {
    ...observation,
    rawResult: null,
  });

  expect(omitted.raw_result).toBeNull();
  expect(explicitUndefined).toEqual(omitted);
  expect(explicitNull).toEqual(omitted);
});

it.each([
  { field: "parameters", prefix: "parameters" },
  { field: "result", prefix: "normalized_result" },
  { field: "rawResult", prefix: "raw_result" },
])(
  "rejects explicit nested undefined in $field at its Evidence prefix",
  ({ field, prefix }) => {
    const invalid = { nested: { value: undefined } };
    let failure: unknown;
    try {
      createEvidence(TARGET, PROVIDER, {
        operation: "inspect",
        parameters: {},
        result: true,
        [field]: invalid,
      });
    } catch (cause: unknown) {
      failure = cause;
    }

    expect(failure).toMatchObject({
      name: "ZodError",
      issues: [
        {
          path: [prefix],
          message: expect.stringContaining("JSON"),
        },
      ],
    });
    expect(Object.hasOwn(invalid.nested, "value")).toBe(true);
    expect(invalid.nested.value).toBeUndefined();
  },
);

it("preserves identity and bytes when reusing an owned immutable result", () => {
  const value = { nested: { values: ["observed", 1] } };
  const mutable = createEvidence(TARGET, PROVIDER, {
    operation: "inspect",
    parameters: {},
    result: value,
  });
  const frozen = createEvidence(TARGET, PROVIDER, {
    operation: "inspect",
    parameters: {},
    result: freezeJsonSnapshot(value),
  });
  expect(JSON.stringify(frozen)).toBe(JSON.stringify(mutable));
  expect(frozen.normalized_result).toBe(value);
  expect(Object.isFrozen(frozen)).toBe(true);
  expect(parseEvidence(frozen)).toEqual(mutable);
  const wire: unknown = JSON.parse(JSON.stringify(frozen));
  expect(parseEvidence(wire)).toEqual(mutable);
  expect(() =>
    parseEvidence({ ...frozen, normalized_result: { changed: true } }),
  ).toThrow("semantic identifier");
});

it("retains verbatim caller input without changing semantic identity or copying results", () => {
  const original = createEvidence(TARGET, PROVIDER, {
    operation: "inspect",
    parameters: { address: "0x1000" },
    result: { nested: ["observed"] },
    rawResult: { source: "provider" },
  });
  const first = withEvidenceCallerInputPath(original, "./alias/../selected");
  const second = withEvidenceCallerInputPath(first, "/another/alias");

  expect(first.caller_input_path).toBe("./alias/../selected");
  expect(second.caller_input_path).toBe("/another/alias");
  expect(original.caller_input_path).toBeUndefined();
  expect(second.evidence_id).toBe(original.evidence_id);
  expect(second.parameters).toEqual({ address: "0x1000" });
  expect(second.subject?.local_path).toBe(TARGET.path);
  expect(second.normalized_result).toBe(first.normalized_result);
  expect(second.raw_result).toBe(first.raw_result);
  expect(Object.isFrozen(second)).toBe(true);
  expect(withEvidenceCallerInputPath(second, "/another/alias")).toBe(second);
  expect(parseEvidence(JSON.parse(JSON.stringify(second)))).toEqual(second);
  expect(parseEvidence(JSON.parse(JSON.stringify(original)))).toEqual(original);
  expect(
    evidenceSchema.safeParse({ ...original, caller_input_path: undefined })
      .success,
  ).toBe(false);
  expect(() => withEvidenceCallerInputPath(second, "invalid\0path")).toThrow();
});

it.each(["caller selection", "subject display"])(
  "preserves sealed JSON ownership when rebinding %s metadata",
  (metadata) => {
    const original = createEvidence(
      TARGET,
      PROVIDER,
      {
        operation: "inspect",
        parameters: {},
        result: { rows: [{ value: "observed" }] },
        rawResult: { source: ["provider"] },
      },
      { immutable: true },
    );
    const rebound =
      metadata === "caller selection"
        ? withEvidenceCallerInputPath(original, "./selected/../alias")
        : rebindEvidenceToTargetPath(original, {
            ...TARGET,
            path: "/tmp/selected-alias",
          });
    const projected = projectAnalysisError(
      new AnalysisResourceConstraintError(
        "inspect",
        "memory",
        "low heap",
        null,
        {
          partialObservation: rebound,
        },
      ),
    );
    expect(rebound).not.toBe(original);
    expect(rebound.evidence_id).toBe(original.evidence_id);
    expect(rebound.normalized_result).toBe(original.normalized_result);
    expect(rebound.raw_result).toBe(original.raw_result);
    expect(projected.details?.partial_observation).toBe(rebound);
    expect(jsonValueSchema.parse(rebound)).toBe(rebound);
    expect(original.caller_input_path).toBeUndefined();
    expect(original.subject?.local_path).toBe(TARGET.path);
  },
);

it("applies the JSON depth boundary to owned immutable results", () => {
  let result: JsonValue = 1;
  for (let index = 0; index <= MAX_JSON_DEPTH; index += 1)
    result = { nested: result };
  const observe = () =>
    createEvidence(TARGET, PROVIDER, {
      operation: "inspect",
      parameters: {},
      result,
    });
  expect(observe).toThrow("maximum nesting depth");
  freezeJsonSnapshot(result);
  expect(observe).toThrow("maximum nesting depth");
});

it("preserves prototype-named own members when reusing an owned result", () => {
  const result = { ["__proto__"]: { preserved: 7 }, constructor: "ordinary" };
  const observation = { operation: "inspect", parameters: {}, result };
  const ordinary = createEvidence(TARGET, PROVIDER, observation);
  const owned = createEvidence(TARGET, PROVIDER, {
    ...observation,
    result: freezeJsonSnapshot(result),
  });
  expect(owned.normalized_result).toBe(result);
  expect(owned).toEqual(ordinary);
  expect(parseEvidence(JSON.parse(JSON.stringify(owned)))).toEqual(owned);
  expect(Object.getPrototypeOf(owned.normalized_result)).toBe(Object.prototype);
  expect(Reflect.get(Object.prototype, "preserved")).toBeUndefined();
});

it("preserves producer envelope admission and profile validation", () => {
  const unprofiled = createEvidence(TARGET, PROVIDER, {
    operation: "inspect",
    parameters: {},
    result: { observed: [1, 2, 3] },
  });
  const profiled = createEvidence(TARGET, PROVIDER, {
    operation: "inspect",
    parameters: {},
    result: { observed: [1, 2, 3] },
    analysisProfile: PROFILE,
  });
  const { analysis_profile: _missingProfile, ...missingProfile } = unprofiled;
  expect(evidenceSchema.safeParse(missingProfile).success).toBe(false);
  expect(
    evidenceSchema.safeParse({
      ...unprofiled,
      analysis_profile: undefined,
    }).success,
  ).toBe(false);
  const candidates: unknown[] = [
    missingProfile,
    unprofiled,
    profiled,
    { ...unprofiled, analysis_profile: undefined },
    { ...unprofiled, analysis_profile: null },
    {
      ...profiled,
      analysis_profile: { ...PROFILE, provider: { ...PROVIDER, id: "other" } },
    },
    { ...unprofiled, unexpected: true },
  ];
  for (const candidate of candidates) {
    const canonical = evidenceSchema.safeParse(candidate);
    if (canonical.success)
      expect(parseEvidence(candidate)).toEqual(canonical.data);
    else expect(() => parseEvidence(candidate)).toThrow();
  }
});

it("snapshots caller-owned payloads before deriving their identity", () => {
  const result = { nested: { values: ["observed"] } };
  const rawResult = { entries: [{ value: "raw" }] };
  const parameters = { selected: ["target"] };
  const evidence = createEvidence(TARGET, PROVIDER, {
    operation: "inspect",
    parameters,
    result,
    rawResult,
  });
  result.nested.values.push("later");
  const rawEntry = rawResult.entries[0];
  if (rawEntry !== undefined) rawEntry.value = "changed";
  parameters.selected.push("other");
  expect(evidence.normalized_result).toEqual({
    nested: { values: ["observed"] },
  });
  expect(evidence.raw_result).toEqual({ entries: [{ value: "raw" }] });
  expect(evidence.parameters).toEqual({ selected: ["target"] });
  expect(parseEvidence(evidence)).toEqual(evidence);
  expect(() =>
    parseEvidence({ ...evidence, normalized_result: result }),
  ).toThrow(/semantic identifier/u);
});

describe("analysis evidence identity", () => {
  it("preserves prototype-named parameter keys and their semantic identity", () => {
    const evidence = createEvidence(TARGET, PROVIDER, {
      operation: "health",
      parameters: Object.fromEntries([["__proto__", false]]),
      result: true,
    });
    expect(evidence.parameters).toEqual({ ["__proto__"]: false });
    expect(Object.hasOwn(evidence.parameters, "__proto__")).toBe(true);
    expect(parseEvidence(evidence)).toEqual(evidence);
    const stripped = createEvidence(TARGET, PROVIDER, {
      operation: "health",
      parameters: {},
      result: true,
    });
    expect(stripped.evidence_id).not.toBe(evidence.evidence_id);
    expect(() =>
      parseEvidence({
        ...evidence,
        parameters: { ["__proto__"]: true },
      }),
    ).toThrow(/semantic identifier/u);
  });

  it.prop([
    fc.dictionary(
      fc.string({ minLength: 1, maxLength: 12 }),
      fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
    ),
  ])("canonicalizes parameter key order", (parameters) => {
    const reversed = Object.fromEntries(Object.entries(parameters).reverse());
    const first = createEvidence(TARGET, PROVIDER, {
      operation: "health",
      parameters,
      result: true,
    });
    const second = createEvidence(TARGET, PROVIDER, {
      operation: "health",
      parameters: reversed,
      result: true,
    });
    expect(second.evidence_id).toBe(first.evidence_id);
  });

  it.prop([fc.string({ minLength: 1 }), fc.string({ minLength: 1 })])(
    "keeps identity path-independent and provider-sensitive",
    (firstPath, secondPath) => {
      const first = createEvidence(
        { ...TARGET, path: `/first/${firstPath}/artifact` },
        PROVIDER,
        { operation: "health", parameters: {}, result: true },
      );
      const moved = createEvidence(
        { ...TARGET, path: `/second/${secondPath}/artifact` },
        PROVIDER,
        { operation: "health", parameters: {}, result: true },
      );
      const changedProvider = createEvidence(
        { ...TARGET, path: `/second/${secondPath}/artifact` },
        { ...PROVIDER, id: `${PROVIDER.id}-other` },
        { operation: "health", parameters: {}, result: true },
      );
      expect(moved.evidence_id).toBe(first.evidence_id);
      expect(changedProvider.evidence_id).not.toBe(first.evidence_id);
    },
  );

  it("creates deterministic provider-neutral Evidence", () => {
    const observation = {
      operation: "procedure_info",
      parameters: { document: null, procedure: "0x1000" },
      result: { name: "main" },
      rawResult: { token: "<redacted:token>" },
    } as const;
    const evidence = createEvidence(TARGET, PROVIDER, observation);
    expect(evidenceSchema.parse(evidence)).toEqual(evidence);
    expect(parseEvidence(evidence)).toEqual(evidence);
    expect(evidence).toMatchObject({
      provider: PROVIDER,
      subject: { digest: { sha256: "a".repeat(64) } },
      confidence: "observed",
      authority: "shipped-artifact",
      raw_result: { token: "<redacted:token>" },
      normalized_result: { name: "main" },
    });
    expect(evidence.evidence_id).toMatch(/^ev_[a-f0-9]{64}$/u);
    expect(createEvidence(TARGET, PROVIDER, observation)).toEqual(evidence);
  });

  it("records absent profiles as null and binds reported profiles into identity", () => {
    const unprofiled = createEvidence(TARGET, PROVIDER, {
      operation: "procedure_info",
      parameters: { procedure: "main" },
      result: { name: "main" },
    });
    expect(unprofiled.analysis_profile).toBeNull();
    expect(parseEvidence(unprofiled)).toEqual(unprofiled);

    const profiled = createEvidence(TARGET, PROVIDER, {
      operation: "procedure_info",
      parameters: { procedure: "main" },
      result: { name: "main" },
      analysisProfile: PROFILE,
    });
    expect(profiled).toMatchObject({ analysis_profile: PROFILE });
    expect(profiled.evidence_id).not.toBe(unprofiled.evidence_id);
    expect(() =>
      createEvidence(
        TARGET,
        { ...PROVIDER, id: "other" },
        {
          operation: "procedure_info",
          parameters: {},
          result: null,
          analysisProfile: PROFILE,
        },
      ),
    ).toThrow(/profile provider/u);
  });

  it("excludes local paths but includes redacted raw results in identity", () => {
    const observation = {
      operation: "health",
      parameters: {},
      result: true,
      rawResult: { pid: 100 },
    } as const;
    const first = createEvidence(TARGET, PROVIDER, observation);
    const moved = createEvidence(
      { ...TARGET, path: "/other/renamed-fixture" },
      PROVIDER,
      observation,
    );
    expect(moved.evidence_id).toBe(first.evidence_id);
    expect(
      createEvidence(TARGET, PROVIDER, {
        ...observation,
        rawResult: { pid: 200 },
      }).evidence_id,
    ).not.toBe(first.evidence_id);
  });

  it("rejects semantic tampering", () => {
    const evidence = createEvidence(TARGET, PROVIDER, {
      operation: "health",
      parameters: {},
      result: true,
    });
    expect(() =>
      parseEvidence({ ...evidence, normalized_result: false }),
    ).toThrow("semantic identifier");
  });
});

it("rejects a subject local path containing NUL while admitting an empty path", () => {
  const evidence = createEvidence(TARGET, PROVIDER, {
    operation: "health",
    parameters: {},
    result: true,
  });
  expect(evidence.subject).not.toBeNull();
  const withPath = (path: string) => ({
    ...evidence,
    subject: { ...evidence.subject, local_path: path },
  });
  expect(evidenceSchema.safeParse(withPath("/tmp/fixture")).success).toBe(true);
  expect(evidenceSchema.safeParse(withPath("")).success).toBe(true);
  expect(evidenceSchema.safeParse(withPath("a\u0000b")).success).toBe(false);
});

it("binds an explicit unknown-subject reason into the semantic Evidence identity", () => {
  const reason = "Caller excluded the observed digest.";
  const observation = { operation: "health", parameters: {}, result: true };
  const explicit = createEvidence(undefined, PROVIDER, {
    ...observation,
    subjectUnavailableReason: reason,
  });
  const defaulted = createEvidence(undefined, PROVIDER, observation);
  expect(explicit.subject).toBeNull();
  expect(explicit.limitations).toEqual([reason]);
  expect(defaulted.limitations).toEqual([
    "Artifact identity is unavailable for this observation.",
  ]);
  expect(explicit.evidence_id).not.toBe(defaulted.evidence_id);
  expect(parseEvidence(explicit)).toEqual(explicit);
});

it("derives byte-stable bundle manifests independent of record order", () => {
  const artifactEvidence = createEvidence(TARGET, PROVIDER, {
    operation: "health",
    parameters: {},
    result: true,
  });
  const captureEvidence = createEvidence(
    undefined,
    { id: "process", name: "Process capture", version: "1" },
    {
      predicateType: "rea.process-capture",
      operation: "capture_process_scenario",
      parameters: {},
      result: { exit: 0 },
      authority: "controlled-replay",
      environment: {
        id: "linux-x64",
        platform: "linux",
        architecture: "x64",
        isolation: "process",
      },
    },
  );
  const forward = createEvidenceBundle([artifactEvidence, captureEvidence]);
  const reverse = createEvidenceBundle([captureEvidence, artifactEvidence]);
  expect(JSON.stringify(reverse)).toBe(JSON.stringify(forward));
  expect(forward).toMatchObject({
    artifacts: [{ digest: { sha256: TARGET.sha256 }, format: "mach-o" }],
    providers: [{ id: "fixture" }, { id: "process" }],
    environments: [{ id: "linux-x64" }],
    scenarios: [{ evidence_id: captureEvidence.evidence_id }],
    captures: [{ evidence_id: captureEvidence.evidence_id }],
  });
});

describe("DOS analysis evidence identity", () => {
  it("retains DOS MZ identity independently of PE identity", () => {
    const target = {
      path: TARGET.path,
      sha256: TARGET.sha256,
      kind: "executable" as const,
      format: "dos-mz" as const,
      architecture: "x86" as const,
      availableArchitectures: ["x86" as const],
    };
    const observation = { operation: "health", parameters: {}, result: true };
    const evidence = createEvidence(target, PROVIDER, observation);
    expect(parseEvidence(evidence).subject).toMatchObject({
      format: "dos-mz",
      architecture: "x86",
    });
    expect(evidence.evidence_id).not.toBe(
      createEvidence({ ...target, format: "pe" }, PROVIDER, observation)
        .evidence_id,
    );
  });
});

describe("evidence JSON admission before authentication", () => {
  it.each(["parameters", "raw_result", "normalized_result"] as const)(
    "keeps rejected accessors and proxies inert in %s",
    (field) => {
      const evidence = createEvidence(TARGET, PROVIDER, {
        operation: "health",
        parameters: {},
        result: true,
      });
      for (const kind of ["accessor", "proxy"] as const) {
        let reads = 0;
        const value =
          kind === "accessor"
            ? {
                get attack() {
                  reads += 1;
                  return "observed";
                },
              }
            : new Proxy(
                { attack: "observed" },
                {
                  ownKeys(target) {
                    reads += 1;
                    return Reflect.ownKeys(target);
                  },
                  get(target, key, receiver) {
                    reads += 1;
                    return Reflect.get(target, key, receiver);
                  },
                },
              );
        let failure: unknown;
        try {
          parseEvidence({ ...evidence, [field]: value });
        } catch (cause: unknown) {
          failure = cause;
        }
        expect(reads, `${kind} reached Evidence authentication`).toBe(0);
        expect(failure).toMatchObject({
          name: "ZodError",
          issues: [
            {
              code: "custom",
              path: [field],
              message: expect.stringContaining(
                kind === "accessor" ? "accessors" : "proxies",
              ),
            },
          ],
        });
      }
    },
  );
});

describe("evidence parameter depth bound", () => {
  it("rejects evidence whose parameters nest past the JSON depth limit", () => {
    const evidence = createEvidence(TARGET, PROVIDER, {
      operation: "health",
      parameters: {},
      result: true,
    });
    let value: unknown = 1;
    for (let index = 0; index <= MAX_JSON_DEPTH; index += 1)
      value = { nested: value };
    const result = evidenceSchema.safeParse({
      ...evidence,
      parameters: { attack: value },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some((issue) =>
        issue.message.includes("maximum nesting depth"),
      ),
    ).toBe(true);
  });

  it("stops semantic authentication when normalized JSON exceeds its depth bound", () => {
    const evidence = createEvidence(TARGET, PROVIDER, {
      operation: "health",
      parameters: {},
      result: true,
    });
    let value: unknown = 1;
    for (let index = 0; index < 10_000; index += 1) value = { nested: value };

    expect(() =>
      parseEvidence({ ...evidence, normalized_result: value }),
    ).toThrow(/maximum nesting depth/u);
  });
});

it("preserves prototype-named raw and normalized results with aligned identity", () => {
  const result = { ["__proto__"]: { preserved: 7 }, constructor: "ordinary" };
  const evidence = createEvidence(TARGET, PROVIDER, {
    operation: "health",
    parameters: {},
    result,
    rawResult: result,
  });
  const parsed = parseEvidence(evidence);
  expect(parsed.normalized_result).toEqual(result);
  expect(parsed.raw_result).toEqual(result);
  expect(Object.getPrototypeOf(parsed.normalized_result)).toBe(
    Object.prototype,
  );
  expect(Reflect.get(Object.prototype, "preserved")).toBeUndefined();
  const stripped = createEvidence(TARGET, PROVIDER, {
    operation: "health",
    parameters: {},
    result: { constructor: "ordinary" },
    rawResult: { constructor: "ordinary" },
  });
  expect(stripped.evidence_id).not.toBe(evidence.evidence_id);
});

it("borrows a previously sealed envelope only after authenticating all semantic fields", () => {
  const original = freezeJsonSnapshot(
    createEvidence(TARGET, PROVIDER, {
      operation: "inspect",
      parameters: {},
      result: { fact: 1 },
    }),
  );
  expect(immutableEvidence(original)).toBe(original);
  const changed = freezeJsonSnapshot({
    ...original,
    normalized_result: { fact: 2 },
  });
  expect(() => immutableEvidence(changed)).toThrow();
});

it("diagnoses a previous explicit-null coverage commitment without admitting or rewriting its ID", () => {
  const historical = structuredClone(PRE_66_NULL_COVERAGE_EVIDENCE);
  expect(() => parseEvidence(historical)).toThrow(
    /earlier relationship_coverage identity commitment/u,
  );
  expect(historical).toEqual(PRE_66_NULL_COVERAGE_EVIDENCE);
  const corrupted = { ...historical, normalized_result: { observed: false } };
  expect(() => parseEvidence(corrupted)).toThrow(
    /semantic identifier does not match/u,
  );
  const current = createEvidence(undefined, historical.provider, {
    operation: "inspect",
    parameters: {},
    result: { observed: true },
  });
  expect(parseEvidence(current)).toEqual(current);
});
