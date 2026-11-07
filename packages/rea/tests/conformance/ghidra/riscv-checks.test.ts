import { describe, expect, it } from "vitest";
import {
  RISCV_ILP32_ABI,
  assertRiscvIlp32CallSites,
  assertRiscvIlp32Caller,
  assertRiscvIlp32Storage,
  assertRiscvIlp32TableConsistent,
  parseRiscvCallSites,
  riscvStorageLocations,
} from "./riscv-checks.mjs";

// `llvm-objdump -d --no-show-raw-insn` of rea_riscv_abi_caller in the soft-float
// fixture, built by LLVM 19 at -O0 (tabs and runs of spaces collapsed). The real
// lane disassembles its own build; this tests the oracle, not Ghidra.
const LISTING = `
11408: addi sp, sp, -0xe0
1140a: sw ra, 0xdc(sp)
1140c: sw s0, 0xd8(sp)
1140e: addi s0, sp, 0xe0
11410: sw a0, -0xc(s0)
11414: lw a2, -0xc(s0)
11418: lui a0, 0x3fc00
1141c: lui a1, 0x40200
11420: jal 0x110f4 <rea_riscv_abi_pick>
11422: sw a0, -0x10(s0)
11426: lw a2, -0xc(s0)
1142a: li a0, 0x0
1142c: sw a0, -0xd4(s0)
11430: lui a1, 0x400a0
11434: jal 0x11130 <rea_riscv_abi_wide>
11436: lw a4, -0xd4(s0)
1143a: sw a1, -0x14(s0)
1143e: sw a0, -0x18(s0)
11442: lw a0, -0xc(s0)
11446: lui a2, 0x40130
1144a: lui a3, 0x40b00
1144e: lui a5, 0x40188
11452: mv a1, a4
11454: jal 0x1117e <rea_riscv_abi_mixed>
11456: lw a7, -0xd4(s0)
1145a: sw a1, -0x1c(s0)
1145e: sw a0, -0x20(s0)
11462: lw a6, -0xc(s0)
11466: mv a1, sp
11468: lui a0, 0x401d0
1146c: sw a0, 0x0(a1)
1146e: li a0, 0x1
11470: li a1, 0x2
11472: sw a1, -0xd8(s0)
11476: li a2, 0x3
11478: li a3, 0x4
1147a: li a4, 0x5
1147c: li a5, 0x6
1147e: jal 0x111e6 <rea_riscv_abi_split>
11480: sw a1, -0x24(s0)
11484: sw a0, -0x28(s0)
11488: lui a0, 0x41080
1148c: sw a0, -0x38(s0)
11490: lui a0, 0x41180
11494: sw a0, -0x34(s0)
11498: lw a1, -0x34(s0)
1149c: lw a0, -0x38(s0)
114a0: lui a2, 0x41280
114a4: jal 0x11256 <rea_riscv_abi_pair>
114a6: sw a1, -0x2c(s0)
114aa: sw a0, -0x30(s0)
114ae: lui a0, 0x41380
114b2: sw a0, -0x48(s0)
114b6: li a0, 0xc
114b8: sw a0, -0x44(s0)
114bc: lw a2, -0xc(s0)
114c0: lw a1, -0x44(s0)
114c4: lw a0, -0x48(s0)
114c8: jal 0x11296 <rea_riscv_abi_tagged>
114ca: mv a2, a0
114cc: lw a0, -0xd4(s0)
114d0: sw a2, -0xdc(s0)
114d4: mv a2, a1
114d6: lw a1, -0xdc(s0)
114da: sw a2, -0x3c(s0)
114de: sw a1, -0x40(s0)
114e2: lui a1, 0x402b0
114e6: sw a1, -0x74(s0)
114ea: sw a0, -0x78(s0)
114ee: lui a1, 0x402d0
114f2: sw a1, -0x6c(s0)
114f6: sw a0, -0x70(s0)
114fa: lui a0, 0x41780
114fe: sw a0, -0x68(s0)
11502: lw a0, -0x64(s0)
11506: sw a0, -0x7c(s0)
1150a: lw a0, -0x68(s0)
1150e: sw a0, -0x80(s0)
11512: lw a0, -0x6c(s0)
11516: sw a0, -0x84(s0)
1151a: lw a0, -0x70(s0)
1151e: sw a0, -0x88(s0)
11522: lw a0, -0x74(s0)
11526: sw a0, -0x8c(s0)
1152a: lw a0, -0x78(s0)
1152e: sw a0, -0x90(s0)
11532: addi a0, s0, -0x60
11536: addi a1, s0, -0x90
1153a: lui a2, 0x41840
1153e: jal 0x112d2 <rea_riscv_abi_large>
11540: lw a0, -0xd4(s0)
11544: lw a2, -0xc(s0)
11548: lui a1, 0x40037
1154c: addi a1, a1, -0x800
11550: sw a1, -0xc4(s0)
11554: sw a0, -0xc8(s0)
11558: sw a0, -0xcc(s0)
1155c: sw a0, -0xd0(s0)
11560: addi a0, s0, -0xc0
11564: addi a1, s0, -0xd0
11568: jal 0x11316 <rea_riscv_abi_quad>
1156a: lw a0, -0xd8(s0)
1156e: lw a6, -0xd4(s0)
11572: lw a1, -0xc0(s0)
11576: lw a2, -0xbc(s0)
1157a: lw a3, -0xb8(s0)
1157e: lw a4, -0xb4(s0)
11582: sw a4, -0x94(s0)
11586: sw a3, -0x98(s0)
1158a: sw a2, -0x9c(s0)
1158e: sw a1, -0xa0(s0)
11592: lw a4, -0xc(s0)
11596: mv a2, sp
11598: li a1, 0x13
1159a: sw a1, 0x0(a2)
1159c: lui a3, 0x40318
115a0: lui a7, 0x40328
115a4: mv a2, a6
115a6: jal 0x1136a <rea_riscv_abi_variadic>
115a8: sw a0, -0xa4(s0)
115ac: lui a0, 0x12
115b0: lw a3, 0x648(a0)
115b4: lw a2, -0xc(s0)
115b8: lui a0, 0x41a40
115bc: lui a1, 0x41ac0
115c0: jalr a3
115c2: sw a0, -0xa8(s0)
115c6: lw a0, -0x10(s0)
115ca: lw a1, -0x14(s0)
115ce: xor a0, a0, a1
115d0: lw a1, -0x1c(s0)
115d4: xor a0, a0, a1
115d6: lw a1, -0x24(s0)
115da: xor a0, a0, a1
115dc: lw a1, -0x30(s0)
115e0: xor a0, a0, a1
115e2: lw a1, -0x3c(s0)
115e6: xor a0, a0, a1
115e8: lw a1, -0x54(s0)
115ec: xor a0, a0, a1
115ee: lw a1, -0x94(s0)
115f2: xor a0, a0, a1
115f4: lw a1, -0xa4(s0)
115f8: xor a0, a0, a1
115fa: lw a1, -0xa8(s0)
115fe: xor a0, a0, a1
11600: lw ra, 0xdc(sp)
11602: lw s0, 0xd8(sp)
11604: addi sp, sp, 0xe0
11606: ret
`;

