#include <stdio.h>
__attribute__((noinline, used)) int rea_version_leaf(void) {
  puts("REA_VERSION_TWO");
  return 2;
}
__attribute__((noinline, used)) int rea_added(void) { return 40; }
__attribute__((noinline, used)) int rea_version_entry(void) {
  return rea_version_leaf() + rea_added();
}
int main(void) { return rea_version_entry() == 42 ? 0 : 1; }
