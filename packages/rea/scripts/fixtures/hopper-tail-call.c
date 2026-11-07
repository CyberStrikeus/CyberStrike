#include <stdio.h>
__attribute__((noinline)) int target_fn(int x) { return x * 5; }
__attribute__((noinline)) int call_through(int (*fp)(int), int x) { return fp(x); }
__attribute__((noinline)) int call_direct(int x) { return target_fn(x); }
int main(void) { printf("%d %d\n", call_through(target_fn, 3), call_direct(4)); return 0; }
