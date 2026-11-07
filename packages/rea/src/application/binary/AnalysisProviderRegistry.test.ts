import { describe, expect, it } from "vitest";
import { withVerifierCleanup } from "../../../scripts/lib/verifier-cleanup.mjs";
import { awaitAcknowledgement } from "../../../tests/fixtures/lifecycleAcknowledgement.js";

import { AnalysisProviderRegistry } from "./AnalysisProviderRegistry.js";
import {
  createAnalysisExecution,
  type AnalysisClient,
  type AnalysisProviderCandidate,
  type AnalysisProviderInspectionOptions,
  type CapabilityDescriptor,
  type ProviderAvailability,
  type ProviderIdentity,
  type ProviderTargetSupport,
} from "../AnalysisProvider.js";
import { createAnalysisProfile } from "../../domain/analysisProfile.js";
import type { BinaryTarget } from "../../domain/binaryTargetTypes.js";
import { ProviderAdapterError } from "../../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../../domain/providerCleanupError.js";
import {
  AnalysisCapabilityUnavailableError,
  AnalysisUnsupportedTargetError,
  AnalysisCancelledError,
} from "../../domain/analysisErrorCore.js";
import { ProviderSelectionError } from "../../domain/providerSelectionError.js";
import { LinuxOwnedProcessPrerequisiteError } from "../../process/ProcessOwnershipObservation.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { err, ok } from "../../domain/result.js";

const DATABASE_TARGET: BinaryTarget = {
  path: "/tmp/fixture.hop",
  sha256: "a".repeat(64),
  kind: "database",
  format: "analysis-database",
};
const ARTIFACT_TARGET: BinaryTarget = {
  path: "/tmp/app.asar",
  sha256: "b".repeat(64),
  kind: "archive",
  format: "asar",
};

it("rejects malformed provider capability declarations", () => {
  const alpha = candidate("alpha");
  expect(
    () => new AnalysisProviderRegistry([alpha.provider, alpha.provider]),
  ).toThrow(/Duplicate analysis provider ID: alpha/u);
  expect(
    () =>
      new AnalysisProviderRegistry([
        {
          ...alpha.provider,
          capabilities: () => {
            const descriptor = capability(alpha.provider.identity());
            return [descriptor, descriptor];
          },
        },
      ]),
  ).toThrow(/declares operation address_name more than once/u);
  expect(
    () =>
      new AnalysisProviderRegistry([
        {
          ...alpha.provider,
          capabilities: () => [
            capability({ ...alpha.provider.identity(), name: "forged" }),
          ],
        },
      ]),
  ).toThrow(/published mismatched capability provenance/u);
  expect(
    () => new AnalysisProviderRegistry([candidate("auto").provider]),
  ).toThrow(/Invalid analysis provider ID: auto/u);
});

it("uses one owner readiness snapshot for candidate availability and capabilities", async () => {
  const base = candidate("alpha").provider;
  let observed = 0;
  let capabilityReads = 0;
  const provider: AnalysisProviderCandidate = {
    ...base,
    inspectAvailability: () => {
      throw new Error("availability must come from the owner snapshot");
    },
    capabilities: () => {
      capabilityReads += 1;
      return [capability(base.identity())];
    },
    inspectReadinessSnapshot: () => {
      observed += 1;
      return {
        availability: {
          status: "unavailable",
          code: "runtime_unavailable",
          reason: "native inspection failed",
          diagnostics: { failure_stage: "self-test" },
        },
        capabilities: [capability(base.identity())],
      };
    },
  };

  const [status] = await new AnalysisProviderRegistry([provider]).candidates();
  expect(observed).toBe(1);
  expect(capabilityReads).toBe(1);
  expect(status).toMatchObject({
    availability: {
      status: "unavailable",
      code: "runtime_unavailable",
      diagnostics: { failure_stage: "self-test" },
    },
    capabilities: [{ operation: "address_name" }],
  });
});

it("reports a missing Linux ps as one candidate's unavailability and keeps the others", async () => {
  const base = candidate("alpha").provider;
  const gamma = candidate("gamma").provider;
  const refused: AnalysisProviderCandidate = {
    ...base,
    // Mirrors a provider adapter re-attributing the refusal to its own operation.
    inspectReadinessSnapshot: () => {
      throw new AnalysisCapabilityUnavailableError(
        "process-ownership",
        "ghidra:inspection",
        "ps is unavailable",
        {
          cause: new LinuxOwnedProcessPrerequisiteError(
            new Error("spawn ps ENOENT"),
          ),
        },
      );
    },
  };

  const statuses = await new AnalysisProviderRegistry([
    refused,
    gamma,
  ]).candidates();
  expect(statuses).toMatchObject([
    {
      provider: { id: "alpha" },
      availability: {
        status: "unavailable",
        code: "runtime_unavailable",
        reason: expect.stringContaining("spawn ps ENOENT") as unknown,
        diagnostics: { stage: "ownership_preparation" },
      },
      capabilities: [{ operation: "address_name" }],
    },
    { provider: { id: "gamma" }, availability: { status: "available" } },
  ]);

  const selected = await new AnalysisProviderRegistry([refused]).select(
    DATABASE_TARGET,
    "alpha",
  );
  if (selected.ok) throw new Error("expected the prerequisite refusal");
  expect(selected.error).toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
    providerId: "process-ownership",
  });
});

