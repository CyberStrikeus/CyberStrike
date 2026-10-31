/* Source-owned freestanding analysis fixture. Never execute this target. */
volatile unsigned int rea_riscv_global = 7;
extern unsigned int rea_riscv_probe(unsigned int value);

__attribute__((noinline)) unsigned int rea_riscv_leaf(unsigned int value)
{
    return value * 3u + rea_riscv_global;
}

__attribute__((noinline)) double rea_riscv_float(double left, double right)
{
    return left + right;
}

__attribute__((noinline)) unsigned int rea_riscv_entry(unsigned int selector)
{
    return rea_riscv_probe(rea_riscv_leaf(selector + 1u));
}
