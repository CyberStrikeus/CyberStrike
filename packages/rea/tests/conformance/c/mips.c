/* Freestanding, source-owned static-analysis fixture. Never executed by REA. */
volatile unsigned int rea_mips_global = 7;
const char rea_mips_marker[] = "rea-mips-source-owned-fixture";

__attribute__((noinline)) unsigned int rea_mips_leaf(unsigned int value)
{
    return value * 3u + rea_mips_global;
}

__attribute__((noinline)) unsigned int rea_mips_entry(unsigned int selector)
{
    unsigned int adjusted = selector > 10u ? selector : selector + 1u;
    return rea_mips_leaf(adjusted) + (unsigned char)rea_mips_marker[0];
}
