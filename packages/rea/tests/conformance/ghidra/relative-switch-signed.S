// Hand-written signed halfword relative dispatch, modelled on the AOSP
// RenderScript blend kernel shape reported in issue #487:
//   adrp/add table; cmp; b.cs default; ldrsh; cbz null; adr base; add; br.
// Entries are signed byte offsets from Lsigned_base (no scaling), so cases
// before the base encode negative offsets. A zero entry means "no case body"
// and is routed through the CBZ before the branch. The source labels and the
// immediates below are the oracle; no REA or Ghidra result defines them.
//   case 0 -> 200, 1 -> 201, 2 -> 202, 3 -> null path (250), 4 -> 204,
//   selector >= 5 -> default (-1).
#ifndef REA_SELECTOR_BIAS
#define REA_SELECTOR_BIAS 0
#endif
// Nonzero variants switch on the original selector (bias .. bias+4),
// while the guarded table index is selector - bias.
#if defined(__APPLE__)
.section __TEXT,__text,regular,pure_instructions
.globl _rea_relative_switch_signed
.p2align 2
_rea_relative_switch_signed:
#else
.text
.globl rea_relative_switch_signed
.type rea_relative_switch_signed,%function
.p2align 2
rea_relative_switch_signed:
#endif
#if defined(__APPLE__)
  adrp x5, Lsigned_table@PAGE
  add x5, x5, Lsigned_table@PAGEOFF
#else
  adrp x5, Lsigned_table
  add x5, x5, :lo12:Lsigned_table
#endif
#if REA_SELECTOR_BIAS != 0
  sub w8, w0, #REA_SELECTOR_BIAS
  cmp w8, #5
  b.cs Lsigned_default
  ldrsh x6, [x5, w8, uxtw #1]
#else
  cmp w0, #5
  b.cs Lsigned_default
  ldrsh x6, [x5, w0, uxtw #1]
#endif
  cbz x6, Lsigned_null
  adr x5, Lsigned_base
  add x6, x5, x6
  br x6
Lsigned_case0:
  mov w0, #200
  ret
Lsigned_case1:
  mov w0, #201
  // The base sits inside case 1 so that no real case has a zero offset.
Lsigned_base:
  ret
Lsigned_case2:
  mov w0, #202
  ret
Lsigned_case4:
  mov w0, #204
  ret
Lsigned_null:
  mov w0, #250
  ret
Lsigned_default:
  mov w0, #-1
  ret
#if !defined(__APPLE__)
.size rea_relative_switch_signed, .-rea_relative_switch_signed
#endif

#if defined(__APPLE__)
.section __TEXT,__const
#else
.section .rodata
#endif
.p2align 1
Lsigned_table:
  .short Lsigned_case0-Lsigned_base
  .short Lsigned_case1-Lsigned_base
  .short Lsigned_case2-Lsigned_base
  .short 0
  .short Lsigned_case4-Lsigned_base
