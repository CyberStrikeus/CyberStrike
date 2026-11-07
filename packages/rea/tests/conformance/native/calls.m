#import <Foundation/Foundation.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

// Observed by verify:native-calls; `--wait` keeps the process running.
@interface ReaCallGreeter : NSObject
- (NSString *)greet:(NSString *)name times:(long)count;
@end
@implementation ReaCallGreeter
- (NSString *)greet:(NSString *)name times:(long)count {
  return [NSString stringWithFormat:@"%@ x%ld", name, count];
}
@end

__attribute__((noinline)) int rea_call_add(int left, int right) {
  return left + right;
}

static void write_fill(int descriptor, char value) {
  char chunk[8192];
  memset(chunk, value, sizeof(chunk));
  size_t remaining = 2 * 1024 * 1024;
  while (remaining > 0) {
    size_t wanted = remaining < sizeof(chunk) ? remaining : sizeof(chunk);
    ssize_t written = write(descriptor, chunk, wanted);
    if (written <= 0)
      return;
    remaining -= (size_t)written;
  }
}

int main(int argc, char **argv) {
  @autoreleasepool {
    if (argc > 1 && strcmp(argv[1], "--flood") == 0) {
      write_fill(STDOUT_FILENO, 'O');
      write_fill(STDERR_FILENO, 'E');
      return 0;
    }
    if (argc > 1 && strcmp(argv[1], "--wait") == 0)
      for (;;) sleep(1);
    ReaCallGreeter *greeter = [ReaCallGreeter new];
    for (long index = 0; index < 3; index++)
      printf("%s %d\n", [[greeter greet:@"world" times:index] UTF8String],
             rea_call_add((int)index, 40));
    const char *marker = getenv("REA_CALLS_MARKER");
    if (marker != NULL)
      printf("marker %s\n", marker);
  }
  return 0;
}
