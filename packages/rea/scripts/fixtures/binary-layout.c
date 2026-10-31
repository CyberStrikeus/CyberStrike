#include <stdio.h>
#include <stdlib.h>

int stored_value = 7;
char zero_backing[8192];
__thread int tls_value;
int common_value;

__attribute__((noinline)) int read_values(const char *text) {
  char buffer[32];
  snprintf(buffer, sizeof(buffer), "%s", text);
  return buffer[0] + stored_value + tls_value + common_value;
}

int main(int argc, char **argv) {
  return read_values(argc > 1 ? argv[1] : "source-owned");
}
