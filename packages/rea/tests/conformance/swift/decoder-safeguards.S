/* Static-analysis fixture only. Never executed. Deliberate malformed ABI words
 * cannot be produced by a well-formed Swift source literal. */
.text
.p2align 2
.globl _rea_swift_decoder_copied
_rea_swift_decoder_copied:
    mov x5, #0x6b6f
    movz x6, #0xe200, lsl #48
    mov x0, x5
    mov x1, x6
    stp x0, x1, [sp, #-16]!
    ldp x0, x1, [sp], #16
    ret

.p2align 2
.globl _rea_swift_decoder_select
_rea_swift_decoder_select:
    mov x2, #0x61
    mov x3, #0x6262
    movz x6, #0xe100, lsl #48
    movz x7, #0xe200, lsl #48
    cmp w4, #0
    csel x0, x2, x3, eq
    csel x1, x6, x7, eq
    ret

.p2align 2
.globl _rea_swift_decoder_selected_copy
_rea_swift_decoder_selected_copy:
    mov x2, #0x61
    mov x3, #0x62
    cmp w4, #0
    csel x5, x2, x3, eq
    mov x0, x5
    movz x1, #0xe100, lsl #48
    ret

.p2align 2
.globl _rea_swift_decoder_padding
_rea_swift_decoder_padding:
    mov x0, #0x6261
    movz x1, #0xe100, lsl #48
    ret

.p2align 2
.globl _rea_swift_decoder_utf8
_rea_swift_decoder_utf8:
    mov x0, #0xc0
    movz x1, #0xa100, lsl #48
    ret

.section __DATA,__const
.globl _rea_swift_decoder_bad_terminator
_rea_swift_decoder_bad_terminator:
    .byte 0x61, 0x62, 0x63, 0x78
.globl _rea_swift_decoder_bad_large_utf8
_rea_swift_decoder_bad_large_utf8:
    .byte 0xc0, 0