// Ghidra 12.1.4 HighFunction prototypes of the same build, printed as
// `name return | parameter:type@storage`. DERIVED uses __rea_ilp32. The two
// stock lines are Ghidra's ilp32d prototype, and the ilp32 prototype before it
// passed values over 8 bytes by reference.
const DERIVED = `
rea_riscv_abi_pick float@a0:4 | a:float@a0:4 | b:float@a1:4 | sel:int@a2:4
rea_riscv_abi_wide double@a1:4,a0:4 | a:double@a1:4,a0:4 | sel:int@a2:4
rea_riscv_abi_mixed double@a1:4,a0:4 | i:int@a0:4 | d:double@a2:4,a1:4 | f:float@a3:4 | e:double@a5:4,a4:4
rea_riscv_abi_split double@a1:4,a0:4 | a:int@a0:4 | b:int@a1:4 | c:int@a2:4 | d:int@a3:4 | e:int@a4:4 | f:int@a5:4 | g:int@a6:4 | x:double@Stack[0x0]:4,a7:4
rea_riscv_abi_pair rea_riscv_abi_pair@a1:4,a0:4 | value:rea_riscv_abi_pair@a1:4,a0:4 | scale:float@a2:4
rea_riscv_abi_tagged rea_riscv_abi_tagged@a1:4,a0:4 | value:rea_riscv_abi_tagged@a1:4,a0:4 | tag:int@a2:4
rea_riscv_abi_large rea_riscv_abi_large *@a0:4 | __return_storage_ptr__:rea_riscv_abi_large *@a0:4 (auto) | value:rea_riscv_abi_large *@a1:4 | scale:float@a2:4
rea_riscv_abi_quad long double *@a0:4 | __return_storage_ptr__:long double *@a0:4 (auto) | value:long double *@a1:4 | sel:int@a2:4
rea_riscv_abi_variadic uint@a0:4 | count:int@a0:4
`;
const DEFAULT_PICK =
  "rea_riscv_abi_pick float@fa0:4 | a:float@fa0:4 | b:float@fa1:4 | sel:int@a0:4";
