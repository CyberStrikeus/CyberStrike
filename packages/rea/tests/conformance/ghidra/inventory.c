#include <stdio.h>
#include <stdlib.h>

volatile int rea_ghidra_inventory_global = 7;

#if defined(__x86_64__) && defined(__ELF__)
// Static decoder controls: these functions are retained but never executed.
__attribute__((naked, noinline, used)) void rea_ghidra_flow_return(void) {
  __asm__("ret");
}
__attribute__((naked, noinline, used)) void rea_ghidra_flow_cleanup_return(void) {
  __asm__("ret $16");
}
__attribute__((naked, noinline, used)) void rea_ghidra_flow_shared_tail(void) {
  __asm__("jmp rea_ghidra_flow_return");
}
__attribute__((naked, noinline, used)) void rea_ghidra_flow_trap(void) {
  __asm__("ud2");
}
#endif

// This literal reproduces stack exhaustion in Java's recursive regex matcher.
#define REA_REPEAT_4(value) value value value value
#define REA_REPEAT_16(value) REA_REPEAT_4(REA_REPEAT_4(value))
#define REA_REGEX_RUN REA_REPEAT_16(REA_REPEAT_16(REA_REPEAT_16("a")))
__attribute__((used)) const char *volatile rea_ghidra_regex_subject =
    REA_REGEX_RUN REA_REGEX_RUN REA_REGEX_RUN "!";
#undef REA_REGEX_RUN
#undef REA_REPEAT_16
#undef REA_REPEAT_4

enum ReaFixtureState { REA_FIXTURE_IDLE = 0, REA_FIXTURE_READY = 3 };
union ReaFixturePayload { unsigned int word; unsigned char bytes[4]; };
struct ReaFixtureLayout {
  enum ReaFixtureState state;
  union ReaFixturePayload payload;
  struct ReaFixtureLayout *next;
};
volatile struct ReaFixtureLayout rea_ghidra_inventory_layout = {
    REA_FIXTURE_READY, {.word = 5}, 0};

__attribute__((noinline, used)) int rea_ghidra_inventory_leaf(int value) {
  puts("REA_GHIDRA_LEAF_VALUE");
  return value + rea_ghidra_inventory_global;
}

// Ghidra's no-return analysis recognizes abort; this function provides a real
// terminal-call boundary while retaining a returning path.
__attribute__((noinline, used)) int rea_ghidra_inventory_terminal_call(
    int should_abort) {
  if (should_abort) abort();
  puts("REA_GHIDRA_TERMINAL_CALL_RETURNED");
  return should_abort;
}

// A reference into the function body can land inside an instruction.
__attribute__((used)) const unsigned char *volatile rea_ghidra_interior_pointer =
    (const unsigned char *)(void *)rea_ghidra_inventory_leaf + 1;

__attribute__((noinline, used)) int rea_ghidra_inventory_branch(int value) {
  if (value > 10) {
    return rea_ghidra_inventory_leaf(value);
  }
  return rea_ghidra_inventory_leaf(-value);
}

__attribute__((noinline, used)) int rea_ghidra_inventory_indirect(
    int (*callback)(int), int value) {
  return callback(value);
}

__attribute__((noinline, used)) int rea_ghidra_inventory_switch(
    unsigned int selector, int value) {
  switch (selector) {
    case 0:
      return rea_ghidra_inventory_leaf(value);
    case 1:
      return rea_ghidra_inventory_leaf(value + 3);
    case 2:
      return rea_ghidra_inventory_leaf(value - 5);
    case 3:
      return rea_ghidra_inventory_leaf(value * 2);
    case 4:
      return rea_ghidra_inventory_leaf(value ^ 0x55);
    case 5:
      return rea_ghidra_inventory_leaf(value | 0x20);
    case 6:
      return rea_ghidra_inventory_leaf(value & 0x3f);
    case 7:
      return rea_ghidra_inventory_leaf(value + rea_ghidra_inventory_global);
    default:
      return -1;
  }
}

__attribute__((noinline, used)) int rea_ghidra_inventory_dense_switch(
    unsigned int selector, int value) {
  switch (selector) {
    case 0: return rea_ghidra_inventory_leaf(value + 0);
    case 1: return rea_ghidra_inventory_leaf(value + 1);
    case 2: return rea_ghidra_inventory_leaf(value + 2);
    case 3: return rea_ghidra_inventory_leaf(value + 3);
    case 4: return rea_ghidra_inventory_leaf(value + 4);
    case 5: return rea_ghidra_inventory_leaf(value + 5);
    case 6: return rea_ghidra_inventory_leaf(value + 6);
    case 7: return rea_ghidra_inventory_leaf(value + 7);
    case 8: return rea_ghidra_inventory_leaf(value + 8);
    case 9: return rea_ghidra_inventory_leaf(value + 9);
    case 10: return rea_ghidra_inventory_leaf(value + 10);
    case 11: return rea_ghidra_inventory_leaf(value + 11);
    case 12: return rea_ghidra_inventory_leaf(value + 12);
    case 13: return rea_ghidra_inventory_leaf(value + 13);
    case 14: return rea_ghidra_inventory_leaf(value + 14);
    case 15: return rea_ghidra_inventory_leaf(value + 15);
    case 16: return rea_ghidra_inventory_leaf(value + 16);
    case 17: return rea_ghidra_inventory_leaf(value + 17);
    case 18: return rea_ghidra_inventory_leaf(value + 18);
    case 19: return rea_ghidra_inventory_leaf(value + 19);
    case 20: return rea_ghidra_inventory_leaf(value + 20);
    case 21: return rea_ghidra_inventory_leaf(value + 21);
    case 22: return rea_ghidra_inventory_leaf(value + 22);
    case 23: return rea_ghidra_inventory_leaf(value + 23);
    case 24: return rea_ghidra_inventory_leaf(value + 24);
    case 25: return rea_ghidra_inventory_leaf(value + 25);
    case 26: return rea_ghidra_inventory_leaf(value + 26);
    case 27: return rea_ghidra_inventory_leaf(value + 27);
    case 28: return rea_ghidra_inventory_leaf(value + 28);
    case 29: return rea_ghidra_inventory_leaf(value + 29);
    case 30: return rea_ghidra_inventory_leaf(value + 30);
    case 31: return rea_ghidra_inventory_leaf(value + 31);
    case 32: return rea_ghidra_inventory_leaf(value + 32);
    case 33: return rea_ghidra_inventory_leaf(value + 33);
    case 34: return rea_ghidra_inventory_leaf(value + 34);
    case 35: return rea_ghidra_inventory_leaf(value + 35);
    case 36: return rea_ghidra_inventory_leaf(value + 36);
    case 37: return rea_ghidra_inventory_leaf(value + 37);
    case 38: return rea_ghidra_inventory_leaf(value + 38);
    case 39: return rea_ghidra_inventory_leaf(value + 39);
    default: return -1;
  }
}

__attribute__((noinline, used)) int rea_ghidra_inventory_entry(void) {
  puts("REA_GHIDRA_INVENTORY_ENTRY");
  return rea_ghidra_inventory_branch(35) +
         rea_ghidra_inventory_indirect(rea_ghidra_inventory_leaf, 0) +
         rea_ghidra_inventory_dense_switch(100, 0) + 1;
}

int main(void) { return rea_ghidra_inventory_entry() == 49 ? 0 : 1; }
