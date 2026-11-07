/* Relocatable (ET_REL) static-analysis fixture, built with -c -G0 and never
 * executed or linked by REA. It exercises the relocations Linux MIPS kernel
 * modules use: R_MIPS_26 calls, HI16/LO16 address pairs (one HI16 shared by
 * several LO16s, two HI16s resolved by one LO16, and a LO16 >= 0x8000 that
 * forces a HI16 carry), R_MIPS_32
 * data words, and undefined external code and data symbols. powf is an
 * external whose float prototype Ghidra's C library archive supplies by name,
 * so soft-float builds must give it the soft-float prototype too.
 */
extern int rea_mips_rel_external(int value);
extern int rea_mips_rel_external_data;
extern float powf(float base, float exponent);

struct rea_mips_rel_pair {
    int first;
    int second;
};

struct rea_mips_rel_pair rea_mips_rel_pair = { 0x1111, 0x2222 };
/* Places rea_mips_rel_carry past a signed 16-bit low-half boundary. */
char rea_mips_rel_padding[0x8000] = { 1 };
int rea_mips_rel_carry = 0x3333;
/* Referenced only by rea_mips_rel_highs, so its single LO16 stays unique. */
int rea_mips_rel_highs_target = 0x4444;
static const char rea_mips_rel_marker[] = "rea-mips-relocatable-fixture";

__attribute__((noinline)) int rea_mips_rel_leaf(int value)
{
    return value * 3 + rea_mips_rel_pair.first + rea_mips_rel_pair.second;
}

__attribute__((noinline, long_call)) int rea_mips_rel_far(int value);

int rea_mips_rel_far(int value)
{
    return value + rea_mips_rel_marker[value & 7] + rea_mips_rel_carry;
}

int (*const rea_mips_rel_table[])(int) = {
    rea_mips_rel_leaf,
    rea_mips_rel_far,
    rea_mips_rel_external,
};

__attribute__((noinline)) int rea_mips_rel_scaled(int value)
{
    float scaled = powf(1.5f, 2.5f);
    return value ^ *(int *)&scaled;
}

/* Most GCC-built kernel modules checked contain LO16s that resolve several
 * pending HI16s; Clang does not produce that from C. Two %hi and exactly one
 * %lo of a symbol nothing else references: any assembler that orders each
 * HI16 before a matching LO16 (GNU as, every LLVM version) must emit both
 * HI16s ahead of that single LO16, which therefore resolves both.
 */
__asm__(".text\n"
        ".globl rea_mips_rel_highs\n"
        ".type rea_mips_rel_highs, @function\n"
        ".set push\n"
        ".set noreorder\n"
        "rea_mips_rel_highs:\n"
        "    lui $2, %hi(rea_mips_rel_highs_target)\n"
        "    lui $3, %hi(rea_mips_rel_highs_target)\n"
        "    addiu $2, $2, %lo(rea_mips_rel_highs_target)\n"
        "    jr $31\n"
        "    move $3, $2\n"
        ".set pop\n"
        ".size rea_mips_rel_highs, .-rea_mips_rel_highs\n");

int rea_mips_rel_entry(int value)
{
    return rea_mips_rel_leaf(value) + rea_mips_rel_far(value) +
        rea_mips_rel_external(value) + rea_mips_rel_external_data +
        rea_mips_rel_table[value & 1](value) + rea_mips_rel_scaled(value);
}