const JOINED_QUAD =
  "rea_riscv_abi_quad long double *@a0:4 | __return_storage_ptr__:long double *@a0:4 (auto) | value:long double@a4:4,a3:4,a2:4,a1:4 | sel:int@a5:4";
const STRIPPED = `
rea_riscv_abi_pick undefined4@a0:4 | param_1:undefined4@a0:4 | param_2:undefined4@a1:4 | param_3:int@a2:4
rea_riscv_abi_wide undefined8@a1:4,a0:4 | param_1:undefined4@a0:4 | param_2:undefined4@a1:4 | param_3:int@a2:4
rea_riscv_abi_mixed undefined8@a1:4,a0:4 | param_1:int@a0:4 | param_2:undefined4@a1:4 | param_3:undefined4@a2:4 | param_4:undefined4@a3:4 | param_5:undefined4@a4:4 | param_6:undefined4@a5:4
rea_riscv_abi_split undefined8@a1:4,a0:4 | param_1:uint@a0:4 | param_2:uint@a1:4 | param_3:uint@a2:4 | param_4:uint@a3:4 | param_5:uint@a4:4 | param_6:uint@a5:4 | param_7:uint@a6:4 | param_8:undefined4@a7:4 | param_9:undefined4@Stack[0x0]:4
rea_riscv_abi_pair undefined8@a1:4,a0:4 | param_1:undefined4@a0:4 | param_2:undefined4@a1:4 | param_3:undefined4@a2:4
rea_riscv_abi_tagged undefined8@a1:4,a0:4 | param_1:undefined4@a0:4 | param_2:undefined4@a1:4 | param_3:undefined4@a2:4
rea_riscv_abi_large void@<VOID> | param_1:undefined4 *@a0:4 | param_2:undefined4 *@a1:4 | param_3:undefined4@a2:4
rea_riscv_abi_quad void@<VOID> | param_1:undefined4 *@a0:4 | param_2:undefined4 *@a1:4 | param_3:undefined4@a2:4
rea_riscv_abi_variadic uint@a0:4 | param_1:int@a0:4
`;

