ENTRY(rea_entry)
/*
 * RAM-only ESP32 layout for the RISC-V conformance bootloader, which esptool
 * converts for any chip and REA never runs. The addresses are in the DRAM
 * and IRAM ranges of ESP-IDF v6.1 components/soc/esp32/include/soc/soc.h,
 * where an ESP32 second-stage bootloader loads.
 */
PHDRS
{
  dram PT_LOAD;
  iram PT_LOAD;
}
SECTIONS
{
  .dram0.bootdesc 0x3FFF0030 : { KEEP(*(.dram0.bootdesc)) } :dram
  .dram0.data : { *(.dram0.data) *(.data .data.* .sdata .sdata.*) *(.rodata .rodata.* .srodata .srodata.*) } :dram
  .iram_loader.text 0x40080400 : { *(.iram_loader.text) *(.text .text.*) } :iram
  /DISCARD/ : { *(.comment) *(.note.*) }
}
