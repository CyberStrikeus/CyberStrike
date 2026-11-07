import { expect, it } from "vitest";
import { DevicetreeService } from "./DevicetreeService.js";
import { DEVICETREE_PROVIDER } from "../../domain/investigationProviders.js";
import type { Devicetree } from "../../domain/firmware/devicetree.js";
import { ok } from "../../domain/result.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
const report = (): Devicetree => ({
  artifact: { path: "/board.dtb", bytes: 128, sha256: "a".repeat(64) },
  header: {
    magic: 0xd00dfeed,
    totalsize: 128,
    off_dt_struct: 56,
    off_dt_strings: 100,
    off_mem_rsvmap: 40,
    version: 17,
    last_comp_version: 16,
    boot_cpuid_phys: 0,
    size_dt_strings: 6,
    size_dt_struct: 44,
  },
  reservations: [],
  nodes: [
    {
      path: "/",
      parent: null,
      offset: 56,
      properties: [
        {
          name: "model",
          offset: 76,
          bytes: 2,
          hex: "6100",
          truncated: false,
          derived: {
            confidence: "derived",
            strings: ["a"],
            cells: null,
            reg: null,
          },
        },
      ],
    },
  ],
  references: [],
  summary: {
    confidence: "derived",
    compatible: null,
    model: "a",
    bootargs: null,
    stdout_path: null,
    aliases: [],
  },
  coverage: { status: "complete", examined_nodes: 1, examined_properties: 1 },
  limitations: [],
});

it("validates caller paths before invoking the provider", async () => {
  let calls = 0;
  const service = new DevicetreeService({
    identity: DEVICETREE_PROVIDER,
    inspect: () => {
      calls++;
      return Promise.resolve(ok(report()));
    },
  });
  const result = await service.inspect({ path: "relative.dtb" });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toBeInstanceOf(AnalysisInputError);
  expect(calls).toBe(0);
});
it("rejects cancellation at provider completion", async () => {
  const controller = new AbortController();
  const service = new DevicetreeService({
    identity: DEVICETREE_PROVIDER,
    inspect: () => {
      controller.abort();
      return Promise.resolve(ok(report()));
    },
  });
  const result = await service.inspect(
    { path: "/board.dtb" },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toBeInstanceOf(AnalysisCancelledError);
});
it("rejects provider coverage and source-range inconsistencies", async () => {
  for (const change of [
    (r: ReturnType<typeof report>) => {
      r.coverage.examined_nodes++;
    },
    (r: ReturnType<typeof report>) => {
      r.nodes[0]!.properties[0]!.offset = r.artifact.bytes;
    },
  ]) {
    const r = report();
    change(r);
    const service = new DevicetreeService({
      identity: DEVICETREE_PROVIDER,
      inspect: () => Promise.resolve(ok(r)),
    });
    const result = await service.inspect({ path: "/board.dtb" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AnalysisOutputError);
  }
});
