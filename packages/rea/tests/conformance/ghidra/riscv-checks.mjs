import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

/**
 * The ilp32 storage of each function in tests/conformance/c/riscv-float-abi.c,
 * as Ghidra prints it, with the words `rea_riscv_abi_caller`'s call site puts
 * there. Ghidra joins a register pair most-significant word first. A word is
 * an unsigned 32-bit value, "frame" for the address of a caller local, or
 * `{ frame: [...] }` for such an address whose memory holds those words. A
 * literal is how the typed caller's pseudocode should print the argument.
 */
export const RISCV_ILP32_ABI = {
  rea_riscv_abi_pick: {
    return: ["float", "a0:4"],
    parameters: [
      ["a", "float", "a0:4", { a0: 0x3fc00000 }, "1.5"],
      ["b", "float", "a1:4", { a1: 0x40200000 }, "2.5"],
      ["sel", "int", "a2:4"],
    ],
  },
  rea_riscv_abi_wide: {
    return: ["double", "a1:4,a0:4"],
    parameters: [
      ["a", "double", "a1:4,a0:4", { a1: 0x400a0000, a0: 0 }, "3.25"],
      ["sel", "int", "a2:4"],
    ],
  },
  // A named double needs no aligned pair, so d starts in a1.
  rea_riscv_abi_mixed: {
    return: ["double", "a1:4,a0:4"],
    parameters: [
      ["i", "int", "a0:4"],
      ["d", "double", "a2:4,a1:4", { a2: 0x40130000, a1: 0 }, "4.75"],
      ["f", "float", "a3:4", { a3: 0x40b00000 }, "5.5"],
      ["e", "double", "a5:4,a4:4", { a5: 0x40188000, a4: 0 }, "6.125"],
    ],
  },
  // Only a7 is left for x: its low word goes there, its high word on the stack.
  rea_riscv_abi_split: {
    return: ["double", "a1:4,a0:4"],
    parameters: [
      ["a", "int", "a0:4", { a0: 1 }, "1"],
      ["b", "int", "a1:4", { a1: 2 }, "2"],
      ["c", "int", "a2:4", { a2: 3 }, "3"],
      ["d", "int", "a3:4", { a3: 4 }, "4"],
      ["e", "int", "a4:4", { a4: 5 }, "5"],
      ["f", "int", "a5:4", { a5: 6 }, "6"],
      ["g", "int", "a6:4"],
      [
        "x",
        "double",
        "Stack[0x0]:4,a7:4",
        { "Stack[0x0]": 0x401d0000, a7: 0 },
        "7.25",
      ],
    ],
  },
  // Two floats in 8 bytes: an integer pair, not fa0 and fa1.
  rea_riscv_abi_pair: {
    return: ["rea_riscv_abi_pair", "a1:4,a0:4"],
    parameters: [
      [
        "value",
        "rea_riscv_abi_pair",
        "a1:4,a0:4",
        { a1: 0x41180000, a0: 0x41080000 },
        "(rea_riscv_abi_pair)0x4118000041080000",
      ],
      ["scale", "float", "a2:4", { a2: 0x41280000 }, "10.5"],
    ],
  },
  rea_riscv_abi_tagged: {
    return: ["rea_riscv_abi_tagged", "a1:4,a0:4"],
    parameters: [
      [
        "value",
        "rea_riscv_abi_tagged",
        "a1:4,a0:4",
        { a1: 12, a0: 0x41380000 },
        "(rea_riscv_abi_tagged)0xc41380000",
      ],
      ["tag", "int", "a2:4"],
    ],
  },
  // Over 8 bytes: passed and returned through caller-allocated memory.
  rea_riscv_abi_large: {
    return: ["rea_riscv_abi_large *", "a0:4"],
    parameters: [
      [
        "__return_storage_ptr__",
        "rea_riscv_abi_large *",
        "a0:4 (auto)",
        { a0: "frame" },
      ],
      [
        "value",
        "rea_riscv_abi_large *",
        "a1:4",
        { a1: { frame: [0, 0x402b0000, 0, 0x402d0000, 0x41780000] } },
      ],
      ["scale", "float", "a2:4", { a2: 0x41840000 }, "16.5"],
    ],
  },
  // A long double is 16 bytes: passed and returned through caller memory too.
  rea_riscv_abi_quad: {
    return: ["long double *", "a0:4"],
    parameters: [
      [
        "__return_storage_ptr__",
        "long double *",
        "a0:4 (auto)",
        { a0: "frame" },
      ],
      [
        "value",
        "long double *",
        "a1:4",
        { a1: { frame: [0, 0, 0, 0x40036800] } },
      ],
      ["sel", "int", "a2:4"],
    ],
  },
  // Variadic doubles take aligned pairs, a2:a3 and a6:a7, so a1 and a5 are
  // skipped; the last int follows on the stack. Ghidra does not type them.
  rea_riscv_abi_variadic: {
    return: ["uint", "a0:4"],
    parameters: [["count", "int", "a0:4", { a0: 2 }, "2"]],
    variadic: {
      a2: 0,
      a3: 0x40318000,
      a6: 0,
      a7: 0x40328000,
      "Stack[0x0]": 19,
    },
  },
};

