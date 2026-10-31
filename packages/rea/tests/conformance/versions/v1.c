#include <stdio.h>
__attribute__((noinline, used)) int rea_version_leaf(void) {
  puts("REA_VERSION_ONE");
  return 1;
}
__attribute__((noinline, used)) int rea_version_entry(void) {
  return rea_version_leaf();
}
int main(void) { return rea_version_entry() == 1 ? 0 : 1; }
