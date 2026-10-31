.globl _start
.globl absolute_value
.set absolute_value, 0x20000000000007
.bss
.lcomm zero_backing, 8192
.text
_start:
  mov $60, %eax
  xor %edi, %edi
  syscall
