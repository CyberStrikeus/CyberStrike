/* Soft-float o32 storage fixture; linked with mips.c, never executed by REA.
 * Without an FPU, float/double values travel in integer registers and stack
 * slots: pick uses $a0/$a1/$a2 and returns in $v0, wide uses the $a0:$a1 pair,
 * and mixed aligns d to $a2:$a3 so f and e spill to the stack at 16 and 24.
 * structured returns through a hidden $a0 pointer, moving scale to $a1. The
 * typed function pointer makes the caller's indirect call use a prototype that
 * belongs to no function. No arithmetic, so no compiler-rt helpers are needed.
 */
volatile unsigned int rea_mips_soft_sink;

__attribute__((noinline)) float rea_mips_soft_pick(float a, float b, int sel)
{
    return sel ? a : b;
}

__attribute__((noinline)) double rea_mips_soft_wide(double a, int sel)
{
    return sel ? a : 0.5;
}

__attribute__((noinline)) double rea_mips_soft_mixed(int i, double d, float f, double e)
{
    rea_mips_soft_sink = *(volatile unsigned int *)&f;
    return i ? d : e;
}

struct rea_mips_soft_pair {
    double first;
    double second;
};

__attribute__((noinline)) struct rea_mips_soft_pair rea_mips_soft_struct(float scale, int sel)
{
    struct rea_mips_soft_pair pair = { 0.25, 0.75 };
    rea_mips_soft_sink = *(volatile unsigned int *)&scale;
    if (sel)
        pair.first = 1.25;
    return pair;
}

/* Volatile so the indirect call through this typed pointer is not folded. */
float (*volatile rea_mips_soft_callback)(float, float, int) = rea_mips_soft_pick;

__attribute__((noinline)) unsigned int rea_mips_soft_caller(int sel)
{
    float picked = rea_mips_soft_pick(1.5f, 2.5f, sel);
    double wide = rea_mips_soft_wide(3.25, sel);
    double mixed = rea_mips_soft_mixed(sel, 4.75, 5.5f, 6.125);
    struct rea_mips_soft_pair pair = rea_mips_soft_struct(7.5f, sel);
    float called = rea_mips_soft_callback(8.5f, 9.5f, sel);
    return *(unsigned int *)&picked ^ *(unsigned int *)&wide ^ *(unsigned int *)&mixed ^
        *(unsigned int *)&pair.first ^ *(unsigned int *)&called;
}
