import { expect, it } from "vitest";

import {
  DEFAULT_NATIVE_COMMAND_TIMEOUT_MS,
  DEFAULT_NATIVE_UI_DEADLINE_MS,
  DEFAULT_PWNTOOLS_TIMEOUT_MS,
  MAX_NATIVE_TIMER_MS,
  nativeCommandTimeoutField,
  nativeUiDeadlineField,
  pwntoolsTimeoutField,
  readNativeDeadline,
} from "./nativeDeadlines.js";

it("keeps today's omitted native deadlines and the shared timer range", () => {
  expect(DEFAULT_NATIVE_COMMAND_TIMEOUT_MS).toBe(60_000);
  expect(DEFAULT_NATIVE_UI_DEADLINE_MS).toBe(180_000);
  expect(DEFAULT_PWNTOOLS_TIMEOUT_MS).toBe(30_000);
  expect(MAX_NATIVE_TIMER_MS).toBe(2_147_483_647);
  for (const field of [
    nativeCommandTimeoutField,
    nativeUiDeadlineField,
    pwntoolsTimeoutField,
  ]) {
    expect(field.safeParse(undefined).success).toBe(true);
    expect(field.safeParse(1).success).toBe(true);
    expect(field.safeParse(MAX_NATIVE_TIMER_MS).success).toBe(true);
    expect(field.safeParse(0).success).toBe(false);
    expect(field.safeParse(MAX_NATIVE_TIMER_MS + 1).success).toBe(false);
    expect(field.safeParse(1.5).success).toBe(false);
  }
});

it("reads an omitted deadline as the caller-supplied default", () => {
  expect(readNativeDeadline(undefined, 60_000)).toEqual({
    ok: true,
    timeoutMs: 60_000,
  });
  expect(readNativeDeadline(2_500, 60_000)).toEqual({
    ok: true,
    timeoutMs: 2_500,
  });
  expect(readNativeDeadline(0, 60_000)).toMatchObject({
    ok: false,
    reason: "out_of_range",
  });
  expect(readNativeDeadline("60000", 60_000)).toMatchObject({
    ok: false,
    reason: "invalid_type",
  });
});
