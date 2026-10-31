#include <stdio.h>
#include <stdlib.h>
#ifndef VERSION
#define VERSION 1
#endif
#define FN __attribute__((noinline, used))
FN int stable(int x) { return x * 3 + 7; }
FN int changed(int x) { return x + VERSION * 5; }
#if VERSION == 1
FN int old_behavior(int x) { puts("behavior marker"); return x + 7; }
FN int old_name(int x) { return x ^ 0x13579; }
FN int removed_observation(int x) { return x * 13 + 99; }
FN int formerly_separate(int x) { return x + 12345; }
#else
FN int new_behavior(int x) { puts("behavior marker"); return x + 8; }
FN int renamed(int x) { return x ^ 0x13579; }
FN int added_observation(int x) { return x * 17 + 77; }
static inline int formerly_separate(int x) { return x + 12345; }
#endif
FN int alias_one(int x) { return x + 42; }
FN int alias_two(int x) { return x + 42; }
int main(int argc, char **argv) {
 int x = argc > 1 ? atoi(argv[1]) : 2;
 int result = stable(x) + changed(x) + formerly_separate(x) + alias_one(x) + alias_two(x);
#if VERSION == 1
 result += old_name(x) + removed_observation(x) + old_behavior(x);
#else
 result += renamed(x) + added_observation(x) + new_behavior(x);
#endif
 printf("%d\n", result);
 return 0;
}
