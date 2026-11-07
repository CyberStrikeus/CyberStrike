#include <stdlib.h>
#include <string.h>
#include <errno.h>

extern void *__tls_get_addr(void *);
extern int *__errno_location(void);
extern void rea_unknown_stop(void);
extern void _Unwind_Resume(void *) __attribute__((noreturn));
volatile unsigned long rea_after_call;

void *rea_malloc(size_t n) {
    void *p = malloc(n);
    rea_after_call++;
    return p;
}
void *rea_malloc_adjacent(size_t n) {
    void *p = malloc(n);
    rea_after_call++;
    return p;
}
__attribute__((visibility("hidden"))) void *rea_tls(void *p) {
    void *value = __tls_get_addr(p);
    rea_after_call++;
    return value;
}
__attribute__((visibility("hidden"))) void *rea_tls_chain(void *p) {
    void *value = rea_tls(p);
    rea_after_call++;
    return value;
}
void *rea_tls_outer(void *p) {
    void *value = rea_tls_chain(p);
    rea_after_call++;
    return value;
}
void *rea_memcpy(void *out, const void *in, size_t n) {
    void *value = memcpy(out, in, n);
    rea_after_call++;
    return value;
}
void *rea_memset(void *out, int c, size_t n) {
    void *value = memset(out, c, n);
    rea_after_call++;
    return value;
}
size_t rea_strlen(const char *p) {
    size_t value = strlen(p);
    rea_after_call++;
    return value;
}
int *rea_errno(void) {
    int *p = __errno_location();
    rea_after_call++;
    return p;
}
void rea_unknown(void) {
    rea_unknown_stop();
    rea_after_call++;
}
void rea_abort(void) { abort(); }
void rea_unwind(void *p) { _Unwind_Resume(p); }
void rea_local_stop(void) { __builtin_trap(); }
int rea_local_return(void) { return 1658; }
