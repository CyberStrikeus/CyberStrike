import { describe, expect, it, vi } from "vitest";

import {
  createAnalysisExecution,
  type AnalysisOperation,
  type AnalysisOperationPort,
} from "./AnalysisProvider.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { EnhancedTools } from "./EnhancedTools.js";
import type { BinaryArchitecture } from "../domain/binaryTargetTypes.js";
import { objcSwiftMetadataSchema } from "../domain/native/objcSwiftMetadata.js";
import { err, ok } from "../domain/result.js";
import {
  AnalysisCapabilityUnavailableError,
  AnalysisOutputError,
  AnalysisCancelledError,
} from "../domain/analysisErrorCore.js";
import { createAnalysisProfile } from "../domain/analysisProfile.js";
import type { MachoTargetSelection } from "../domain/apple/machoTargetSelection.js";

const sha256 = "a".repeat(64);
const provider = { id: "native", name: "Native", version: "1" };
const namesProvider = { id: "hopper", name: "Hopper", version: "2" };
const selection = {
  kind: "macho-selected-image-v1" as const,
  container: "thin" as const,
  offset: 0,
  byte_length: 4096,
  cpu_type: 0x0100000c,
  cpu_subtype: 0x80000002,
  container_table_sha256: null,
};
const profile = createAnalysisProfile(namesProvider, {
  target_selection: selection,
});
const subject = {
  sha256,
  path: "/fixture",
  format: "mach-o" as const,
  architecture: "arm64" as const,
};

const createPort = (
  nativeOverrides: Partial<{
    sha256: string;
    architecture: BinaryArchitecture;
    names: Array<{ address: string; value: string }>;
    nameLimitations: string[];
    metadataFailure: AnalysisError;
    bindings: Array<{
      requested_address: string;
      symbol: string;
      binding_source: "chained" | "bind" | "weak" | "lazy";
      library_ordinal: number;
      library: string | null;
      weak: boolean;
      addend: string;
    }>;
    targetSelection: MachoTargetSelection | null;
    nameProfile: boolean;
  }> = {},
): AnalysisOperationPort => ({
  execute: async (operation: AnalysisOperation, parameters) => {
    if (operation === "list_names")
      return ok(
        createAnalysisExecution(
          nativeOverrides.names ?? [
            { address: "0x1000", value: "OBJC_CLASS_$_Document$GOT" },
            { address: "0x1000", value: "OBJC_CLASS_$_Document" },
          ],
          namesProvider,
          {
            subject,
            limitations: nativeOverrides.nameLimitations ?? [],
            ...(nativeOverrides.nameProfile === false
              ? {}
              : { analysisProfile: profile }),
          },
        ),
      );
    if (operation !== "inspect_native_dispatch_metadata")
      return err(
        new AnalysisCapabilityUnavailableError(
          provider.id,
          operation,
          "Unavailable in fixture",
        ),
      );

    expect(parameters).toMatchObject({
      max_records: 20_000,
      objc_class_import_addresses: [
        ...new Set(
          (
            nativeOverrides.names ?? [
              { address: "0x1000", value: "OBJC_CLASS_$_Document$GOT" },
              { address: "0x1000", value: "OBJC_CLASS_$_Document" },
            ]
          ).map(({ address }) => address),
        ),
      ],
      objc_class_import_addresses_complete: true,
    });
    if (nativeOverrides.metadataFailure !== undefined)
      return err(nativeOverrides.metadataFailure);
    const result = objcSwiftMetadataSchema.parse({ db_save_result: null });
    if (nativeOverrides.targetSelection !== null)
      result.target_selection = nativeOverrides.targetSelection ?? selection;
    result.objc_class_import_bindings = nativeOverrides.bindings ?? [
      {
        requested_address: "0x1000",
        symbol: "_OBJC_CLASS_$_Document",
        binding_source: "chained",
        library_ordinal: 1,
        library: "/System/Library/Frameworks/AppKit.framework/AppKit",
        weak: false,
        addend: "0",
      },
    ];
    result.objc_class_import_binding_coverage = {
      facet: "objc_class_import_bindings",
      status: "complete",
      reason: null,
      examined: 1,
      decoded: result.objc_class_import_bindings.length,
    };
    return ok(
      createAnalysisExecution(
        {
          target_sha256: nativeOverrides.sha256 ?? sha256,
          target_architecture: nativeOverrides.architecture ?? "arm64",
          provider,
          analysis_profile_digest: null,
          result,
        },
        provider,
        {
          subject: {
            ...subject,
            ...(nativeOverrides.sha256 === undefined
              ? {}
              : { sha256: nativeOverrides.sha256 }),
            ...(nativeOverrides.architecture === undefined
              ? {}
              : { architecture: nativeOverrides.architecture }),
          },
        },
      ),
    );
  },
});

