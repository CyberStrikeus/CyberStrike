import { expect, it } from "vitest";
import { inspectKernelModuleInputSchema } from "./kernelModule.js";

it("rejects extra caller arguments and applies kernel-module budgets", () => {
  expect(
    inspectKernelModuleInputSchema.safeParse({
      path: "/artifacts/demo.ko",
      extra: true,
    }).success,
  ).toBe(false);
  expect(
    inspectKernelModuleInputSchema.parse({ path: "/artifacts/demo.ko" }),
  ).toMatchObject({
    max_file_bytes: 67108864,
    max_entries: 8192,
  });
});