/** Rebuild inspect_native_api boundaries from the recorded prototype lines. */
const boundaries = (text: string, calling_convention = "__rea_ilp32") =>
  Object.fromEntries(
    text
      .trim()
      .split("\n")
      .map((line) => {
        const [head = "", ...parameters] = line.split(" | ");
        const name = head.slice(0, head.indexOf(" "));
        const [data_type, storage] = head.slice(name.length + 1).split("@");
        return [
          name,
          {
            calling_convention,
            return_type: { data_type, storage },
            parameters: parameters.map((parameter, ordinal) => {
              const at = parameter.indexOf(":");
              const [type, place] = parameter.slice(at + 1).split("@");
              return {
                ordinal,
                name: parameter.slice(0, at),
                data_type: type,
                storage: place,
              };
            }),
          },
        ];
      }),
  );

// Call lines of rea_riscv_abi_caller's pseudocode from the same Ghidra runs.
const TYPED_CALLER = `
  local_10 = rea_riscv_abi_pick(1.5,2.5,sel);
  local_18 = rea_riscv_abi_wide(3.25,local_c);
  local_20 = rea_riscv_abi_mixed(local_c,4.75,5.5,6.125);
  local_28 = rea_riscv_abi_split(1,2,3,4,5,6,local_c,7.25);
  local_30 = rea_riscv_abi_pair((rea_riscv_abi_pair)0x4118000041080000,10.5);
  local_40 = rea_riscv_abi_tagged((rea_riscv_abi_tagged)0xc41380000,local_c);
  rea_riscv_abi_large(&rStack_60,&local_90,16.5);
  rea_riscv_abi_quad((long_double *)&local_c0,(long_double *)&local_d0,local_c);
  local_a4 = rea_riscv_abi_variadic(2,0x13,0,0x40318000,local_c);
  fVar1 = (*rea_riscv_abi_callback)(20.5,21.5,local_c);
`;
const DEFAULT_CALLER = `
  fVar2 = rea_riscv_abi_pick(in_fa0,in_fa1,0x3fc00000);
  dVar3 = rea_riscv_abi_wide((double)CONCAT44(extraout_var,fVar2),0);
  (*rea_riscv_abi_callback)(extraout_fa0,extraout_fa1_00,0x41a40000);
`;
const STRIPPED_CALLER = `
  local_10 = FUN_ram_000110f4(0x3fc00000,0x40200000,param_1);
  local_18 = FUN_ram_00011130(0,0x400a0000,local_c);
  local_20 = FUN_ram_0001117e(local_c,0,0x40130000,0x40b00000,0,0x40188000);
  local_28 = FUN_ram_000111e6(1,2,3,4,5,6,local_c,0,0x401d0000);
  local_30 = FUN_ram_00011256(0x41080000,0x41180000,0x41280000);
  local_40 = FUN_ram_00011296(0x41380000,0xc,local_c);
  FUN_ram_000112d2(auStack_60,&local_90,0x41840000);
  FUN_ram_00011316(&local_c0,&local_d0,local_c);
  local_a4 = FUN_ram_0001136a(2,0x13,0,0x40318000,local_c);
  uVar1 = (*(code *)PTR_FUN_ram_000110f4_ram_00012648)
                    (0x41a40000,0x41ac0000,local_c,PTR_FUN_ram_000110f4_ram_00012648);
`;
const ADDRESSES = {
  rea_riscv_abi_pick: "0x110f4",
  rea_riscv_abi_wide: "0x11130",
  rea_riscv_abi_mixed: "0x1117e",
  rea_riscv_abi_split: "0x111e6",
  rea_riscv_abi_pair: "0x11256",
  rea_riscv_abi_tagged: "0x11296",
  rea_riscv_abi_large: "0x112d2",
  rea_riscv_abi_quad: "0x11316",
  rea_riscv_abi_variadic: "0x1136a",
};

