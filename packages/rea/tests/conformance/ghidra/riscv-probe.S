/* Fixed instruction oracle, independent of the compiler's C code generation. */
.section .text
.option norvc
.global rea_riscv_probe
.type rea_riscv_probe, @function
rea_riscv_probe:
    addi a0, a0, 17
    ret
.size rea_riscv_probe, .-rea_riscv_probe
