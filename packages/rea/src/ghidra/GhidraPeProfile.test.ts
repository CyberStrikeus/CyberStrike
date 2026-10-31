import { expect, it } from "vitest";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import { ghidraPePdbLimitations } from "./GhidraPeProfile.js";
import {
  ghidraPdbLimitations,
  type GhidraSessionInfo,
} from "./GhidraSessionValues.js";

const target: BinaryTarget = {
  path: "/fixture/public.exe",
  sha256: "a".repeat(64),
  kind: "executable",
  format: "pe",
  architecture: "x86_64",
  availableArchitectures: ["x86_64"],
  executableRole: "application",
  managed: false,
  codeView: {
    pdbPath: "public.pdb",
    pdbFileName: "public.pdb",
    guid: "01234567-89ab-cdef-0123-456789abcdef",
    age: 10,
  },
};
const absentAttributes = {
  file: null,
  guid: null,
  age: null,
  signature: null,
  version: null,
  loaded: null,
};

it.each(["file", "guid", "age"] as const)(
  "retains declared identity when only reported %s is omitted",
  (attribute) => {
    const pdb: GhidraSessionInfo["pdb"] = {
      file: "program.pdb",
      guid: "reported-guid",
      age: "a",
      signature: null,
      version: "RSDS",
      loaded: null,
      resource_limit: { omitted_attributes: [attribute], utf16_budget: 4096 },
      [attribute]: null,
    };
    const caveats = ghidraPePdbLimitations(target, pdb).join(" ");
    expect(caveats).toContain("omitted");
    expect(caveats).toContain('PDB "public.pdb"');
    expect(caveats).toContain("01234567-89ab-cdef-0123-456789abcdef");
    expect(caveats).toContain("load state unknown");
  },
);

it.each([undefined, absentAttributes])(
  "retains declared identity and unknown load state when reported attributes are %j",
  (pdb) => {
    const caveats = ghidraPePdbLimitations(target, pdb);
    expect(caveats).toHaveLength(1);
    expect(caveats[0]).toContain(
      'PDB "public.pdb" (GUID 01234567-89ab-cdef-0123-456789abcdef, age (decimal) 10)',
    );
    expect(caveats[0]).toContain("load state unknown");
    expect(caveats[0]).not.toContain("were not applied");
    expect(caveats[0]).not.toContain("names are analysis-generated");
  },
);

it.each([true, false, null])(
  "uses reported PDB observations once with loaded = %s",
  (loaded) => {
    const pdb = {
      file: "public.pdb",
      guid: "{01234567-89AB-CDEF-0123-456789ABCDEF}",
      age: "0X000A",
      signature: null,
      version: "RSDS",
      loaded,
    };
    const caveats = ghidraPePdbLimitations(target, pdb);
    expect(caveats).toEqual(ghidraPdbLimitations(pdb));
    expect(caveats).toHaveLength(1);
    expect(caveats.join(" ")).not.toContain('PDB "public.pdb"');
  },
);

it.each([
  { file: "different.pdb", guid: "0123456789abcdef0123456789abcdef", age: "a" },
  { file: "public.pdb", guid: "1123456789abcdef0123456789abcdef", age: "a" },
  { file: "public.pdb", guid: "0123456789abcdef0123456789abcdef", age: "10" },
  { file: "public.pdb", guid: "unrecognized-guid", age: "a" },
  { file: "public.pdb", guid: "0123456789abcdef0123456789abcdef", age: "ten" },
])("retains non-equivalent declared PDB identity for %j", (identity) => {
  for (const loaded of [false, null, true]) {
    const pdb = { ...absentAttributes, ...identity, version: "RSDS", loaded };
    const caveats = ghidraPePdbLimitations(target, pdb);
    expect(caveats[0]).toBe(ghidraPdbLimitations(pdb)[0]);
    expect(caveats[0]).toContain(identity.file);
    expect(caveats[0]).toContain(identity.guid);
    expect(caveats[0]).toContain(`age (hex) ${identity.age}`);
    expect(caveats).toHaveLength(2);
    expect(caveats[1]).toContain('PDB "public.pdb"');
    expect(caveats[1]).toContain("01234567-89ab-cdef-0123-456789abcdef");
    expect(caveats[1]).toContain("age (decimal) 10");
    expect(caveats[1]).toContain("equivalence is not established");
    expect(pdb).toMatchObject({ ...identity, loaded });
  }
});

