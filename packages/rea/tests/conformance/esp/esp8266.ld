ENTRY(rea_entry)
/*
 * The bootloader fixture placed in ESP8266 DRAM and IRAM
 * (esptool v5.6.0 targets/esp8266.py MEMORY_MAP), so esptool writes an
 * ESP8266 v1 image. esptool accepts RISC-V ELF files for every chip.
 */
PHDRS
{
  dram PT_LOAD;
  iram PT_LOAD;
}
SECTIONS
{
  .data 0x3FFE8000 : { *(.dram0.bootdesc) *(.dram0.data) *(.data .data.* .sdata .sdata.*) *(.rodata .rodata.* .srodata .srodata.*) } :dram
  .text 0x40100000 : { *(.iram_loader.text) *(.text .text.*) } :iram
  /DISCARD/ : { *(.comment) *(.note.*) }
}