/** The indirect call through the typed pointer `rea_riscv_abi_callback`. */
export const RISCV_ILP32_CALLBACK = {
  words: { a0: 0x41a40000, a1: 0x41ac0000 },
  literals: ["20.5", "21.5"],
};

const LOCATION_ORDER = [
  "a0",
  "a1",
  "a2",
  "a3",
  "a4",
  "a5",
  "a6",
  "a7",
  "Stack[0x0]",
];
const FLOAT_REGISTER = /\bf[ast]\d+\b/u;

/** Locations named by a Ghidra storage string, such as `Stack[0x0]:4,a7:4`. */
export function riscvStorageLocations(storage) {
  return storage
    .replace(/ \(auto\)$/u, "")
    .split(",")
    .map((piece) => {
      const match = /^(.+):\d+$/u.exec(piece);
      assert.ok(match !== null, `Unexpected storage ${storage}`);
      return match[1];
    });
}

const ordered = (locations) =>
  [...locations].sort(
    (left, right) =>
      LOCATION_ORDER.indexOf(left) - LOCATION_ORDER.indexOf(right),
  );

/** How the decompiler prints a call-site word: small values in decimal. */
const printed = (word) =>
  typeof word !== "number"
    ? undefined
    : word < 10
      ? String(word)
      : `0x${word.toString(16)}`;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
// Any argument the table does not pin, including one with a cast.
const WILDCARD = "(?:\\([^()]*\\))?[^,()]+";

/** Every call site word sits where the function's storage says it does. */
export function assertRiscvIlp32TableConsistent() {
  for (const [name, { parameters }] of Object.entries(RISCV_ILP32_ABI))
    for (const [parameter, , storage, words] of parameters)
      if (words !== undefined)
        assert.deepEqual(
          ordered(Object.keys(words)),
          ordered(riscvStorageLocations(storage)),
          `${name}(${parameter}) words and storage disagree`,
        );
}

/**
 * Reconstruct the argument words each call in an `llvm-objdump` listing of
 * `rea_riscv_abi_caller` writes. It interprets only the instructions that
 * Clang -O0 uses to set up arguments; any other write leaves the register
 * unknown. Stack addresses are offsets from the caller's incoming `sp`.
 */
