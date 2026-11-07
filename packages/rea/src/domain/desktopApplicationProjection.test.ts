import { describe, expect, it } from "vitest";

import type { DesktopFact, DesktopFile } from "./desktopApplication.js";
import {
  DESKTOP_PROBES_PER_FACT,
  projectDesktopApplication,
} from "./desktopApplicationProjection.js";

const row = (path: string, facts: DesktopFact[]): DesktopFile => ({
  file_id: `dsf_${"a".repeat(64)}`,
  path,
  local_path: `/fixture/${path}`,
  kind: "file",
  bytes: 1,
  identity: null,
  read_status: "examined",
  ranges: [],
  facts,
  issues: [],
});

// Every fact kind, including the IL2CPP pair that offers a native probe.
const facts: DesktopFact[] = [
  { kind: "pe-cli-directory", offset: 0, value: { rva: 1, bytes: 72 } },
  {
    kind: "unity-assembly-reference",
    offset: 0,
    value: { name: "UnityEngine", token: "0x23000001", managed_directory: "M" },
  },
  {
    kind: "native-image-header",
    offset: 0,
    value: { format: "mach-o", signature: "cffaedfe" },
  },
  {
    kind: "il2cpp-metadata-header",
    offset: 0,
    value: { magic: "0xfab11baf", raw_version: 29 },
  },
  {
    kind: "godot-pck-header",
    offset: 0,
    value: {
      pack_version: 2,
      engine_version: [4, 2, 0],
      placement: "standalone",
    },
  },
  {
    kind: "unityfs-header",
    offset: 0,
    value: {
      format_version: 8,
      engine_version: "2022.3.0f1",
      flags: 0,
      declared_size: 1,
    },
  },
  {
    kind: "gamemaker-form-header",
    offset: 0,
    value: { container: "FORM", first_chunk: "GEN8" },
  },
  { kind: "il2cpp-library-convention", offset: null, value: "p" },
  { kind: "electron-asar-convention", offset: null, value: "p" },
  { kind: "unreal-container-convention", offset: null, value: "p" },
];

describe("desktop next probe fan-out", () => {
  it.each(facts)("derives at most the reserved probes from $kind", (fact) => {
    const { next_probes } = projectDesktopApplication([
      row("resources/app.asar", [fact]),
    ]);
    expect(next_probes.length).toBeLessThanOrEqual(DESKTOP_PROBES_PER_FACT);
  });

  it("derives at most the reserved probes per fact on one file", () => {
    const { next_probes } = projectDesktopApplication([
      row("resources/app.asar", facts),
    ]);
    expect(next_probes.length).toBeGreaterThan(0);
    expect(next_probes.length).toBeLessThanOrEqual(
      DESKTOP_PROBES_PER_FACT * facts.length,
    );
  });
});
