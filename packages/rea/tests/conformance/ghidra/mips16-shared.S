/* Source-owned mixed-instruction shared-image control. */
.abicalls
.module fp=xx
.module nooddspreg
.text
.set noreorder
.set nomicromips
.set mips16
.globl rea_mips16_probe
.type rea_mips16_probe, @function
.ent rea_mips16_probe
rea_mips16_probe:
    li $2, 90
    xor $2, $4
    addiu $2, 7
    jrc $31
.end rea_mips16_probe
.size rea_mips16_probe, . - rea_mips16_probe
.ifndef REA_MIPS_SYMBOL_RELATIVE
.hidden rea_mips16_probe
.endif

.set nomips16
.globl rea_mips32_probe
.type rea_mips32_probe, @function
.ent rea_mips32_probe
rea_mips32_probe:
    addiu $2, $4, 3
    jr $31
    nop
.end rea_mips32_probe
.size rea_mips32_probe, . - rea_mips32_probe

.data
.balign 4
.globl rea_mips16_pointer
.type rea_mips16_pointer, @object
.size rea_mips16_pointer, 4
rea_mips16_pointer:
    .word rea_mips16_probe
.section .note.GNU-stack, "", @progbits
