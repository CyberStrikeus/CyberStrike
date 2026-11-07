typedef int (*rea_cross_callback)(int);

volatile int rea_cross_global = 7;
const volatile char rea_cross_message[] = "REA_GHIDRA_CROSS_FORMAT";

__attribute__((noinline, used)) int rea_cross_leaf(int value) {
  return value + rea_cross_global + rea_cross_message[0] - 'R';
}

__attribute__((noinline, used)) int rea_cross_branch(int value) {
  /* A volatile-dependent loop keeps this callee multi-block at every
     optimization level: newer clang folds a symmetric if/else of tail calls
     into a conditional negate, and cross-format verification requires a
     recovered multi-block callee. */
  int adjusted = value > 10 ? value + 1 : -value;
  while (adjusted > 100) {
    adjusted -= rea_cross_global;
  }
  return rea_cross_leaf(adjusted);
}

__attribute__((noinline, used)) int rea_cross_indirect(
    rea_cross_callback callback, int value) {
  return callback(value);
}

#define REA_CROSS_SWITCH_CASE(case_value) \
  case case_value:                        \
    return rea_cross_leaf(payload + case_value)

__attribute__((noinline, used)) int rea_cross_dense_switch(unsigned int selector,
                                                           int payload) {
  switch (selector) {
    REA_CROSS_SWITCH_CASE(0);
    REA_CROSS_SWITCH_CASE(1);
    REA_CROSS_SWITCH_CASE(2);
    REA_CROSS_SWITCH_CASE(3);
    REA_CROSS_SWITCH_CASE(4);
    REA_CROSS_SWITCH_CASE(5);
    REA_CROSS_SWITCH_CASE(6);
    REA_CROSS_SWITCH_CASE(7);
    REA_CROSS_SWITCH_CASE(8);
    REA_CROSS_SWITCH_CASE(9);
    REA_CROSS_SWITCH_CASE(10);
    REA_CROSS_SWITCH_CASE(11);
    REA_CROSS_SWITCH_CASE(12);
    REA_CROSS_SWITCH_CASE(13);
    REA_CROSS_SWITCH_CASE(14);
    REA_CROSS_SWITCH_CASE(15);
    REA_CROSS_SWITCH_CASE(16);
    REA_CROSS_SWITCH_CASE(17);
    REA_CROSS_SWITCH_CASE(18);
    REA_CROSS_SWITCH_CASE(19);
    REA_CROSS_SWITCH_CASE(20);
    REA_CROSS_SWITCH_CASE(21);
    REA_CROSS_SWITCH_CASE(22);
    REA_CROSS_SWITCH_CASE(23);
    REA_CROSS_SWITCH_CASE(24);
    REA_CROSS_SWITCH_CASE(25);
    REA_CROSS_SWITCH_CASE(26);
    REA_CROSS_SWITCH_CASE(27);
    REA_CROSS_SWITCH_CASE(28);
    REA_CROSS_SWITCH_CASE(29);
    REA_CROSS_SWITCH_CASE(30);
    REA_CROSS_SWITCH_CASE(31);
    REA_CROSS_SWITCH_CASE(32);
    REA_CROSS_SWITCH_CASE(33);
    REA_CROSS_SWITCH_CASE(34);
    REA_CROSS_SWITCH_CASE(35);
    REA_CROSS_SWITCH_CASE(36);
    REA_CROSS_SWITCH_CASE(37);
    REA_CROSS_SWITCH_CASE(38);
    REA_CROSS_SWITCH_CASE(39);
    default:
      return -1;
  }
}

#undef REA_CROSS_SWITCH_CASE

__attribute__((noinline, used, visibility("default"))) int rea_cross_entry(void) {
  return rea_cross_branch(35) + rea_cross_indirect(rea_cross_leaf, 0);
}

__attribute__((used, visibility("default"))) void rea_cross_start(void) {
  volatile int result = rea_cross_entry();
  (void)result;
  for (;;) {
  }
}
