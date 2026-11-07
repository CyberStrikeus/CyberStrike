/** Build real PE TLS samples with Zig, then inspect through the public CLI. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const zig = process.env.REA_ZIG ?? "zig";
const root = await mkdtemp(join(tmpdir(), "rea-pe-load-config-"));
try {
  const source = join(root, "tls.c");
  await writeFile(
    source,
    `
#include <stdint.h>
char tls_start __attribute__((section(".tls$AAA"))) = 0;
__declspec(thread) volatile int tls_value __attribute__((section(".tls$BBB"))) = 7;
char tls_end __attribute__((section(".tls$ZZZ"))) = 0;
unsigned long _tls_index;
static void __stdcall callback(void *module, unsigned long reason, void *reserved) {
  (void)module; (void)reason; (void)reserved;
}
typedef void (__stdcall *callback_type)(void *, unsigned long, void *);
callback_type callbacks[] __attribute__((section(".CRT$XLB"), used)) = {callback, 0};
struct tls_directory {
  uintptr_t start, end, index, callbacks;
  uint32_t zero_fill, characteristics;
};
const struct tls_directory _tls_used __attribute__((used)) = {
  (uintptr_t)&tls_start, (uintptr_t)&tls_end,
  (uintptr_t)&_tls_index, (uintptr_t)callbacks, 0, 0
};
void entry(void) {}
`,
  );
  for (const [target, bits] of [
    ["x86_64-windows-gnu", 64],
    ["x86-windows-gnu", 32],
  ]) {
    const binary = join(root, `${target}.exe`);
    execFileSync(
      zig,
      [
        "cc",
        "-target",
        target,
        "-fms-extensions",
        "-nostdlib",
        "-Wl,--entry,entry",
        source,
        "-o",
        binary,
      ],
      {
        stdio: "inherit",
        timeout: 120000,
        env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: join(root, "zig-cache") },
      },
    );
    const output = execFileSync(
      process.execPath,
      [resolve("scripts/rea.mjs"), "inspect-pe-load-config", binary, "--json"],
      { encoding: "utf8", timeout: 30000 },
    );
    const evidence = JSON.parse(output);
    const report = evidence.normalized_result;
    assert.equal(report.bits, bits);
    assert.ok(report.tls.callbacks.length > 0);
    assert.ok(
      report.tls.callbacks.every((callback) => callback.file_offset !== null),
    );
    console.log(
      JSON.stringify({
        target,
        callbacks: report.tls.callbacks,
        load_config_present: report.load_config !== null,
      }),
    );
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
