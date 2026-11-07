import { z } from "zod";

import type { BinaryArchitecture } from "../binaryTargetTypes.js";
import { pwntoolsTimeoutField } from "./nativeDeadlines.js";
import { absoluteLocalPathStringSchema } from "../localPath.js";
import { canonicalBase64Schema } from "../stringPatterns.js";
import { recordedNoteCoverageIssues } from "./recordedCrashNoteCoverage.js";

const hex = z.string().regex(/^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/);
const index = z.int().nonnegative();
const signed32 = z.int().min(-2147483648).max(2147483647);
const base64 = canonicalBase64Schema;
const range = z.strictObject({ offset: hex, bytes: hex });
const diagnostics = z.strictObject({
  stdout: z.string(),
  stderr: z.string(),
  truncated: z.boolean(),
});
// Exact b"CORE\0"; a lossy display label cannot establish the Linux note ABI.
const LINUX_CORE_OWNER_BASE64 = "Q09SRQA=";

/** Source identity controls interpretation; decoder labels are display facts. */
export const isLinuxCoreNote = (
  note:
    | { readonly owner_bytes_base64: string; readonly type_id: number }
    | undefined,
  type: number,
): boolean =>
  note?.owner_bytes_base64 === LINUX_CORE_OWNER_BASE64 && note.type_id === type;

/** Complete register identities in the supported Linux amd64 PRSTATUS ABI order. */
const RECORDED_LINUX_AMD64_REGISTERS: readonly string[] = [
  "r15",
  "r14",
  "r13",
  "r12",
  "rbp",
  "rbx",
  "r11",
  "r10",
  "r9",
  "r8",
  "rax",
  "rcx",
  "rdx",
  "rsi",
  "rdi",
  "orig_rax",
  "rip",
  "cs",
  "eflags",
  "rsp",
  "ss",
  "fs_base",
  "gs_base",
  "ds",
  "es",
  "fs",
  "gs",
];
const RECORDED_LINUX_AARCH64_REGISTERS: readonly string[] = [
  "x0",
  "x1",
  "x2",
  "x3",
  "x4",
  "x5",
  "x6",
  "x7",
  "x8",
  "x9",
  "x10",
  "x11",
  "x12",
  "x13",
  "x14",
  "x15",
  "x16",
  "x17",
  "x18",
  "x19",
  "x20",
  "x21",
  "x22",
  "x23",
  "x24",
  "x25",
  "x26",
  "x27",
  "x28",
  "x29",
  "x30",
  "sp",
  "pc",
  "pstate",
];

/** Recorded-core architectures whose Linux note ABI is interpreted. */
export const RECORDED_LINUX_CORE_ARCHITECTURES = [
  "x86_64-little-endian",
  "aarch64-little-endian",
] as const;

export type RecordedCrashArchitecture =
  (typeof RECORDED_LINUX_CORE_ARCHITECTURES)[number];

/**
 * ABI facts for one recorded-core architecture, measured from unchanged pwntools
 * 4.15.0 `elf_prstatus_*` and `user_regs_struct_*` structures and mirrored by
 * `bridge/pwntools/recorded_crash_impl.py`. Both profiles place `pr_cursig` at
 * 12, `pr_pid` at 32 and the register window at 112; the ELF machine, the window
 * contents and the Evidence CPU family differ per profile.
 */
export const RECORDED_LINUX_CORE_PROFILES: Record<
  RecordedCrashArchitecture,
  {
    readonly machine: number;
    readonly evidenceArchitecture: BinaryArchitecture;
    readonly registers: readonly string[];
    readonly registerBytes: number;
    readonly registerOffset: number;
    readonly prstatusBytes: number;
  }
> = {
  "x86_64-little-endian": {
    machine: 62,
    evidenceArchitecture: "x86_64",
    registers: RECORDED_LINUX_AMD64_REGISTERS,
    registerBytes: 8,
    registerOffset: 112,
    prstatusBytes: 336,
  },
  "aarch64-little-endian": {
    machine: 183,
    evidenceArchitecture: "arm64",
    registers: RECORDED_LINUX_AARCH64_REGISTERS,
    registerBytes: 8,
    registerOffset: 112,
    prstatusBytes: 392,
  },
};

const recordedCoreRegisterSets: Record<
  RecordedCrashArchitecture,
  ReadonlySet<string>
> = {
  "x86_64-little-endian": new Set(RECORDED_LINUX_AMD64_REGISTERS),
  "aarch64-little-endian": new Set(RECORDED_LINUX_AARCH64_REGISTERS),
};

/** Select an explicit recording and optionally request debugger-derived mapping context. */
export const inspectRecordedCrashInputSchema = z.strictObject({
  path: absoluteLocalPathStringSchema.describe(
    "Absolute filesystem path to a supplied Linux ELF core",
  ),
  include_debugger_context: z
    .boolean()
    .default(false)
    .describe(
      "Add core-only mapping candidates through caller-supplied GDB/pwndbg",
    ),
  pwntools_timeout_ms: pwntoolsTimeoutField,
});

