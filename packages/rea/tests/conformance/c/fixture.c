#include <stdio.h>

volatile int rea_c_global = 7;

#define REA_LONG_CHUNK "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
#define REA_LONG_256 REA_LONG_CHUNK REA_LONG_CHUNK REA_LONG_CHUNK REA_LONG_CHUNK
#define REA_LONG_1024 REA_LONG_256 REA_LONG_256 REA_LONG_256 REA_LONG_256
/* Keep the full-size literal even when a loader does not type it as a string. */
__attribute__((used)) const char rea_long_literal[] =
    "REA_LONG_LITERAL_" REA_LONG_1024 REA_LONG_1024 REA_LONG_1024 REA_LONG_1024 "needle";
/* Verified Hopper loaders recognize this extent and split it into native objects. */
__attribute__((used)) const char rea_fragmented_literal[] =
    "REA_FRAGMENTED_LITERAL_" REA_LONG_256 REA_LONG_256 "fragment_tail";
__attribute__((used)) const char rea_utf8_literal[] = "REA_UTF8_é_😀";
__attribute__((used)) const char rea_ellipsis_literal[] = "REA_LITERAL_…";
__attribute__((used)) const char rea_latin1_literal[] = "REA_LATIN1_\xff";

__attribute__((noinline, used)) void rea_long_literal_procedure(void) {
  puts(rea_long_literal);
  puts(rea_fragmented_literal);
  puts(rea_utf8_literal);
  puts("REA_ESCAPED_\"\\line\nend\t\r");
  puts("REA_LITERAL_BACKSLASH_\\n");
  puts(rea_ellipsis_literal);
  puts(rea_latin1_literal);
}

__attribute__((noinline, used)) int rea_leaf(int value) {
  puts("REA_C_LEAF");
  return value + rea_c_global;
}

__attribute__((noinline, used)) int rea_branch(int value) {
  return value > 3 ? rea_leaf(value) : rea_leaf(-value);
}

__attribute__((noinline, used)) int rea_entry(void) {
  puts("REA_C_ENTRY");
  /* Give the native locals oracle explicit stack storage. */
  volatile int input = 5;
  return rea_branch(input);
}

int main(void) { return rea_entry() == 12 ? 0 : 1; }

__attribute__((noinline, used)) int rea_cycle_b(int value);

__attribute__((noinline, used)) int rea_cycle_a(int value) {
  return value > 0 ? rea_cycle_b(value - 1) : value;
}

__attribute__((noinline, used)) int rea_cycle_b(int value) {
  return value > 0 ? rea_cycle_a(value - 1) : value;
}
