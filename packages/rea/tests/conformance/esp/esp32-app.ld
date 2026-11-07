ENTRY(rea_entry)
/*
 * ESP32 (Xtensa) address ranges from ESP-IDF v6.1
 * components/soc/esp32/include/soc/soc.h, for app.c built with
 * xtensa-esp32-elf-gcc -mtext-section-literals.
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
  .flash.rodata : { *(.flash.rodata) *(.rodata .rodata.*) } :drom
  .dram0.data 0x3FFB0000 : { *(.dram0.data) *(.data .data.*) } :dram
  .iram0.text 0x40080000 : { *(.iram0.literal .iram0.text) *(.literal .text .literal.* .text.*) } :iram
  .flash.text 0x400D0020 : { *(.flash.literal .flash.text) } :irom
  /DISCARD/ : { *(.comment) *(.note.*) *(.xtensa.info) *(.xt.*) }
}