/** Debugger map candidates preserve reported flags; zero does not establish absent permissions. */
export const recordedCrashDebuggerSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("not-requested") }),
  z.strictObject({
    status: z.literal("available"),
    gdb_version: z.string().min(1),
    pwndbg_version: z.string().min(1),
    connection: z.literal("core"),
    executable: z.null(),
    historical_pid: signed32,
    reported_limits: z.strictObject({
      address_space_bytes: index,
      cpu_seconds: index,
      file_size_bytes: index,
    }),
    maps: z.array(
      z.strictObject({
        start: hex,
        end: hex,
        offset: hex,
        reported_flags: index,
        permissions: z
          .strictObject({
            read: z.boolean(),
            write: z.boolean(),
            execute: z.boolean(),
          })
          .nullable(),
        pathname_display: z.string(),
        current_file_identity: z.literal("unknown"),
      }),
    ),
    confidence: z.literal("derived"),
    completeness: z.literal("unknown"),
    diagnostics,
  }),
]);

/** Portable recorded observations; registers and source coordinates remain lossless. */
const recordedCrashObjectSchema = z.strictObject({
  artifact: z.strictObject({
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: index,
  }),
  format: z.literal("elf-core"),
  architecture: z.enum(RECORDED_LINUX_CORE_ARCHITECTURES),
  target_execution: z.literal("not-performed"),
  live_process_identity: z.literal("unknown"),
  segments: z.array(
    z.strictObject({
      index,
      type: z.union([z.string(), index]),
      type_id: index.max(0xffffffff),
      header_location: range,
      offset: hex,
      file_size: hex,
      memory_size: hex,
      virtual_address: hex,
      physical_address: hex,
      alignment: hex,
      flags: hex,
      file_backing: z.enum(["file", "none"]),
    }),
  ),
  notes: z.array(
    z.strictObject({
      index,
      segment_index: index,
      type: z.union([z.string(), index]),
      type_id: index.max(0xffffffff),
      location: range,
      owner_location: range,
      owner_bytes_base64: base64,
      owner_display: z.string().nullable(),
      descriptor_location: range,
      descriptor_bytes_base64: base64,
    }),
  ),
  note_padding: z.array(
    z.strictObject({
      segment_index: index,
      location: range,
      bytes_base64: base64,
    }),
  ),
  threads: z.array(
    z.strictObject({
      note_index: index,
      historical_pid: signed32,
      recorded_current_signal: z.int().min(-32768).max(32767),
      registers: z.array(
        z.strictObject({
          name: z.string().min(1),
          value: hex,
          location: range,
        }),
      ),
    }),
  ),
  signals: z.array(
    z.strictObject({
      note_index: index,
      number: signed32,
      code: signed32,
      errno: signed32,
      fault_address: hex.nullable(),
      fault_address_meaning: z.enum(["recorded-sigsegv-address", "unknown"]),
      thread_association: z.literal("unknown"),
    }),
  ),
  debugger: recordedCrashDebuggerSchema,
  note_interpretation_completeness: z.literal("unknown"),
  decoder_diagnostics: diagnostics,
  diagnostics,
  limitations: z.array(z.string()),
});

/** Provider payload excludes identity and diagnostics bound by the owned snapshot boundary. */
export const recordedCrashPayloadSchema = recordedCrashObjectSchema.omit({
  artifact: true,
  diagnostics: true,
  debugger: true,
  decoder_diagnostics: true,
});

