ENTRY(rea_entry)
/*
 * app.c placed in ESP8266 DRAM, IRAM and the IROM flash window (esptool
 * v5.6.0 targets/esp8266.py MEMORY_MAP), so esptool --version 3 writes an
 * image whose first segment is IROM.
 */
PHDRS
{
  dram PT_LOAD;
  iram PT_LOAD;
  irom PT_LOAD;
}
SECTIONS
{
  .data 0x3FFE8000 : { *(.flash.appdesc) *(.flash.rodata) *(.dram0.data) *(.data .data.* .sdata .sdata.*) *(.rodata .rodata.* .srodata .srodata.*) } :dram
  .text 0x40100000 : { *(.iram0.text) *(.text .text.*) } :iram
  .irom0.text 0x40201010 : { *(.flash.text) } :irom
  /DISCARD/ : { *(.comment) *(.note.*) }
}
