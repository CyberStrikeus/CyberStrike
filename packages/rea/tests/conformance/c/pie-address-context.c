__attribute__((noinline)) int rea_pie_add(int value) {
    return value + 7;
}

int rea_pie_entry(void) {
    return rea_pie_add(35);
}
