// A real initialized data range, with independently recognizable endpoints.
volatile unsigned char rea_large_payload[REA_PAYLOAD_BYTES] = {
    [0] = 0x5a, [REA_PAYLOAD_BYTES - 1] = 0xa5};

__attribute__((noinline, used)) int rea_large_entry(void) {
  return rea_large_payload[0] + rea_large_payload[REA_PAYLOAD_BYTES - 1];
}

int main(void) { return rea_large_entry(); }
