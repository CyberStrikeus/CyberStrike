/* Freestanding GameCube DOL fixture, source-owned static-analysis input. Never executed by REA. */
volatile unsigned int rea_dol_global = 0x11223344u;
unsigned int rea_dol_zero[4];
__attribute__((section(".dol_tail"), used)) unsigned int rea_dol_tail[4] = {1u, 2u, 3u, 4u};
