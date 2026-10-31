/* Build an older-style shared image from source without ABI declarations. */
PHDRS {
  headers PT_PHDR PHDRS;
  text PT_LOAD FILEHDR PHDRS FLAGS(5);
  data PT_LOAD FLAGS(6);
  dynamic PT_DYNAMIC FLAGS(6);
}
SECTIONS {
  . = SIZEOF_HEADERS;
  .hash : { *(.hash) } :text
  .gnu.hash : { *(.gnu.hash) } :text
  .dynsym : { *(.dynsym) } :text
  .dynstr : { *(.dynstr) } :text
  .rel.dyn : { *(.rel.*) } :text
  .text : { *(.text*) } :text
  . = ALIGN(0x10000);
  .dynamic : { *(.dynamic) } :data :dynamic
  .got : { *(.got*) } :data
  .data : { *(.data*) } :data
  .bss : { *(.bss*) *(COMMON) } :data
  /DISCARD/ : { *(.MIPS.abiflags) *(.reginfo) *(.pdr) *(.mdebug.*) *(.comment) *(.note.*) }
}
