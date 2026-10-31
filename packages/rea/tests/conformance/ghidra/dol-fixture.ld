/* Layout for the GameCube DOL fixture: text at 0x80003100, one data segment with a
 * zero-initialized tail, and a separate initialized tail segment after a gap. */
ENTRY(rea_ppc_entry)
PHDRS
{
  text PT_LOAD FLAGS(5);
  data PT_LOAD FLAGS(6);
  tail PT_LOAD FLAGS(6);
}
SECTIONS
{
  . = 0x80003100;
  .text : { *(.text .text.*) } :text
  .rodata : { *(.rodata .rodata.*) } :text
  . = 0x80013000;
  .data : { *(.data .data.*) } :data
  .bss : { *(.bss .bss.*) } :data
  . = 0x80013030;
  .dol_tail : { KEEP(*(.dol_tail)) } :tail
}