it.each([
  ["list_names", "omitted"],
  ["list_names", "unbound"],
  ["inspect_native_dispatch_metadata", "omitted"],
  ["inspect_native_dispatch_metadata", "unbound"],
] as const)(
  "retains class candidates when %s subject is %s",
  async (operation, state) => {
    const port = createPort();
    const tools = new EnhancedTools({
      execute: async (...args) => {
        const result = await port.execute(...args);
        if (!result.ok || args[0] !== operation) return result;
        const value = { ...result.value };
        if (state === "omitted") delete value.subject;
        else value.subject = null;
        return ok(value);
      },
    });
    await expect(tools.execute("get_objc_classes", {})).resolves.toMatchObject({
      ok: true,
      value: {
        count: 2,
        classes: [
          { address: "0x1000", name: "OBJC_CLASS_$_Document$GOT" },
          { address: "0x1000", name: "OBJC_CLASS_$_Document" },
        ],
        identity_coverage: { status: "unknown" },
      },
    });
  },
);

it("reports no applicable identity scan when names contain no owned class labels", async () => {
  const execute = vi.fn(
    createPort({
      names: [
        { address: "0x1000", value: "__objc_class_HuntRoot_class" },
        { address: "0x2000", value: "PTR__OBJC_CLASS_$_NSAlert_100028668" },
        { address: "0x3000", value: "s__OBJC_CLASS_$_NSAlert_10002ed0d" },
      ],
    }).execute,
  );
  const tools = new EnhancedTools({ execute });
  await expect(tools.execute("get_objc_classes", {})).resolves.toEqual({
    ok: true,
    value: {
      count: 0,
      classes: [],
      identity_coverage: { status: "not_applicable", reason: null },
    },
  });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0]?.[0]).toBe("list_names");
});

describe("Objective-C class import identity composition", () => {
  it("joins only exact same-target bind slots and preserves literal filter selection", async () => {
    const tools = new EnhancedTools(createPort());
    await expect(tools.execute("get_objc_classes", {})).resolves.toMatchObject({
      ok: true,
      value: {
        count: 1,
        classes: [
          {
            address: "0x1000",
            name: "OBJC_CLASS_$_Document",
            binding_identity: {
              symbol: "_OBJC_CLASS_$_Document",
              slot_addresses: ["0x1000"],
            },
          },
        ],
        identity_coverage: { status: "complete", reason: null },
      },
    });
    await expect(
      tools.execute("get_objc_classes", { pattern: "$GOT" }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        count: 1,
        classes: [
          {
            address: "0x1000",
            name: "OBJC_CLASS_$_Document$GOT",
            binding_identity: {
              symbol: "_OBJC_CLASS_$_Document",
              binding_source: "chained",
              library_ordinal: 1,
              library: "/System/Library/Frameworks/AppKit.framework/AppKit",
              weak: false,
              addend: "0",
              slot_addresses: ["0x1000"],
            },
          },
        ],
        identity_coverage: { status: "complete", reason: null },
      },
    });
  });

  it("keeps rows unjoined when the native observation has a different subject", async () => {
    const tools = new EnhancedTools(createPort({ sha256: "b".repeat(64) }));
    await expect(tools.execute("get_objc_classes", {})).resolves.toMatchObject({
      ok: true,
      value: {
        count: 2,
        classes: [
          { address: "0x1000", name: "OBJC_CLASS_$_Document$GOT" },
          { address: "0x1000", name: "OBJC_CLASS_$_Document" },
        ],
        identity_coverage: { status: "unknown" },
      },
    });
  });

  it("keeps identity unknown when exact selected-image evidence is missing or mismatched", async () => {
    const cases = [
      { nameProfile: false },
      { targetSelection: null },
      { targetSelection: { ...selection, cpu_type: 0x01000007 } },
      { targetSelection: { ...selection, cpu_subtype: 2 } },
      {
        targetSelection: {
          ...selection,
          container: "fat" as const,
          offset: 4096,
          container_table_sha256: "b".repeat(64),
        },
      },
    ];
    for (const overrides of cases) {
      const tools = new EnhancedTools(createPort(overrides));
      await expect(
        tools.execute("get_objc_classes", {}),
      ).resolves.toMatchObject({
        ok: true,
        value: { count: 2, identity_coverage: { status: "unknown" } },
      });
    }
  });

  it("marks identity coverage partial when the selected names inventory is limited", async () => {
    const tools = new EnhancedTools(
      createPort({ nameLimitations: ["provider capped the name inventory"] }),
    );
    await expect(tools.execute("get_objc_classes", {})).resolves.toMatchObject({
      ok: true,
      value: {
        count: 1,
        identity_coverage: {
          status: "partial",
          reason: "list_names: provider capped the name inventory",
        },
      },
    });
  });

  it("keeps names with unknown identity when binding inspection is unavailable", async () => {
    const tools = new EnhancedTools(
      createPort({
        names: [
          { address: "0x1000", value: "OBJC_CLASS_$_Document$GOT" },
          { address: "0x1000", value: "OBJC_CLASS_$_Document" },
          { address: "0x2000", value: "OBJC_CLASS_$_Document" },
          { address: "0x2000", value: "OBJC_CLASS_$_Document" },
        ],
        metadataFailure: new AnalysisCapabilityUnavailableError(
          provider.id,
          "inspect_native_dispatch_metadata",
          "No static Mach-O reader",
        ),
      }),
    );
    await expect(tools.execute("get_objc_classes", {})).resolves.toMatchObject({
      ok: true,
      value: {
        count: 3,
        classes: [
          { address: "0x1000", name: "OBJC_CLASS_$_Document$GOT" },
          { address: "0x1000", name: "OBJC_CLASS_$_Document" },
          { address: "0x2000", name: "OBJC_CLASS_$_Document" },
        ],
        identity_coverage: {
          status: "unknown",
          reason: "No static Mach-O reader",
        },
      },
    });
  });

  it("preserves non-capability binding failures", async () => {
    const failure = new AnalysisOutputError(
      "inspect_native_dispatch_metadata",
      "fixture failed",
    );
    const tools = new EnhancedTools(createPort({ metadataFailure: failure }));
    await expect(tools.execute("get_objc_classes", {})).resolves.toEqual({
      ok: false,
      error: failure,
    });
  });
});

