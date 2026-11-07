ENTRY(rea_entry)
/*
 * RAM-only ESP32-C3 layout, as a second-stage bootloader has. The addresses
 * are in the DRAM and IRAM ranges of ESP-IDF v6.1
 * components/soc/esp32c3/include/soc/soc.h.
 */
PHDRS
{
  dram PT_LOAD;
  iram PT_LOAD;
}
SECTIONS
{
  .dram0.bootdesc 0x3FCD5820 : { KEEP(*(.dram0.bootdesc)) } :dram
  .dram0.data : { *(.dram0.data) *(.data .data.* .sdata .sdata.*) *(.rodata .rodata.* .srodata .srodata.*) } :dram
  .iram_loader.text 0x403CC710 : { *(.iram_loader.text) *(.text .text.*) } :iram
  /DISCARD/ : { *(.comment) *(.note.*) }
}