it.each([
  "0123456789ABCDEF0123456789ABCDEF",
  "01234567-89ab-cdef-0123-456789abcdef",
])("avoids duplicate identity for normalized matching GUID %s", (guid) => {
  const pdb = { ...absentAttributes, file: "public.pdb", guid, age: "a" };
  expect(ghidraPePdbLimitations(target, pdb)).toEqual(
    ghidraPdbLimitations(pdb),
  );
});

it("retains explicit failure to load without asserting all names are generated", () => {
  const caveats = ghidraPePdbLimitations(target, {
    ...absentAttributes,
    loaded: false,
  });
  expect(caveats[0]).toContain("reports not loaded");
  expect(caveats[0]).not.toContain("names are analysis-generated");
});

it("retains a loaded-state attestation caveat even when reference attributes are absent", () => {
  const caveats = ghidraPePdbLimitations(target, {
    ...absentAttributes,
    loaded: true,
  });
  expect(caveats[0]).toEqual(
    ghidraPdbLimitations({ ...absentAttributes, loaded: true })[0],
  );
  expect(caveats).toHaveLength(2);
  expect(caveats[1]).toContain('PDB "public.pdb"');
  expect(caveats[0]).toContain("not an independent PDB identity");
  expect(caveats[0]).not.toContain("reports not loaded");
});

it("preserves omitted-attribute resource coverage with declared fallback identity", () => {
  const pdb: GhidraSessionInfo["pdb"] = {
    ...absentAttributes,
    resource_limit: { omitted_attributes: ["file"], utf16_budget: 4096 },
  };
  const caveats = ghidraPePdbLimitations(target, pdb);
  expect(caveats).toHaveLength(2);
  expect(caveats[0]).toContain("omitted");
  expect(caveats[1]).toContain("public.pdb");
});

it("reports NB10 declared age without inventing a GUID", () => {
  const caveats = ghidraPePdbLimitations(
    {
      ...target,
      codeView: {
        pdbPath: "legacy.pdb",
        pdbFileName: "legacy.pdb",
        guid: null,
        age: 2,
      },
    },
    undefined,
  );
  expect(caveats[0]).toContain('PDB "legacy.pdb" (age (decimal) 2)');
  expect(caveats[0]).not.toContain("GUID");
});

it.each([false, null, true])(
  "keeps an omitted NB10 GUID unknown with loaded = %s",
  (loaded) => {
    const pdbPath = "a".repeat(4070) + "\\legacy.pdb";
    const legacy = {
      ...target,
      codeView: {
        pdbPath,
        pdbFileName: "legacy.pdb",
        guid: null,
        age: 2,
      },
    };
    const pdb = {
      ...absentAttributes,
      file: pdbPath,
      age: "2",
      signature: "01234567",
      version: "NB10",
      loaded,
    };
    expect(ghidraPePdbLimitations(legacy, pdb)).toEqual(
      ghidraPdbLimitations(pdb),
    );
    const omitted: GhidraSessionInfo["pdb"] = {
      ...pdb,
      resource_limit: { omitted_attributes: ["guid"], utf16_budget: 4096 },
    };
    const caveats = ghidraPePdbLimitations(legacy, omitted);
    expect(caveats).toEqual([
      ...ghidraPdbLimitations(omitted),
      expect.stringContaining('PDB "legacy.pdb" (age (decimal) 2)'),
    ]);
    expect(caveats.at(-1)).toContain("equivalence is not established");
  },
);

