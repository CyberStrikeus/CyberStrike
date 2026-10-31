import { describe, expect, it } from "vitest";
import {
  inspectRecordedCrashInputSchema,
  recordedCrashSchema,
  type RecordedCrash,
} from "./recordedCrash.js";
import {
  recordedCrashFixture,
  recordedCrashSignalFixture,
} from "../../../tests/fixtures/binaryDiagnostics/recordedCrash.js";

it("preserves high uint64 registers and historical thread identity", () => {
  const value = recordedCrashSchema.parse(recordedCrashFixture());
  expect(
    value.threads[0]?.registers.find(({ name }) => name === "rdi")?.value,
  ).toBe("0x1122334455667788");
  expect(value.live_process_identity).toBe("unknown");
  expect(
    inspectRecordedCrashInputSchema.parse({ path: "/selected.core" })
      .include_debugger_context,
  ).toBe(false);
});

it("preserves a short zero-filled note-segment tail", () => {
  const value = recordedCrashSignalFixture();
  value.segments = value.segments.map((segment) => ({
    ...segment,
    file_size: "0x19b",
  }));
  value.note_padding.push({
    segment_index: 0,
    location: { offset: "0x218", bytes: "0x3" },
    bytes_base64: "AAAA",
  });
  expect(recordedCrashSchema.safeParse(value).success).toBe(true);
});

it.each([
  "missing-thread",
  "duplicate-thread",
  "missing-signal",
  "duplicate-signal",
  "missing-register",
  "unknown-register",
  "duplicated-physical-thread",
  "duplicated-physical-signal",
  "omitted-physical-note",
  "expanded-note-span",
  "forged-padding",
])("rejects an incomplete or duplicate interpretation: %s", (scenario) => {
  const value = recordedCrashSignalFixture();
  if (
    scenario === "duplicated-physical-thread" ||
    scenario === "duplicated-physical-signal"
  ) {
    const noteIndex = scenario === "duplicated-physical-thread" ? 0 : 1;
    const note = value.notes[noteIndex];
    if (note === undefined) throw new Error("missing fixture note");
    value.notes.push({ ...note, index: 2 });
    if (noteIndex === 0)
      value.threads.push(
        ...value.threads.map((thread) => ({ ...thread, note_index: 2 })),
      );
    else
      value.signals.push(
        ...value.signals.map((signal) => ({ ...signal, note_index: 2 })),
      );
  }
  if (
    ["omitted-physical-note", "expanded-note-span", "forged-padding"].includes(
      scenario,
    )
  ) {
    value.notes = value.notes.filter((note) => note.index === 0);
    value.signals = [];
  }
  if (scenario === "expanded-note-span")
    value.notes = value.notes.map((note) => ({
      ...note,
      location: { ...note.location, bytes: "0x198" },
    }));
  if (scenario === "forged-padding")
    value.note_padding.push({
      segment_index: 0,
      location: { offset: "0x1e4", bytes: "0x34" },
      bytes_base64: Buffer.alloc(52).toString("base64"),
    });
  if (scenario === "missing-thread") value.threads = [];
  if (scenario === "duplicate-thread")
    value.threads = [...value.threads, ...value.threads];
  if (scenario === "missing-signal") value.signals = [];
  if (scenario === "duplicate-signal")
    value.signals = [...value.signals, ...value.signals];
  if (scenario === "missing-register")
    value.threads = value.threads.map((thread) => ({
      ...thread,
      registers: thread.registers.slice(1),
    }));
  if (scenario === "unknown-register")
    value.threads = value.threads.map((thread) => ({
      ...thread,
      registers: thread.registers.map((register) =>
        register.name === "rdi"
          ? { ...register, name: "unrecognized" }
          : register,
      ),
    }));
  expect(recordedCrashSchema.safeParse(value).success).toBe(false);
});

it.each([
  [
    "unsafe register number",
    (v: ReturnType<typeof recordedCrashFixture>) => ({
      ...v,
      threads: [
        {
          ...v.threads[0],
          registers: [
            {
              name: "rdi",
              value: 9007199254740992,
              location: { offset: "0x104", bytes: "0x8" },
            },
          ],
        },
      ],
    }),
  ],
  [
    "source outside artifact",
    (v: ReturnType<typeof recordedCrashFixture>) => ({
      ...v,
      artifact: { ...v.artifact, bytes: 120 },
    }),
  ],
  [
    "invalid note reference",
    (v: ReturnType<typeof recordedCrashFixture>) => ({
      ...v,
      threads: [{ ...v.threads[0], note_index: 1 }],
    }),
  ],
  [
    "register outside descriptor",
    (v: ReturnType<typeof recordedCrashFixture>) => ({
      ...v,
      threads: [
        {
          ...v.threads[0],
          registers: [
            {
              name: "rdi",
              value: "0x0",
              location: { offset: "0x1e4", bytes: "0x8" },
            },
          ],
        },
      ],
    }),
  ],
  [
    "raw descriptor length",
    (v: ReturnType<typeof recordedCrashFixture>) => ({
      ...v,
      notes: v.notes.map((n) => ({ ...n, descriptor_bytes_base64: "AA==" })),
    }),
  ],
  [
    "different owner ABI",
    (v: ReturnType<typeof recordedCrashFixture>) => ({
      ...v,
      notes: v.notes.map((n) => ({ ...n, owner_display: "OTHER" })),
    }),
  ],
  [
    "raw owner ABI hidden by a CORE display label",
    (v: ReturnType<typeof recordedCrashFixture>) => ({
      ...v,
      notes: v.notes.map((n) => ({
        ...n,
        owner_bytes_base64: Buffer.from("EVIL\0").toString("base64"),
      })),
    }),
  ],
  [
    "duplicate register",
    (v: ReturnType<typeof recordedCrashFixture>) => ({
      ...v,
      threads: v.threads.map((t) => ({
        ...t,
        registers: [...t.registers, ...t.registers],
      })),
    }),
  ],
] as const)("rejects %s before Evidence serialization", (_name, change) =>
  expect(
    recordedCrashSchema.safeParse(change(recordedCrashFixture())).success,
  ).toBe(false),
);