it("selects the sole available provider and honors explicit selection precedence", async () => {
  const alpha = candidate("alpha");
  const beta = candidate("beta", { available: false });
  const sole = await new AnalysisProviderRegistry([
    beta.provider,
    alpha.provider,
  ]).select(DATABASE_TARGET);
  expect(sole).toMatchObject({
    ok: true,
    value: {
      binding: {
        identity: { id: "alpha" },
        selectionSource: "auto-single-candidate",
      },
    },
  });

  const selected = new AnalysisProviderRegistry(
    [alpha.provider, candidate("beta").provider],
    "beta",
  );
  expect(await selected.select(DATABASE_TARGET)).toMatchObject({
    ok: true,
    value: {
      binding: {
        identity: { id: "beta" },
        selectionSource: "environment",
      },
    },
  });
  expect(await selected.select(DATABASE_TARGET, "alpha")).toMatchObject({
    ok: true,
    value: {
      binding: {
        identity: { id: "alpha" },
        selectionSource: "request",
      },
    },
  });
});

describe("inspection without deep binding", () => {
  it("retains discovery facts without resolving a deep profile for covered automatic inspection", async () => {
    const alpha = candidate("alpha", { profile: "error" });
    const beta = candidate("beta", { profile: "error" });
    const registry = new AnalysisProviderRegistry(
      [alpha.provider, beta.provider],
      "auto",
      (target) => target === DATABASE_TARGET,
    );
    expect(await registry.select(DATABASE_TARGET)).toMatchObject({
      ok: true,
      value: {
        requestedProviderId: "auto",
        binding: null,
        candidates: [
          {
            provider: { id: "alpha" },
            selected: false,
            availability: { status: "available" },
          },
          {
            provider: { id: "beta" },
            selected: false,
            availability: { status: "available" },
          },
        ],
      },
    });
    expect(alpha.created).toEqual([]);
    expect(beta.created).toEqual([]);
  });

  it("keeps explicit request and environment choices even when auxiliary inspection covers the target", async () => {
    const alpha = candidate("alpha");
    const beta = candidate("beta");
    const registry = new AnalysisProviderRegistry(
      [alpha.provider, beta.provider],
      "beta",
      () => true,
    );
    expect(await registry.select(DATABASE_TARGET)).toMatchObject({
      ok: true,
      value: {
        binding: { identity: { id: "beta" }, selectionSource: "environment" },
      },
    });
    expect(await registry.select(DATABASE_TARGET, "alpha")).toMatchObject({
      ok: true,
      value: {
        binding: { identity: { id: "alpha" }, selectionSource: "request" },
      },
    });
    expect(await registry.select(DATABASE_TARGET, "auto")).toMatchObject({
      ok: true,
      value: { binding: null },
    });
    expect(await registry.select(DATABASE_TARGET, "missing")).toMatchObject({
      ok: false,
      error: { reason: "unknown_provider" },
    });
  });

  it("preserves ordinary ambiguity when auxiliary inspection does not cover the target", async () => {
    const registry = new AnalysisProviderRegistry(
      [candidate("alpha").provider, candidate("beta").provider],
      "auto",
      () => false,
    );
    expect(await registry.select(DATABASE_TARGET)).toMatchObject({
      ok: false,
      error: { reason: "ambiguous" },
    });
    const controller = new AbortController();
    controller.abort();
    expect(
      await registry.select(DATABASE_TARGET, undefined, {
        signal: controller.signal,
      }),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisCancelledError" } });
  });
});

describe("analysis provider registry: selection failures", () => {
  it("offers only admitted providers for ambiguous automatic selection", async () => {
    const alpha = candidate("alpha");
    const beta = candidate("beta");
    const ghidra = candidate("ghidra", {
      available: false,
      unconfigured: true,
    });
    const kuna = candidate("kuna", {
      available: false,
      unconfigured: true,
    });
    const registry = new AnalysisProviderRegistry([
      alpha.provider,
      beta.provider,
      ghidra.provider,
      kuna.provider,
    ]);

    const ambiguous = await registry.select(DATABASE_TARGET);
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok)
      expect(projectAnalysisError(ambiguous.error)).toMatchObject({
        details: {
          selection_reason: "ambiguous",
          candidate_ids: ["alpha", "beta"],
          rejections: [
            { provider_id: "ghidra", code: "not_configured" },
            { provider_id: "kuna", code: "not_configured" },
          ],
        },
      });

    for (const selected of [
      await registry.select(DATABASE_TARGET, "alpha"),
      await registry.select(DATABASE_TARGET, "beta"),
    ])
      expect(selected).toMatchObject({ ok: true });
    expect([
      ...alpha.created,
      ...beta.created,
      ...ghidra.created,
      ...kuna.created,
    ]).toEqual([]);
  });

  it("returns actionable unknown, unavailable, and unsupported failures", async () => {
    const unavailable = candidate("alpha", { available: false });
    const registry = new AnalysisProviderRegistry([unavailable.provider]);

    const unknown = await registry.select(DATABASE_TARGET, "missing");
    expect(unknown.ok).toBe(false);
    if (!unknown.ok)
      expect(projectAnalysisError(unknown.error)).toMatchObject({
        details: {
          selection_reason: "unknown_provider",
          requested_provider_id: "missing",
          candidate_ids: ["alpha"],
        },
      });

    const rejected = await registry.select(DATABASE_TARGET, "alpha");
    expect(rejected.ok).toBe(false);
    if (!rejected.ok)
      expect(projectAnalysisError(rejected.error)).toMatchObject({
        code: "provider_unavailable",
        details: {
          rejections: [
            {
              provider_id: "alpha",
              code: "runtime_missing",
              diagnostics: { executable_path: "/opt/alpha/bin/analyze" },
            },
          ],
        },
      });

    const unsupported = await new AnalysisProviderRegistry([
      candidate("alpha", { available: false }).provider,
    ]).select(ARTIFACT_TARGET, "alpha");
    if (unsupported.ok)
      throw new Error("expected unsupported target rejection");
    expect(unsupported.error).toBeInstanceOf(ProviderSelectionError);
    if (
      !unsupported.ok &&
      unsupported.error instanceof ProviderSelectionError
    ) {
      expect(unsupported.error).toMatchObject({
        reason: "target_unsupported",
      });
      expect(unsupported.error.rejections.map(({ code }) => code)).toEqual([
        "runtime_missing",
        "target_kind_unsupported",
      ]);
    }
  });

  it("keeps artifact-only targets unbound under auto or environment preference", async () => {
    const alpha = candidate("alpha");
    const environment = new AnalysisProviderRegistry([alpha.provider], "alpha");
    const automatic = new AnalysisProviderRegistry([alpha.provider]);

    for (const registry of [environment, automatic]) {
      const selected = await registry.select(ARTIFACT_TARGET);
      expect(selected).toMatchObject({
        ok: true,
        value: {
          binding: null,
          candidates: [
            {
              selected: false,
              targetSupport: {
                status: "unsupported",
                code: "target_kind_unsupported",
              },
            },
          ],
        },
      });
    }
    const explicit = await automatic.select(ARTIFACT_TARGET, "alpha");
    if (explicit.ok) throw new Error("expected provider selection rejection");
    expect(explicit.error).toBeInstanceOf(ProviderSelectionError);
    if (explicit.error instanceof ProviderSelectionError)
      expect(explicit.error.reason).toBe("target_unsupported");
  });

  it("rejects an unknown environment preference even when every candidate rejects the target", async () => {
    const alpha = candidate("alpha");
    const misconfigured = new AnalysisProviderRegistry(
      [alpha.provider],
      "missing",
    );

    for (const selected of [
      await misconfigured.select(ARTIFACT_TARGET),
      await misconfigured.select(ARTIFACT_TARGET, "missing"),
    ]) {
      if (selected.ok) throw new Error("expected unknown provider rejection");
      expect(projectAnalysisError(selected.error)).toMatchObject({
        details: {
          selection_reason: "unknown_provider",
          requested_provider_id: "missing",
          candidate_ids: ["alpha"],
        },
      });
    }
  });
});