it.each(["signature", "version"] as const)(
  "keeps matching NB10 identity when only %s is omitted",
  (attribute) => {
    const legacy = {
      ...target,
      codeView: {
        pdbPath: "legacy.pdb",
        pdbFileName: "legacy.pdb",
        guid: null,
        age: 2,
      },
    };
    const pdb: GhidraSessionInfo["pdb"] = {
      ...absentAttributes,
      file: "legacy.pdb",
      age: "2",
      resource_limit: { omitted_attributes: [attribute], utf16_budget: 4096 },
    };
    expect(ghidraPePdbLimitations(legacy, pdb)).toEqual(
      ghidraPdbLimitations(pdb),
    );
  },
);

it("retains missing-report uncertainty without a declared CodeView record", () => {
  const { codeView: _, ...withoutReference } = target;
  expect(ghidraPePdbLimitations(withoutReference, undefined)).toEqual(
    ghidraPdbLimitations(undefined),
  );
});

it("adds no PDB warning for a non-PE target", () => {
  const elf: BinaryTarget = {
    path: "/fixture/program",
    sha256: "a".repeat(64),
    kind: "executable",
    format: "elf",
    architecture: "x86_64",
    availableArchitectures: ["x86_64"],
  };
  expect(ghidraPePdbLimitations(elf, undefined)).toEqual([]);
});

it("bounds an escaped inline locator while preserving its declared source value", () => {
  const name = '"'.repeat(5000) + ".pdb";
  const selected = {
    ...target,
    codeView: { ...target.codeView!, pdbFileName: name },
  };
  const caveats = ghidraPePdbLimitations(selected, undefined).join(" ");
  expect(Buffer.byteLength(caveats)).toBeLessThan(1024);
  expect(caveats).toContain("locator omitted");
  expect(caveats).toContain("01234567-89ab-cdef-0123-456789abcdef");
  expect(selected.codeView.pdbFileName).toBe(name);
});

it.each([
  ["long ASCII", "a".repeat(171)],
  ["ASCII at the byte budget", "a".repeat(1022)],
  ["ASCII beyond the byte budget", "a".repeat(1023)],
  ["quotes at the byte budget", '"'.repeat(511)],
  ["quotes beyond the byte budget", '"'.repeat(512)],
  ["short control escapes", "\n".repeat(511)],
  ["short control escapes beyond the byte budget", "\n".repeat(512)],
  ["six-byte control escapes", "\u0001".repeat(170)],
  ["six-byte control escapes beyond the byte budget", "\u0001".repeat(171)],
  ["UTF-8 BMP text", "中".repeat(340)],
  ["UTF-8 BMP text beyond the byte budget", "中".repeat(341)],
  ["surrogate pairs", "😀".repeat(255)],
  ["surrogate pairs beyond the byte budget", "😀".repeat(256)],
  ["unpaired high surrogates", "\ud800".repeat(170)],
  ["unpaired high surrogates beyond the byte budget", "\ud800".repeat(171)],
  ["unpaired low surrogates", "\udfff".repeat(170)],
  ["unpaired low surrogates beyond the byte budget", "\udfff".repeat(171)],
])("uses actual JSON UTF-8 size for %s", (_, name) => {
  const selected = {
    ...target,
    codeView: { ...target.codeView!, pdbFileName: name },
  };
  const caveat = ghidraPePdbLimitations(selected, undefined).join(" ");
  const encoded = JSON.stringify(name);
  if (Buffer.byteLength(encoded) <= 1024) {
    expect(caveat).toContain(`PDB ${encoded} (`);
    expect(caveat).not.toContain("locator omitted");
  } else {
    expect(caveat).toContain("locator omitted");
    expect(caveat).not.toContain(encoded);
  }
  expect(selected.codeView.pdbFileName).toBe(name);
});
