.text
.globl _rea_unresolved_string_jump
.p2align 2
_rea_unresolved_string_jump:
    movz x0, #0x4220
    movk x0, #0x732f, lsl #16
    movz x1, #0xe400, lsl #48
    br x16