describe("analysis provider registry: rejection origins", () => {
  it("distinguishes recorded readiness failures from an unobserved target refusal", async () => {
    const registry = new AnalysisProviderRegistry([
      candidate("alpha", { available: false, unconfigured: true }).provider,
      candidate("gamma", { available: false, unconfigured: true }).provider,
    ]);
    const selection = await registry.select(DATABASE_TARGET);
    expect(selection.ok).toBe(true);
    if (!selection.ok) return;
    const projected = projectAnalysisError(
      registry.unboundOperationError("binary_overview", selection.value),
    );
    expect(projected.message).toContain(
      "Provider selection failed local readiness checks. No target-support refusal was reported.",
    );
  });

  it("reports a configured provider's readiness failure without hiding a ready alternative", async () => {
    const invalid = candidate("alpha", { available: false });
    const ready = candidate("beta");
    const registry = new AnalysisProviderRegistry([
      {
        ...invalid.provider,
        inspectAvailability: () => ({
          status: "unavailable",
          code: "open_options_invalid",
          reason: "Configured registration is invalid",
          diagnostics: { registration_path: "/configured/alpha.json" },
        }),
      },
      ready.provider,
    ]);
    const selected = await registry.select(DATABASE_TARGET, "alpha");
    if (selected.ok)
      throw new Error("Expected the selected provider to refuse");
    const projected = projectAnalysisError(selected.error);
    expect(projected.message).toContain("local readiness");
    expect(projected.message).not.toContain(
      "No analysis provider is configured",
    );
    expect(projected.details).toMatchObject({
      requested_provider_id: "alpha",
      candidate_ids: ["alpha", "beta"],
      rejections: [
        {
          provider_id: "alpha",
          origin: "availability",
          code: "open_options_invalid",
          reason: "Configured registration is invalid",
          diagnostics: { registration_path: "/configured/alpha.json" },
        },
      ],
    });
    expect((await registry.select(DATABASE_TARGET, "beta")).ok).toBe(true);
    expect(invalid.created).toEqual([]);
  });

  it("names whether a rejection came from provider availability or target support", async () => {
    const availabilityOnly = new AnalysisProviderRegistry([
      candidate("alpha", { available: false, unconfigured: true }).provider,
      candidate("gamma", { available: false, unconfigured: true }).provider,
    ]);
    const availabilitySelection =
      await availabilityOnly.select(DATABASE_TARGET);
    expect(availabilitySelection.ok).toBe(true);
    if (availabilitySelection.ok) {
      const { details } = projectAnalysisError(
        availabilityOnly.unboundOperationError(
          "binary_overview",
          availabilitySelection.value,
        ),
      );
      const rejections = details?.rejections as unknown as readonly {
        origin: string;
      }[];
      expect(rejections.map(({ origin }) => origin)).toEqual([
        "availability",
        "availability",
      ]);
    }

    const unconfiguredButAdmitting: AnalysisProviderCandidate = {
      ...candidate("alpha", { available: false, unconfigured: true }).provider,
      inspectTargetSupport: () => ({
        status: "supported",
        code: null,
        reason: null,
        diagnostics: { target_kind: "archive" },
      }),
    };
    const refusingTarget: AnalysisProviderCandidate = {
      ...candidate("beta").provider,
      inspectTargetSupport: () => ({
        status: "unsupported",
        code: "target_format_unsupported",
        reason: "beta refuses archives",
        diagnostics: { target_kind: "archive" },
      }),
    };
    const mixed = new AnalysisProviderRegistry([
      unconfiguredButAdmitting,
      refusingTarget,
    ]);
    const mixedSelection = await mixed.select(ARTIFACT_TARGET);
    expect(mixedSelection.ok).toBe(true);
    if (mixedSelection.ok) {
      const projected = projectAnalysisError(
        mixed.unboundOperationError("binary_overview", mixedSelection.value),
      );
      expect(projected.message).toContain(
        "The selected analysis provider is unavailable",
      );
      const { details } = projected;
      const rejections = details?.rejections as unknown as readonly {
        origin: string;
        code: string;
      }[];
      expect(rejections).toMatchObject([
        { origin: "availability", code: "not_configured" },
        { origin: "target", code: "target_format_unsupported" },
      ]);
    }
  });
});

