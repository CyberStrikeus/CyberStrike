ENTRY(rea_entry)
/*
 * ESP32 address ranges from ESP-IDF v6.1
 * components/soc/esp32/include/soc/soc.h for the RISC-V conformance app,
 * which esptool converts for any chip and REA never runs. One program
 * header per memory keeps the ELF small.
 */
PHDRS
{
  drom PT_LOAD;
  dram PT_LOAD;
  iram PT_LOAD;
  irom PT_LOAD;
}
SECTIONS
{
  .flash.appdesc 0x3F400020 : { KEEP(*(.flash.appdesc)) } :drom
  .flash.rodata : { *(.flash.rodata) *(.rodata .rodata.* .srodata .srodata.*) } :drom
  .dram0.data 0x3FFB0000 : { *(.dram0.data) *(.data .data.* .sdata .sdata.*) } :dram
  .iram0.text 0x40080000 : { *(.iram0.text) *(.text .text.*) } :iram
  .flash.text 0x400D0020 : { *(.flash.text) } :irom
  /DISCARD/ : { *(.comment) *(.note.*) }
}