export function parseRiscvCallSites(listing) {
  const registers = new Map([
    ["zero", { word: 0 }],
    ["sp", { stack: 0 }],
  ]);
  const memory = new Map();
  let written = new Set();
  const calls = [];
  const immediate = (text) => {
    const value = Number.parseInt(
      text,
      text.replace(/^-/u, "").startsWith("0x") ? 16 : 10,
    );
    assert.ok(Number.isSafeInteger(value), `Unexpected immediate ${text}`);
    return value;
  };
  const address = (operand) => {
    const match = /^(-?(?:0x)?[\da-f]+)\((\w+)\)$/u.exec(operand);
    assert.ok(match !== null, `Unexpected memory operand ${operand}`);
    const base = registers.get(match[2]);
    return base?.stack === undefined
      ? undefined
      : base.stack + immediate(match[1]);
  };
  const isRegister = (operand) =>
    /^(?:zero|ra|sp|gp|tp|t[0-6]|s(?:[0-9]|1[01])|a[0-7])$/u.test(
      operand ?? "",
    );
  const set = (register, value) => {
    if (register === "zero") return;
    if (value === undefined) registers.delete(register);
    else registers.set(register, value);
  };
  for (const line of listing.split("\n")) {
    const match = /^\s*[\da-f]+:\s+([a-z.]+)(?:\s+(.*))?$/u.exec(line);
    if (match === null) continue;
    const [, mnemonic, text = ""] = match;
    const operands = text
      .replace(/\s*<[^>]*>/u, "")
      .split(",")
      .map((operand) => operand.trim())
      .filter((operand) => operand.length > 0);
    if (
      (mnemonic === "jal" && operands[0] !== "zero") ||
      mnemonic === "jalr" ||
      mnemonic === "call"
    ) {
      const sp = registers.get("sp").stack;
      const words = {};
      for (const register of LOCATION_ORDER.slice(0, 8))
        words[register] = registers.get(register);
      for (const offset of written)
        if (offset >= sp)
          words[`Stack[0x${(offset - sp).toString(16)}]`] = memory.get(offset);
      calls.push({
        target: mnemonic === "jalr" ? "indirect" : /<([^>]+)>/u.exec(text)?.[1],
        words,
        memory: new Map(memory),
      });
      for (const register of [
        ...LOCATION_ORDER.slice(0, 8),
        "t0",
        "t1",
        "t2",
        "t3",
        "t4",
        "t5",
        "t6",
        "ra",
      ])
        registers.delete(register);
      written = new Set();
      continue;
    }
    const [target, source, third] = operands;
    switch (mnemonic) {
      case "lui":
        set(target, { word: (immediate(source) << 12) >>> 0 });
        break;
      case "li":
        set(target, { word: immediate(source) >>> 0 });
        break;
      case "mv":
        set(target, registers.get(source));
        break;
      case "addi": {
        const base = registers.get(source);
        set(
          target,
          base?.word !== undefined
            ? { word: (base.word + immediate(third)) >>> 0 }
            : base?.stack !== undefined
              ? { stack: base.stack + immediate(third) }
              : undefined,
        );
        break;
      }
      case "sw": {
        const offset = address(source);
        if (offset === undefined) break;
        const value = registers.get(target);
        if (value === undefined) memory.delete(offset);
        else memory.set(offset, value);
        written.add(offset);
        break;
      }
      case "lw": {
        const offset = address(source);
        set(target, offset === undefined ? undefined : memory.get(offset));
        break;
      }
      default:
        if (
          !/^(?:s[bhw]|b[a-z]*|j|jr|ret)$/u.test(mnemonic) &&
          isRegister(target)
        )
          set(target, undefined);
    }
  }
  return calls;
}

/** Disassemble the typed fixture's caller with an independent LLVM tool. */
export async function inspectRiscvCallSites(path) {
  const command = process.env.REA_RISCV_OBJDUMP ?? "llvm-objdump";
  const options = {
    env: { ...process.env, LC_ALL: "C" },
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  };
  const version = await execute(command, ["--version"], options);
  const { stdout, stderr } = await execute(
    command,
    [
      "-d",
      "--no-show-raw-insn",
      "--disassemble-symbols=rea_riscv_abi_caller",
      path,
    ],
    options,
  );
  assert.equal(stderr.trim(), "", `objdump diagnostics: ${stderr}`);
  return {
    command,
    version: version.stdout.split("\n").find((line) => /version/iu.test(line)),
    calls: parseRiscvCallSites(stdout),
  };
}

const matchesWord = (call, actual, expected) =>
  typeof expected === "number"
    ? actual?.word === expected
    : actual?.stack !== undefined &&
      (expected === "frame" ||
        expected.frame.every(
          (word, index) =>
            call.memory.get(actual.stack + 4 * index)?.word === word,
        ));

/** The compiler's call sites place every known word where the table says. */
export function assertRiscvIlp32CallSites(calls) {
  assertRiscvIlp32TableConsistent();
  const checks = [
    ...Object.entries(RISCV_ILP32_ABI).map(([name, abi]) => [
      name,
      Object.assign(
        {},
        ...abi.parameters.map(([, , , words]) => words ?? {}),
        abi.variadic ?? {},
      ),
    ]),
    ["indirect", RISCV_ILP32_CALLBACK.words],
  ];
  for (const [target, words] of checks) {
    const call = calls.find((candidate) => candidate.target === target);
    assert.ok(call !== undefined, `No call site for ${target}`);
    for (const [location, expected] of Object.entries(words))
      assert.ok(
        matchesWord(call, call.words[location], expected),
        `${target}: ${location} holds ${JSON.stringify(call.words[location])}, not ${JSON.stringify(expected)}`,
      );
  }
}