describe("analysis provider registry: profile and cleanup failures", () => {
  it("does not bind a profile with unresolved version or adapter failure", async () => {
    const unresolved = candidate("unresolved", { profile: "missing" });
    const failed = candidate("failed", { profile: "error" });

    const automatic = await new AnalysisProviderRegistry([
      unresolved.provider,
    ]).select(DATABASE_TARGET);
    expect(automatic).toMatchObject({
      ok: true,
      value: {
        binding: null,
        candidates: [
          {
            availability: {
              status: "unavailable",
              code: "version_unresolved",
            },
          },
        ],
      },
    });

    const explicit = await new AnalysisProviderRegistry([
      failed.provider,
    ]).select(DATABASE_TARGET, "failed");
    if (explicit.ok) throw new Error("expected provider selection rejection");
    expect(explicit.error).toMatchObject({
      _tag: "ProviderAdapterError",
      providerId: "failed",
    });
  });

  it("aborts automatic selection when a provider reports unconfirmed cleanup", async () => {
    const ghidra = candidate("ghidra");
    const alternate = candidate("hopper");
    const cleanupFailure = new ProviderCleanupError(
      "ghidra",
      ["/opt/ghidra/data/languages/x86.ldefs"],
      { reason: "descriptor close failed" },
      { operation: "resolve_analysis_profile" },
    );
    const provider: AnalysisProviderCandidate = {
      ...ghidra.provider,
      resolveAnalysisProfile: () => Promise.resolve(err(cleanupFailure)),
    };

    const selected = await new AnalysisProviderRegistry([
      alternate.provider,
      provider,
    ]).select(DATABASE_TARGET);

    expect(selected).toMatchObject({
      ok: false,
      error: {
        _tag: "ProviderAdapterError",
        providerId: "ghidra",
        cleanupIncomplete: true,
      },
    });
    expect(alternate.created).toEqual([]);
  });

  it("owns a signal-ignoring profile probe until final completion and joins shutdown", async () => {
    const alpha = candidate("alpha");
    let observedSignal: AbortSignal | undefined;
    let finish: (() => void) | undefined;
    let started: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const ignoresCancellation: AnalysisProviderCandidate = {
      ...alpha.provider,
      resolveAnalysisProfile: async (target, options) => {
        observedSignal = options?.signal;
        started?.();
        await gate;
        return alpha.provider.resolveAnalysisProfile(target);
      },
    };
    const registry = new AnalysisProviderRegistry([ignoresCancellation]);
    const controller = new AbortController();
    const reason = { caller: "profile finalization" };
    let selected = false;
    const selecting = registry
      .select(DATABASE_TARGET, "alpha", { signal: controller.signal })
      .then((result) => {
        selected = true;
        return result;
      });
    let closed = false;
    let closing: ReturnType<typeof registry.closeOwnedResources> | undefined;
    await withVerifierCleanup(async () => {
      await awaitAcknowledgement(pending, selecting, "profile probe");
      controller.abort(reason);
      closing = registry.closeOwnedResources().then((result) => {
        closed = true;
        return result;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(selected).toBe(false);
      expect(closed).toBe(false);
      expect(registry.hasPendingOwnedResources()).toBe(true);
      expect(observedSignal?.aborted).toBe(true);
      expect(observedSignal?.reason).toBe(reason);
      finish?.();
      const result = await selecting;
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisCancelledError", cause: reason },
      });
      expect(await closing).toEqual(ok(null));
      expect(registry.hasPendingOwnedResources()).toBe(false);
      expect(alpha.created).toEqual([]);
    }, [
      () => {
        controller.abort(reason);
        finish?.();
      },
      async () => {
        await Promise.allSettled([selecting, closing]);
      },
      async () => {
        expect(await registry.closeOwnedResources()).toEqual(ok(null));
      },
    ]);
  });
});