/** Validate the next consumer's file ranges, note links and register representations. */
export const recordedCrashSchema = recordedCrashObjectSchema.superRefine(
  (value, context) => {
    const fail = (message: string) =>
      context.addIssue({ code: "custom", message });
    const within = (
      item: z.output<typeof range>,
      start = 0n,
      end = BigInt(value.artifact.bytes),
    ) => {
      const offset = BigInt(item.offset);
      const bytes = BigInt(item.bytes);
      return offset >= start && offset <= end && bytes <= end - offset;
    };
    for (const issue of recordedNoteCoverageIssues(
      value.segments,
      value.notes,
      value.note_padding,
    ))
      fail(issue);
    for (const [position, segment] of value.segments.entries()) {
      if (typeof segment.type === "number" && segment.type !== segment.type_id)
        fail("Numeric segment type differs from its source identity.");
      if (position !== segment.index || !within(segment.header_location))
        fail("Invalid original segment identity or header range.");
      if (
        segment.file_backing === "file" &&
        !within({ offset: segment.offset, bytes: segment.file_size })
      )
        fail("Recorded segment exceeds artifact bytes.");
      if (
        segment.type_id === 1 &&
        BigInt(segment.file_size) > BigInt(segment.memory_size)
      )
        fail("Recorded PT_LOAD file size exceeds memory size.");
    }
    for (const [position, note] of value.notes.entries()) {
      const segment = value.segments[note.segment_index];
      if (position !== note.index || segment?.type_id !== 4) {
        fail("Invalid original note identity or segment reference.");
        continue;
      }
      const ownerBytes = Buffer.from(note.owner_bytes_base64, "base64");
      const terminator = ownerBytes.indexOf(0);
      const ownerDisplay =
        ownerBytes.length === 0
          ? null
          : ownerBytes.subarray(0, terminator).toString("utf8");
      if (
        (ownerBytes.length > 0 && terminator < 0) ||
        note.owner_display !== ownerDisplay
      )
        fail("Note owner display differs from its retained bytes.");
      if (typeof note.type === "number" && note.type !== note.type_id)
        fail("Numeric note type differs from its source identity.");
      if (
        note.owner_bytes_base64 !== LINUX_CORE_OWNER_BASE64 &&
        note.type !== note.type_id
      )
        fail(
          "Uninterpreted note owners must retain their numeric type identity.",
        );
      if (
        BigInt(ownerBytes.length) !== BigInt(note.owner_location.bytes) ||
        BigInt(Buffer.byteLength(note.descriptor_bytes_base64, "base64")) !==
          BigInt(note.descriptor_location.bytes)
      )
        fail("Raw note lengths differ from their source ranges.");
      const start = BigInt(segment.offset);
      const end = start + BigInt(segment.file_size);
      if (
        !within(note.location, start, end) ||
        !within(
          note.owner_location,
          BigInt(note.location.offset),
          BigInt(note.location.offset) + BigInt(note.location.bytes),
        ) ||
        !within(
          note.descriptor_location,
          BigInt(note.location.offset),
          BigInt(note.location.offset) + BigInt(note.location.bytes),
        )
      )
        fail("Note source ranges exceed their recorded segment.");
    }
    for (const padding of value.note_padding) {
      const segment = value.segments[padding.segment_index];
      if (
        segment?.type_id !== 4 ||
        !within(
          padding.location,
          BigInt(segment.offset),
          BigInt(segment.offset) + BigInt(segment.file_size),
        )
      )
        fail("Invalid recorded note padding range.");
    }
    for (const [kind, rows] of [
      [1, value.threads],
      [0x53494749, value.signals],
    ] as const) {
      const matchingNotes = value.notes.filter((note) =>
        isLinuxCoreNote(note, kind),
      );
      if (
        rows.length !== matchingNotes.length ||
        new Set(rows.map(({ note_index }) => note_index)).size !== rows.length
      )
        fail(
          "Each supported raw note requires exactly one corresponding interpretation.",
        );
    }
    const profile = RECORDED_LINUX_CORE_PROFILES[value.architecture];
    const profileRegisters = recordedCoreRegisterSets[value.architecture];
    for (const thread of value.threads) {
      const note = value.notes[thread.note_index];
      if (note === undefined || !isLinuxCoreNote(note, 1)) {
        fail("Thread references a different note kind.");
        continue;
      }
      if (
        thread.registers.length !== profile.registers.length ||
        !thread.registers.every(({ name }) => profileRegisters.has(name)) ||
        new Set(thread.registers.map(({ name }) => name)).size !==
          thread.registers.length
      )
        fail(
          "Each recorded thread requires every supported register exactly once.",
        );
      for (const register of thread.registers)
        if (
          BigInt(register.location.bytes) !== BigInt(profile.registerBytes) ||
          !within(
            register.location,
            BigInt(note.descriptor_location.offset),
            BigInt(note.descriptor_location.offset) +
              BigInt(note.descriptor_location.bytes),
          )
        )
          fail("Register source exceeds its descriptor.");
    }
    for (const signal of value.signals) {
      if (!isLinuxCoreNote(value.notes[signal.note_index], 0x53494749))
        fail("Signal references a different note kind.");
      const known =
        signal.number === 11 && (signal.code === 1 || signal.code === 2);
      if (
        known !== (signal.fault_address !== null) ||
        (signal.fault_address !== null) !==
          (signal.fault_address_meaning === "recorded-sigsegv-address")
      )
        fail("Signal union meaning does not match recorded SIGSEGV code.");
    }
    if (value.debugger.status === "available")
      for (const map of value.debugger.maps) {
        if (BigInt(map.end) < BigInt(map.start))
          fail("Debugger mapping end precedes its start.");
        if (
          map.permissions !== null &&
          (map.permissions.read !== Boolean(map.reported_flags & 4) ||
            map.permissions.write !== Boolean(map.reported_flags & 2) ||
            map.permissions.execute !== Boolean(map.reported_flags & 1))
        )
          fail("Mapping permissions differ from reported flags.");
        if (
          (map.reported_flags === 0 || map.reported_flags > 7) !==
          (map.permissions === null)
        )
          fail(
            "Unreported or unfamiliar map flags require unknown permissions.",
          );
      }
  },
);

export type InspectRecordedCrashInput = z.output<
  typeof inspectRecordedCrashInputSchema
>;
export type RecordedCrash = z.output<typeof recordedCrashSchema>;

/** Validated basic core evidence retained when requested debugger enrichment fails. */
export type RecordedCrashPartialObservation = Omit<
  RecordedCrash,
  "debugger"
> & {
  readonly debugger: {
    readonly status: "unavailable";
    readonly requested: true;
  };
};
