// Keep secondary imported entry labels and a non-entry control in one function.
#if defined(__APPLE__)
#define REA_SYMBOL(name) "_" name
#else
#define REA_SYMBOL(name) name
#endif

volatile int rea_xrefs_data = 17;
__attribute__((used)) volatile int rea_xrefs_unreferenced = 41;

__attribute__((noinline, used)) int rea_alias_target(void) {
  int value = rea_xrefs_data;
  // Preserve normal function-start metadata. Imported symbols at instruction
  // boundaries can become procedure entries, so keep this label inside a NOP.
#if defined(__aarch64__)
  __asm__ volatile(".globl " REA_SYMBOL("rea_interior") "\n"
                   ".byte 0x1f\n"
                   REA_SYMBOL("rea_interior") ":\n"
                   ".byte 0x20,0x03,0xd5\n" : : "r"(value));
#elif defined(__x86_64__)
  __asm__ volatile(".byte 0x0f\n"
                   ".globl " REA_SYMBOL("rea_interior") "\n"
                   REA_SYMBOL("rea_interior") ":\n"
                   ".byte 0x1f,0x00\n" : : "r"(value));
#else
#error "The Ghidra entry-alias fixture supports only x86_64 and arm64"
#endif
  return value;
}

__asm__(".globl " REA_SYMBOL("rea_entry_alias") "\n"
        ".set " REA_SYMBOL("rea_entry_alias") ", " REA_SYMBOL("rea_alias_target") "\n"
        // A bare hexadecimal identifier must still resolve as an entry label.
        ".globl dead\n.set dead, " REA_SYMBOL("rea_alias_target") "\n");

int main(void) { return rea_alias_target(); }