interface CandidateFixture {
  readonly provider: AnalysisProviderCandidate;
  readonly created: string[];
}

const candidate = (
  id: string,
  options: {
    readonly available?: boolean;
    readonly unconfigured?: boolean;
    readonly profile?: "resolved" | "missing" | "error";
  } = {},
): CandidateFixture => {
  const identity: ProviderIdentity = {
    id,
    name: `${id} provider`,
    version: null,
  };
  const created: string[] = [];
  const available = options.available ?? true;
  const provider: AnalysisProviderCandidate = {
    identity: () => identity,
    capabilities: () => [capability(identity)],
    inspectAvailability: (): ProviderAvailability =>
      available
        ? {
            status: "available",
            code: null,
            reason: null,
            diagnostics: { executable_path: `/opt/${id}/bin/analyze` },
          }
        : {
            status: "unavailable",
            code: options.unconfigured ? "not_configured" : "runtime_missing",
            reason: `${id} runtime is unavailable`,
            diagnostics: { executable_path: `/opt/${id}/bin/analyze` },
          },
    inspectTargetSupport: (target): ProviderTargetSupport =>
      target.kind === "database"
        ? {
            status: "supported",
            code: null,
            reason: null,
            diagnostics: { target_kind: target.kind },
          }
        : {
            status: "unsupported",
            code: "target_kind_unsupported",
            reason: `${id} only accepts analysis databases in this fixture`,
            diagnostics: { target_kind: target.kind },
          },
    resolveAnalysisProfile: () => {
      if (options.profile === "error")
        return Promise.resolve(
          err(new ProviderAdapterError(id, "resolve_analysis_profile")),
        );
      return Promise.resolve(
        ok({
          profile:
            options.profile === "missing"
              ? null
              : createAnalysisProfile(
                  { id, name: identity.name, version: "1" },
                  { fixture: id },
                ),
        }),
      );
    },
    createClient: (_target, profile): AnalysisClient => {
      created.push(id);
      const executionIdentity = profile?.provider ?? identity;
      return {
        execute: (operation) =>
          Promise.resolve(
            ok(
              createAnalysisExecution(
                operation === "health" ? null : `${id}:${operation}`,
                executionIdentity,
              ),
            ),
          ),
        close: () => Promise.resolve(ok(null)),
      };
    },
  };
  return { provider, created };
};

const capability = (provider: ProviderIdentity): CapabilityDescriptor => ({
  provider,
  operation: "address_name",
  available: true,
  reason: null,
  effects: {
    mutatesArtifact: false,
    launchesProcess: true,
    mayShowUi: false,
    mayAccessNetwork: false,
    mayWriteFilesystem: false,
    changesPermissions: false,
    requiresRoot: false,
  },
  limitations: [],
});

