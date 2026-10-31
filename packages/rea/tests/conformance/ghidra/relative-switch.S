#if defined(__APPLE__)
.section __TEXT,__text,regular,pure_instructions
.globl _rea_relative_switch
_rea_relative_switch:
#else
.text
.globl rea_relative_switch
.type rea_relative_switch,%function
rea_relative_switch:
#endif
  cmp w0, #3
  b.hi Ldefault
  mov w8, w0
#if defined(__APPLE__)
  adrp x9, Ltable@PAGE
  add x9, x9, Ltable@PAGEOFF
#else
  adrp x9, Ltable
  add x9, x9, :lo12:Ltable
#endif
  adr x10, Lcase0
#if REA_ENTRY_BYTES == 2
  ldrh w11, [x9, x8, lsl #1]
#else
  ldrb w11, [x9, x8]
#endif
  add x10, x10, x11, lsl #2
  br x10
Lcase0:
  mov w0, #100
  ret
#if REA_ENTRY_BYTES == 2
  .space 1100
#endif
Lcase1:
  mov w0, #101
  ret
Lcase2:
  mov w0, #102
  ret
Lcase3:
  mov w0, #103
  ret
Ldefault:
  mov w0, #-1
  ret
#if defined(__APPLE__)
.section __TEXT,__const
#else
.section .rodata
#endif
.p2align 1
Ltable:
#if REA_ENTRY_BYTES == 2
  .short (Lcase0-Lcase0)/4, (Lcase1-Lcase0)/4, (Lcase2-Lcase0)/4, (Lcase3-Lcase0)/4
#else
  .byte (Lcase0-Lcase0)/4, (Lcase1-Lcase0)/4, (Lcase2-Lcase0)/4, (Lcase3-Lcase0)/4
#endif
