ENTRY(rea_entry)
/*
 * ESP32-C3 address ranges from ESP-IDF v6.1
 * components/soc/esp32c3/include/soc/soc.h. One program header per
 * memory keeps the ELF small; esptool reads sections.
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
  .flash.appdesc 0x3C000020 : { KEEP(*(.flash.appdesc)) } :drom
  .flash.rodata : { *(.flash.rodata) *(.rodata .rodata.* .srodata .srodata.*) } :drom
  .dram0.data 0x3FC88000 : { *(.dram0.data) *(.data .data.* .sdata .sdata.*) } :dram
  .iram0.text 0x40380000 : { *(.iram0.text) *(.text .text.*) } :iram
  .flash.text 0x42000020 : { *(.flash.text) } :irom
  /DISCARD/ : { *(.comment) *(.note.*) }
}