describe("analysis provider registry: explicit profile refusals", () => {
  const refusing = (refusal: AnalysisUnsupportedTargetError) => ({
    ...candidate("ghidra").provider,
    resolveAnalysisProfile: () => Promise.resolve(err(refusal)),
  });

  it("keeps a refusing provider's reason, recovery and evidence in the selection failure", async () => {
    const capturedOutput = {
      stdout: "",
      stderr: "x86-64 only",
      truncated: false,
    };
    const refusal = new AnalysisUnsupportedTargetError(
      "resolve_analysis_profile",
      DATABASE_TARGET.path,
      "The configured extension supports x86-64 only.",
      {
        remediationAction: "Omit the extension setting for this target.",
        capturedOutput,
        diagnostics: { extension: "fixture" },
      },
    );
    const selected = await new AnalysisProviderRegistry([
      refusing(refusal),
    ]).select(DATABASE_TARGET, "ghidra");
    if (selected.ok) throw new Error("expected a profile refusal");
    expect(selected.error).toBeInstanceOf(ProviderSelectionError);
    expect(selected.error.cause).toBe(refusal);
    expect(projectAnalysisError(selected.error)).toMatchObject({
      code: "capability_unavailable",
      message: refusal.message,
      remediation: { action: "Omit the extension setting for this target." },
      details: {
        selection_reason: "target_unsupported",
        requested_provider_id: "ghidra",
        candidate_ids: ["ghidra"],
        rejections: [
          {
            provider_id: "ghidra",
            code: "target_format_unsupported",
            reason: "The configured extension supports x86-64 only.",
          },
        ],
        captured_output: capturedOutput,
        diagnostics: { extension: "fixture" },
      },
    });
  });

  it("returns a refusal with unconfirmed cleanup unchanged", async () => {
    const refusal = new AnalysisUnsupportedTargetError(
      "resolve_analysis_profile",
      DATABASE_TARGET.path,
      "The configured extension supports x86-64 only.",
      { cleanup: { reason: "probe close failed", resources: ["/tmp/probe"] } },
    );
    const selected = await new AnalysisProviderRegistry([
      refusing(refusal),
    ]).select(DATABASE_TARGET, "ghidra");
    if (selected.ok) throw new Error("expected a profile refusal");
    expect(selected.error).toBe(refusal);
    expect(projectAnalysisError(selected.error)).toMatchObject({
      code: "cleanup_incomplete",
      details: { cleanup: "incomplete", resources: ["/tmp/probe"] },
    });
  });
});
describe("profile resolution terminal facts", () => {
  it.each([false, true])(
    "preserves a physical profile failure across late caller abort (throws: %s)",
    async (throws) => {
      const alpha = candidate("alpha");
      const controller = new AbortController();
      const primary = new ProviderAdapterError(
        "alpha",
        "resolve_analysis_profile",
        { cause: new Error("physical profile failure") },
      );
      const registry = new AnalysisProviderRegistry([
        {
          ...alpha.provider,
          resolveAnalysisProfile: async () => {
            controller.abort({ caller: "after physical failure" });
            if (throws) throw primary;
            return err(primary);
          },
        },
      ]);
      const result = await registry.select(DATABASE_TARGET, "alpha", {
        signal: controller.signal,
      });
      expect(result).toEqual(err(primary));
      expect(registry.hasPendingOwnedResources()).toBe(false);
      expect(await registry.closeOwnedResources()).toEqual(ok(null));
    },
  );

  it("preserves exact cancellation with cleanup and blocks admission until its owner confirms release", async () => {
    const alpha = candidate("alpha");
    const controller = new AbortController();
    const reason = { caller: "final cleanup" };
    const primary = new AnalysisCancelledError("resolve_analysis_profile", {
      cause: reason,
      cleanup: { reason: "file close rejected", resources: ["profile-file"] },
    });
    let attempts = 0;
    let allowClose = false;
    const registry = new AnalysisProviderRegistry([
      {
        ...alpha.provider,
        resolveAnalysisProfile: async () => {
          attempts++;
          controller.abort(reason);
          return err(primary);
        },
        closeOwnedResources: async () => {
          if (!allowClose) return err(primary);
          primary.resolveCleanup();
          return ok(null);
        },
      },
    ]);
    const result = await registry.select(DATABASE_TARGET, "alpha", {
      signal: controller.signal,
    });
    expect(result).toEqual(err(primary));
    expect(primary.cause).toBe(reason);
    expect(registry.hasPendingOwnedResources()).toBe(true);
    expect(await registry.select(DATABASE_TARGET, "alpha")).toEqual(
      err(primary),
    );
    expect(attempts).toBe(1);
    allowClose = true;
    expect(await registry.closeOwnedResources()).toEqual(ok(null));
    expect(primary.cleanupIncomplete).toBe(false);
    expect(registry.hasPendingOwnedResources()).toBe(false);
  });
});

