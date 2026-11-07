/* Source-owned Allegrex decoding probe. This fixture is never executed. */
.set noreorder
.text
.align 2
.globl rea_psp_probe
.type rea_psp_probe, @function
.ent rea_psp_probe
rea_psp_probe:
  addiu $v0, $zero, 0x1234
  bitrev $v0, $v0
  jr $ra
  nop
.end rea_psp_probe
.size rea_psp_probe, .-rea_psp_probe