describe("RISC-V ilp32 conformance checks", () => {
  it("keeps every call-site word at its storage location", () => {
    expect(() => assertRiscvIlp32TableConsistent()).not.toThrow();
    expect(riscvStorageLocations("Stack[0x0]:4,a7:4")).toEqual([
      "Stack[0x0]",
      "a7",
    ]);
    expect(riscvStorageLocations("a0:4 (auto)")).toEqual(["a0"]);
  });

  it("recovers the words the compiler's call sites write", () => {
    const calls = parseRiscvCallSites(LISTING);
    expect(calls.map((call) => call.target)).toEqual([
      "rea_riscv_abi_pick",
      "rea_riscv_abi_wide",
      "rea_riscv_abi_mixed",
      "rea_riscv_abi_split",
      "rea_riscv_abi_pair",
      "rea_riscv_abi_tagged",
      "rea_riscv_abi_large",
      "rea_riscv_abi_quad",
      "rea_riscv_abi_variadic",
      "indirect",
    ]);
    expect(() => assertRiscvIlp32CallSites(calls)).not.toThrow();
    // The variadic pairs skip a1, which still holds the stack argument.
    expect(calls[8]?.words).toMatchObject({
      a1: { word: 19 },
      a3: { word: 0x40318000 },
      a7: { word: 0x40328000 },
      "Stack[0x0]": { word: 19 },
    });
  });

  it("refuses a listing whose call site places a value elsewhere", () => {
    const moved = LISTING.replace("lui a1, 0x40200", "lui a2, 0x40200");
    expect(() => assertRiscvIlp32CallSites(parseRiscvCallSites(moved))).toThrow(
      /rea_riscv_abi_pick: a1/u,
    );
    // The long double copy that a1 points at must hold 22.5L's words.
    const copied = LISTING.replace("lui a1, 0x40037", "lui a1, 0x40038");
    expect(() =>
      assertRiscvIlp32CallSites(parseRiscvCallSites(copied)),
    ).toThrow(/rea_riscv_abi_quad: a1/u);
  });

  it("accepts the derived prototypes and refuses Ghidra's stock ilp32d model", () => {
    expect(() => assertRiscvIlp32Storage(boundaries(DERIVED))).not.toThrow();
    expect(() =>
      assertRiscvIlp32Storage(boundaries(STRIPPED), { stripped: true }),
    ).not.toThrow();
    for (const stock of [DEFAULT_PICK, JOINED_QUAD])
      expect(() =>
        assertRiscvIlp32Storage({
          ...boundaries(DERIVED),
          ...boundaries(stock),
        }),
      ).toThrow();
    expect(() =>
      assertRiscvIlp32Storage(boundaries(DERIVED, "__stdcall")),
    ).toThrow();
    expect(Object.keys(boundaries(DERIVED))).toEqual(
      Object.keys(RISCV_ILP32_ABI),
    );
  });

  it("checks a stripped build's return storage, not its recovered types", () => {
    const stripped = (text: string) =>
      assertRiscvIlp32Storage(boundaries(text), { stripped: true });
    expect(() =>
      stripped(STRIPPED.replaceAll("undefined8@", "ulonglong@")),
    ).not.toThrow();
    // A register-pair return that loses its high word is refused.
    expect(() =>
      stripped(
        STRIPPED.replace(
          "rea_riscv_abi_wide undefined8@a1:4,a0:4",
          "rea_riscv_abi_wide undefined4@a0:4",
        ),
      ),
    ).toThrow(/rea_riscv_abi_wide inferred return storage/u);
  });

  it("reads the caller's arguments through the corrected storage", () => {
    expect(() => assertRiscvIlp32Caller(TYPED_CALLER, ADDRESSES)).not.toThrow();
    expect(() =>
      assertRiscvIlp32Caller(STRIPPED_CALLER, ADDRESSES, { stripped: true }),
    ).not.toThrow();
    expect(() => assertRiscvIlp32Caller(DEFAULT_CALLER, ADDRESSES)).toThrow();
    expect(() =>
      assertRiscvIlp32Caller(
        STRIPPED_CALLER.replace(
          "0x40130000,0x40b00000",
          "0x40b00000,0x40130000",
        ),
        ADDRESSES,
        { stripped: true },
      ),
    ).toThrow(/rea_riscv_abi_mixed call arguments/u);
  });
});