describe("automatic profile cleanup ownership", () => {
  it.each(["alpha", "beta"])(
    "keeps automatic mixed-child cleanup conjunctive when %s releases first",
    async (first) => {
      const alpha = candidate("alpha");
      const beta = candidate("beta");
      const controller = new AbortController();
      const reason = { caller: "mixed profile finalization" };
      const failures = {
        alpha: new AnalysisCancelledError("resolve_analysis_profile", {
          cause: reason,
          cleanup: { reason: "alpha descriptor", resources: ["alpha-file"] },
        }),
        beta: new ProviderCleanupError("beta", ["beta-file"], {
          reason: "beta descriptor",
        }),
      };
      let entered = 0;
      let admitChildren: (() => void) | undefined;
      const admitted = new Promise<void>((resolve) => {
        admitChildren = resolve;
      });
      const released = new Set<string>();
      const registry = new AnalysisProviderRegistry(
        [alpha, beta].map((fixture) => {
          const id = fixture.provider.identity().id as "alpha" | "beta";
          return {
            ...fixture.provider,
            resolveAnalysisProfile: async () => {
              entered++;
              if (entered === 2) {
                controller.abort(reason);
                admitChildren?.();
              }
              await admitted;
              return err(failures[id]);
            },
            closeOwnedResources: async () => {
              if (!released.has(id)) return err(failures[id]);
              failures[id].resolveCleanup();
              return ok(null);
            },
          };
        }),
      );
      const selecting = registry.select(DATABASE_TARGET, "auto", {
        signal: controller.signal,
      });
      await withVerifierCleanup(async () => {
        await awaitAcknowledgement(
          admitted,
          selecting,
          "profile children admission",
        );
        const result = await selecting;
        if (result.ok) throw new Error("Mixed failed profiles admitted");
        expect(result.error.cleanupIncomplete).toBe(true);
        expect(result.error.cleanupResources).toEqual([
          "alpha-file",
          "beta-file",
        ]);
        expect(result.error.diagnostics?.profile_errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ provider_id: "alpha" }),
            expect.objectContaining({ provider_id: "beta" }),
          ]),
        );
        const close1 = await registry.closeOwnedResources();
        expect(close1.ok).toBe(false);
        released.add(first);
        const close2 = await registry.closeOwnedResources();
        expect(close2.ok).toBe(false);
        expect(result.error.cleanupIncomplete).toBe(true);
        expect(result.error.cleanupResources).toEqual([
          first === "alpha" ? "beta-file" : "alpha-file",
        ]);
        expect(close1.ok ? [] : close1.error.cleanupResources).toEqual([
          first === "alpha" ? "beta-file" : "alpha-file",
        ]);
        released.add(first === "alpha" ? "beta" : "alpha");
        expect(await registry.closeOwnedResources()).toEqual(ok(null));
        expect(result.error.cleanupIncomplete).toBe(false);
        if (close1.ok || close2.ok)
          throw new Error("Cleanup unexpectedly succeeded");
        expect(close1.error.cleanupIncomplete).toBe(false);
        expect(close2.error.cleanupIncomplete).toBe(false);
        expect(registry.hasPendingOwnedResources()).toBe(false);
      }, [
        () => {
          released.add("alpha");
          released.add("beta");
          controller.abort(reason);
          admitChildren?.();
        },
        async () => {
          await Promise.allSettled([selecting]);
        },
        async () => {
          expect(await registry.closeOwnedResources()).toEqual(ok(null));
        },
      ]);
    },
  );
});

it("registers before production and gates fresh selections until shutdown has joined finalization", async () => {
  const alpha = candidate("alpha");
  let calls = 0;
  let enter: (() => void) | undefined;
  let finish: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const registry = new AnalysisProviderRegistry([
    {
      ...alpha.provider,
      resolveAnalysisProfile: async (target) => {
        calls++;
        if (calls === 1) {
          enter?.();
          await gate;
        }
        return alpha.provider.resolveAnalysisProfile(target);
      },
    },
  ]);
  const selecting = registry.select(DATABASE_TARGET, "alpha");
  let closing: ReturnType<typeof registry.closeOwnedResources> | undefined;
  let next: ReturnType<typeof registry.select> | undefined;
  await withVerifierCleanup(async () => {
    await awaitAcknowledgement(entered, selecting, "profile finalization");
    closing = registry.closeOwnedResources();
    next = registry.select(DATABASE_TARGET, "alpha");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(calls).toBe(1);
    expect(registry.hasPendingOwnedResources()).toBe(true);
    finish?.();
    expect(await selecting).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    expect(await closing).toEqual(ok(null));
    expect((await next).ok).toBe(true);
    expect(calls).toBe(2);
    expect(registry.hasPendingOwnedResources()).toBe(false);
  }, [
    () => finish?.(),
    async () => {
      await Promise.allSettled([selecting, closing, next]);
    },
    async () => {
      expect(await registry.closeOwnedResources()).toEqual(ok(null));
    },
  ]);
});

it("joins cancelled readiness finalization and shutdown before admitting another observation", async () => {
  const base = candidate("alpha").provider;
  let enter!: () => void;
  let finish!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  let observed: AbortSignal | undefined;
  const registry = new AnalysisProviderRegistry([
    {
      ...base,
      inspectAvailability: async ({
        signal,
      }: AnalysisProviderInspectionOptions = {}) => {
        calls++;
        if (calls === 1) {
          observed = signal;
          enter();
          await gate;
        }
        return base.inspectAvailability();
      },
    },
  ]);
  const controller = new AbortController();
  const reason = { request: "opaque readiness cancellation" };
  let settled = false;
  const observing = registry
    .candidates(undefined, { signal: controller.signal })
    .catch((cause) => {
      settled = true;
      return cause;
    });
  let closed = false;
  let closing: ReturnType<typeof registry.closeOwnedResources> | undefined;
  let next: ReturnType<typeof registry.candidates> | undefined;
  await withVerifierCleanup(async () => {
    await awaitAcknowledgement(entered, observing, "readiness observation");
    controller.abort(reason);
    closing = registry.closeOwnedResources().then((value) => {
      closed = true;
      return value;
    });
    next = registry.candidates();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(closed).toBe(false);
    expect(calls).toBe(1);
    expect(observed?.reason).toBe(reason);
    expect(registry.hasPendingOwnedResources()).toBe(true);
    finish();
    const failure = await observing;
    expect(failure).toBeInstanceOf(AnalysisCancelledError);
    expect(failure.cause).toBe(reason);
    expect(await closing).toEqual(ok(null));
    expect(await next).toMatchObject([
      {
        availability: {
          status: "unknown",
          diagnostics: { finalization: "in_progress" },
        },
      },
    ]);
    expect(await registry.candidates()).toHaveLength(1);
    expect(calls).toBe(2);
    expect(registry.hasPendingOwnedResources()).toBe(false);
  }, [
    () => {
      controller.abort(reason);
      finish();
    },
    async () => {
      await Promise.allSettled([observing, closing, next]);
    },
    async () => {
      expect(await registry.closeOwnedResources()).toEqual(ok(null));
    },
  ]);
});