/**
 * Where a stripped build returns: in the typed build's registers, or in none
 * when the result goes through caller memory addressed by `a0`.
 */
const strippedReturnStorage = (abi) =>
  abi.parameters.some(([name]) => name === "__return_storage_ptr__")
    ? "<VOID>"
    : abi.return[1];

/**
 * Typed functions keep their names and types and use exactly the table's
 * storage. Stripped functions get one inferred word per parameter location, in
 * order, and their return storage; recovered types are not compared.
 */
export function assertRiscvIlp32Storage(boundaries, { stripped = false } = {}) {
  assert.deepEqual(
    Object.keys(boundaries).sort(),
    Object.keys(RISCV_ILP32_ABI).sort(),
  );
  for (const [name, want] of Object.entries(RISCV_ILP32_ABI)) {
    const boundary = boundaries[name];
    assert.equal(boundary.calling_convention, "__rea_ilp32", name);
    const parameters = [...boundary.parameters].sort(
      (left, right) => left.ordinal - right.ordinal,
    );
    for (const value of [boundary.return_type, ...parameters])
      assert.doesNotMatch(value.storage ?? "", FLOAT_REGISTER, name);
    if (stripped) {
      assert.equal(
        boundary.return_type.storage,
        strippedReturnStorage(want),
        `${name} inferred return storage`,
      );
      if (want.variadic !== undefined) continue;
      assert.deepEqual(
        parameters.map((parameter) => parameter.storage),
        ordered(
          want.parameters.flatMap(([, , storage]) =>
            riscvStorageLocations(storage),
          ),
        ).map((location) => `${location}:4`),
        `${name} inferred parameter storage`,
      );
      continue;
    }
    assert.deepEqual(
      [boundary.return_type.data_type, boundary.return_type.storage],
      want.return,
      `${name} return storage`,
    );
    assert.deepEqual(
      parameters.map((parameter) => [
        parameter.name,
        parameter.data_type,
        parameter.storage,
      ]),
      want.parameters.map(([parameter, type, storage]) => [
        parameter,
        type,
        storage,
      ]),
      `${name} parameter storage`,
    );
  }
}

/**
 * The caller's pseudocode passes the call-site words through the corrected
 * storage: typed literals in a typed build, words in register order in a
 * stripped one, and never a floating-point register.
 */
export function assertRiscvIlp32Caller(
  pseudocode,
  addresses,
  { stripped = false } = {},
) {
  assert.doesNotMatch(pseudocode, FLOAT_REGISTER);
  for (const [name, abi] of Object.entries(RISCV_ILP32_ABI)) {
    if (abi.variadic !== undefined) continue;
    let call;
    if (stripped) {
      const words = Object.assign(
        {},
        ...abi.parameters.map(([, , , values]) => values ?? {}),
      );
      const locations = ordered(
        abi.parameters.flatMap(([, , storage]) =>
          riscvStorageLocations(storage),
        ),
      );
      call = `FUN_ram_0*${BigInt(addresses[name]).toString(16)}\\(${locations
        .map((location) => {
          const word = printed(words[location]);
          return word === undefined ? WILDCARD : escape(word);
        })
        .join(",")}\\)`;
    } else
      call = `${name}\\(${abi.parameters
        .map(([, , , , literal]) =>
          literal === undefined ? WILDCARD : escape(literal),
        )
        .join(",")}\\)`;
    assert.match(pseudocode, new RegExp(call, "u"), `${name} call arguments`);
  }
  assert.match(
    pseudocode,
    stripped
      ? new RegExp(
          `\\)\\s*\\(${Object.values(RISCV_ILP32_CALLBACK.words)
            .map((word) => escape(printed(word)))
            .join(",")},`,
          "u",
        )
      : new RegExp(
          `\\(\\*rea_riscv_abi_callback\\)\\s*\\(${RISCV_ILP32_CALLBACK.literals
            .map(escape)
            .join(",")},${WILDCARD}\\)`,
          "u",
        ),
    "indirect call arguments",
  );
}
