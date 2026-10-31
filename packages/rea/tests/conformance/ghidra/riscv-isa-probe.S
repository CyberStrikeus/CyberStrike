/* Zifencei and Zicsr oracle for the soft-float fixture, independent of the
 * compiler's C code generation. Returns its argument unchanged. */
.section .text
.option norvc
.global rea_riscv_isa_probe
.type rea_riscv_isa_probe, @function
rea_riscv_isa_probe:
    fence.i
    csrr t0, mcycle
    ret
.size rea_riscv_isa_probe, .-rea_riscv_isa_probe