it.each(["alpha", "beta"])(
  "retains unknown owned-resource cleanup when %s has no completion signal",
  async (unknownOwner) => {
    const unknown = new ProviderAdapterError(unknownOwner, "close_binary", {
      userMessage: "cleanup completion unknown",
    });
    const tracked = new ProviderCleanupError("rea", ["owned-reader"], {});
    let released = false;
    const registry = new AnalysisProviderRegistry(
      ["alpha", "beta"].map((id) => ({
        ...candidate(id).provider,
        closeOwnedResources: async () => {
          if (!released) return err(id === unknownOwner ? unknown : tracked);
          if (id !== unknownOwner) tracked.resolveCleanup();
          return ok(null);
        },
      })),
    );
    const closed = await registry.closeOwnedResources();
    if (closed.ok) throw new Error("Expected incomplete registry close");
    expect(closed.error.cleanupIncomplete).toBe(true);
    released = true;
    expect(await registry.closeOwnedResources()).toEqual(ok(null));
    expect(tracked.cleanupIncomplete).toBe(false);
    expect(closed.error.cleanupIncomplete).toBe(true);
  },
);

it("joins every candidate and retains physical failure with exact mixed cleanup owners", async () => {
  const alpha = candidate("alpha").provider;
  const beta = candidate("beta").provider;
  const gamma = candidate("gamma").provider;
  let finish!: () => void;
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const physical = new ProviderAdapterError("alpha", "binary_session", {
    diagnostics: { reason: "physical observation failed" },
  });
  const cleanup = new ProviderCleanupError(
    "beta",
    ["beta retained prerequisite"],
    { reason: "controlled cleanup refusal" },
  );
  let releases = 0;
  const registry = new AnalysisProviderRegistry([
    {
      ...alpha,
      inspectAvailability: async () => {
        throw physical;
      },
    },
    {
      ...beta,
      inspectAvailability: async () => {
        enter();
        await gate;
        throw cleanup;
      },
      closeOwnedResources: async () => {
        releases++;
        cleanup.resolveCleanup();
        return ok(null);
      },
    },
    gamma,
  ]);
  let settled = false;
  const observing = registry.candidates().catch((cause) => {
    settled = true;
    return cause;
  });
  await withVerifierCleanup(async () => {
    await awaitAcknowledgement(
      entered,
      observing,
      "mixed readiness observation",
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    finish();
    const failure = await observing;
    expect(failure.cleanupIncomplete).toBe(true);
    expect(failure.cleanupResources).toContain("beta retained prerequisite");
    expect(failure.diagnostics).toMatchObject({
      readiness_candidates: [
        { provider: { id: "gamma" }, availability: { status: "available" } },
      ],
    });
    expect(failure.cleanupPrimary).toBe(physical);
    expect(projectAnalysisError(failure).details).toMatchObject({
      diagnostics: {
        readiness_errors: expect.arrayContaining([
          {
            provider_id: "alpha",
            error: expect.objectContaining({ code: "execution_failure" }),
          },
          {
            provider_id: "beta",
            error: expect.objectContaining({ code: "cleanup_incomplete" }),
          },
        ]),
      },
    });
    expect(registry.hasPendingOwnedResources()).toBe(true);
    expect(await registry.closeOwnedResources()).toEqual(ok(null));
    expect(releases).toBe(1);
    expect(failure.cleanupIncomplete).toBe(false);
    expect(projectAnalysisError(failure)).toMatchObject({
      code: "execution_failure",
      details: { diagnostics: { reason: "physical observation failed" } },
    });
    expect(registry.hasPendingOwnedResources()).toBe(false);
  }, [
    finish,
    async () => {
      await observing;
    },
    async () => {
      expect(await registry.closeOwnedResources()).toEqual(ok(null));
    },
  ]);
});

it("registers selection before async readiness can race shutdown", async () => {
  let calls = 0;
  let observed: AbortSignal | undefined;
  const base = candidate("alpha").provider;
  const registry = new AnalysisProviderRegistry([
    {
      ...base,
      inspectAvailability: async ({
        signal,
      }: AnalysisProviderInspectionOptions = {}) => {
        calls++;
        observed = signal;
        return base.inspectAvailability();
      },
    },
  ]);
  const selecting = registry.select(DATABASE_TARGET, "alpha");
  const closing = registry.closeOwnedResources();
  const [selected, closed] = await Promise.all([selecting, closing]);
  expect(selected).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  expect(closed).toEqual(ok(null));
  expect(calls).toBe(1);
  expect(observed?.aborted).toBe(true);
  expect((await registry.select(DATABASE_TARGET, "alpha")).ok).toBe(true);
  expect(calls).toBe(2);
  expect(registry.hasPendingOwnedResources()).toBe(false);
});