it("does not interpret a signal through a mislabeled raw owner ABI", () => {
  const value = recordedCrashFixture();
  expect(
    recordedCrashSchema.safeParse({
      ...value,
      threads: [],
      notes: value.notes.map((note) => ({
        ...note,
        type: "NT_SIGINFO",
        type_id: 0x53494749,
        owner_bytes_base64: Buffer.from("EVIL\0").toString("base64"),
      })),
      signals: [
        {
          note_index: 0,
          number: 11,
          code: 1,
          errno: 0,
          fault_address: "0x123",
          fault_address_meaning: "recorded-sigsegv-address",
          thread_association: "unknown",
        },
      ],
    }).success,
  ).toBe(false);
});

it("keeps absent map flags unknown and validates reported permission bits", () => {
  const value = recordedCrashFixture();
  const context = {
    status: "available",
    gdb_version: "fixture",
    pwndbg_version: "fixture",
    connection: "core",
    executable: null,
    historical_pid: 123,
    reported_limits: {
      address_space_bytes: 3221225472,
      cpu_seconds: 30,
      file_size_bytes: 67108864,
    },
    maps: [
      {
        start: "0x1000",
        end: "0x2000",
        offset: "0x0",
        reported_flags: 0,
        permissions: null,
        pathname_display: "recorded pathname",
        current_file_identity: "unknown",
      },
    ],
    confidence: "derived",
    completeness: "unknown",
    diagnostics: value.diagnostics,
  } as const;
  expect(
    recordedCrashSchema.safeParse({ ...value, debugger: context }).success,
  ).toBe(true);
  expect(
    recordedCrashSchema.safeParse({
      ...value,
      debugger: {
        ...context,
        maps: context.maps.map((m) => ({
          ...m,
          permissions: { read: false, write: false, execute: false },
        })),
      },
    }).success,
  ).toBe(false);
  expect(
    recordedCrashSchema.safeParse({
      ...value,
      debugger: {
        ...context,
        maps: context.maps.map((m) => ({
          ...m,
          reported_flags: 4,
          permissions: { read: false, write: false, execute: false },
        })),
      },
    }).success,
  ).toBe(false);
});

describe("recorded AArch64 core profile", () => {
  it("accepts the complete AArch64 register window in ABI order", () => {
    const value = recordedCrashSchema.parse(
      recordedCrashFixture("/selected/aarch64.core", "aarch64-little-endian"),
    );
    expect(value.architecture).toBe("aarch64-little-endian");
    const registers = value.threads[0]?.registers ?? [];
    expect(registers.map(({ name }) => name)).toEqual([
      ...Array.from({ length: 31 }, (_, index) => `x${String(index)}`),
      "sp",
      "pc",
      "pstate",
    ]);
    expect(registers[14]?.value).toBe("0x1122334455667788");
    expect(registers.every(({ location }) => location.bytes === "0x8")).toBe(
      true,
    );
  });

  it("keeps the AArch64 note ranges inside their recorded segment", () => {
    const value = recordedCrashSchema.parse(
      recordedCrashSignalFixture(undefined, "aarch64-little-endian"),
    );
    const note = value.notes[0];
    const segment = value.segments[0];
    if (note === undefined || segment === undefined)
      throw new Error("Expected recorded notes");
    expect(
      BigInt(note.location.offset) + BigInt(note.location.bytes),
    ).toBeLessThanOrEqual(BigInt(segment.offset) + BigInt(segment.file_size));
    expect(value.signals[0]?.fault_address).toBe("0x1122334455667788");
  });

  it.each([
    [
      "an amd64 register name inside an AArch64 window",
      (v: RecordedCrash) => ({
        ...v,
        threads: v.threads.map((thread) => ({
          ...thread,
          registers: thread.registers.map((register, index) =>
            index === 0 ? { ...register, name: "rax" } : register,
          ),
        })),
      }),
    ],
    [
      "the amd64 register count",
      (v: RecordedCrash) => ({
        ...v,
        threads: v.threads.map((thread) => ({
          ...thread,
          registers: thread.registers.slice(0, 27),
        })),
      }),
    ],
    [
      "a 4-byte AArch64 register source",
      (v: RecordedCrash) => ({
        ...v,
        threads: v.threads.map((thread) => ({
          ...thread,
          registers: thread.registers.map((register, index) =>
            index === 0
              ? {
                  ...register,
                  location: { ...register.location, bytes: "0x4" },
                }
              : register,
          ),
        })),
      }),
    ],
  ] as const)("rejects %s", (_name, change) => {
    const value = recordedCrashFixture(
      "/selected/aarch64.core",
      "aarch64-little-endian",
    );
    expect(recordedCrashSchema.safeParse(change(value)).success).toBe(false);
  });

  it("rejects an architecture outside the interpreted profiles", () => {
    const value = recordedCrashFixture();
    expect(
      recordedCrashSchema.safeParse({
        ...value,
        architecture: "arm-little-endian",
      }).success,
    ).toBe(false);
  });
});
