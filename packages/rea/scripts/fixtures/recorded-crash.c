#include <stdint.h>
#include <pthread.h>
#include <stdatomic.h>
#include <unistd.h>
static atomic_int ready;
static void *recorded_thread(void *unused) {
  (void)unused;
  __asm__ volatile("movabs $0xfedcba9876543210, %%r12" ::: "r12");
  atomic_store(&ready, 1);
  for (;;) pause();
  return 0;
}
__attribute__((noinline)) static void fixture_crash(uint64_t value) {
  volatile uint64_t *pointer = (volatile uint64_t *)(uintptr_t)0x123;
  *pointer = value;
}
int main(void) {
  pthread_t thread;
  pthread_attr_t attr;
  if (pthread_attr_init(&attr) || pthread_attr_setstacksize(&attr, 65536) || pthread_create(&thread, &attr, recorded_thread, 0)) return 1;
  while (!atomic_load(&ready)) usleep(1000);
  fixture_crash(UINT64_C(0x1122334455667788));
  return 0;
}