it("preserves same-named rows whose exact import slots have different identities", async () => {
  const addresses = ["0x1000", "0x2000", "0x3000", "0x4000"];
  const name = "OBJC_CLASS_$_Document";
  const tools = new EnhancedTools(
    createPort({
      names: [
        ...addresses.map((address) => ({ address, value: name })),
        { address: "0x1000", value: name },
      ],
      bindings: [
        {
          requested_address: "0x1000",
          symbol: "_OBJC_CLASS_$_Document",
          binding_source: "chained",
          library_ordinal: 1,
          library: "/System/Library/Frameworks/AppKit.framework/AppKit",
          weak: false,
          addend: "0",
        },
        {
          requested_address: "0x2000",
          symbol: "_OBJC_CLASS_$_Document",
          binding_source: "chained",
          library_ordinal: 1,
          library: "/System/Library/Frameworks/UIKit.framework/UIKit",
          weak: false,
          addend: "0",
        },
        {
          requested_address: "0x3000",
          symbol: "_OBJC_CLASS_$_Document",
          binding_source: "chained",
          library_ordinal: 1,
          library: "/System/Library/Frameworks/AppKit.framework/AppKit",
          weak: true,
          addend: "0",
        },
        {
          requested_address: "0x4000",
          symbol: "_OBJC_CLASS_$_Document",
          binding_source: "chained",
          library_ordinal: 1,
          library: "/System/Library/Frameworks/AppKit.framework/AppKit",
          weak: false,
          addend: "1",
        },
      ],
    }),
  );

  await expect(tools.execute("get_objc_classes", {})).resolves.toMatchObject({
    ok: true,
    value: {
      count: 4,
      classes: addresses.map((address, index) => ({
        address,
        name,
        binding_identity: {
          symbol: "_OBJC_CLASS_$_Document",
          binding_source: "chained",
          library_ordinal: 1,
          library:
            index === 1
              ? "/System/Library/Frameworks/UIKit.framework/UIKit"
              : "/System/Library/Frameworks/AppKit.framework/AppKit",
          weak: index === 2,
          addend: index === 3 ? "1" : "0",
          slot_addresses: [address],
        },
      })),
      identity_coverage: { status: "complete", reason: null },
    },
  });
});

describe("EnhancedTools cancellation ownership", () => {
  it("preserves the caller reason at admission", async () => {
    const reason = { request: "cancel-before-observation" };
    const controller = new AbortController();
    controller.abort(reason);
    const execute = vi.fn(createPort().execute);
    const tools = new EnhancedTools({ execute });

    const result = await tools.execute(
      "get_objc_classes",
      {},
      controller.signal,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Pre-cancelled observation was accepted");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(reason);
    expect(execute).not.toHaveBeenCalled();
  });

  it("preserves a post-success caller reason without replacing provider failures", async () => {
    const reason = { request: "cancel-after-provider-success" };
    const controller = new AbortController();
    const successfulPort = createPort();
    const successTools = new EnhancedTools({
      execute: async (...args) => {
        const result = await successfulPort.execute(...args);
        if (args[0] === "list_names" && result.ok) controller.abort(reason);
        return result;
      },
    });

    const cancelled = await successTools.execute(
      "get_objc_classes",
      {},
      controller.signal,
    );
    expect(cancelled.ok).toBe(false);
    if (cancelled.ok)
      throw new Error("Post-cancelled observation was accepted");
    expect(cancelled.error).toBeInstanceOf(AnalysisCancelledError);
    expect(cancelled.error.cause).toBe(reason);

    const physicalFailure = new AnalysisOutputError(
      "list_names",
      "fixture read failed",
    );
    const failingController = new AbortController();
    const failureTools = new EnhancedTools({
      execute: async (...args) => {
        if (args[0] === "list_names") {
          failingController.abort(reason);
          return err(physicalFailure);
        }
        return successfulPort.execute(...args);
      },
    });
    const failed = await failureTools.execute(
      "get_objc_classes",
      {},
      failingController.signal,
    );
    expect(failed).toEqual({ ok: false, error: physicalFailure });
  });
});
