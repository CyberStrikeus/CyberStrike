import { afterEach, expect, it, vi } from "vitest";

import { downloadHopperPackage } from "../../src/application/HopperDownload.js";

afterEach(() => vi.unstubAllGlobals());
const redirect = (location: string, cancelled: () => void) =>
  new Response(new ReadableStream({ cancel: cancelled }), {
    status: 302,
    headers: { location },
  });

it("refuses an HTTPS downgrade before sending the redirected request and releases its body", async () => {
  let cancelled = 0;
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    redirect("http://www.hopperapp.com/package", () => {
      cancelled++;
    }),
  );
  vi.stubGlobal("fetch", fetch);
  expect(
    await downloadHopperPackage("https://www.hopperapp.com/package"),
  ).toEqual({ ok: false, bytes: new Uint8Array() });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    "https://www.hopperapp.com/package",
    expect.objectContaining({ redirect: "manual" }),
  );
  expect(cancelled).toBe(1);
});

it("preserves HTTPS relative and cross-origin redirects under one request deadline", async () => {
  let cancelled = 0;
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      redirect("/next", () => {
        cancelled++;
      }),
    )
    .mockResolvedValueOnce(
      redirect("https://downloads.hopperapp.com/final", () => {
        cancelled++;
      }),
    )
    .mockResolvedValueOnce(new Response("package"));
  vi.stubGlobal("fetch", fetch);
  const selected = "https://www.hopperapp.com:443/start#selected";
  const result = await downloadHopperPackage(selected);
  expect(result.ok).toBe(true);
  expect(new TextDecoder().decode(result.bytes)).toBe("package");
  expect(fetch.mock.calls.map(([input]) => input)).toEqual([
    selected,
    "https://www.hopperapp.com/next#selected",
    "https://downloads.hopperapp.com/final#selected",
  ]);
  const signal = fetch.mock.calls[0]?.[1]?.signal;
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(
    fetch.mock.calls.every(([, options]) => options?.signal === signal),
  ).toBe(true);
  expect(cancelled).toBe(2);
});

it("retains Fetch's twenty-redirect bound and releases every redirect response", async () => {
  let cancelled = 0;
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () =>
    redirect("/loop", () => {
      cancelled++;
    }),
  );
  vi.stubGlobal("fetch", fetch);
  expect(
    (await downloadHopperPackage("https://www.hopperapp.com/loop")).ok,
  ).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(21);
  expect(cancelled).toBe(21);
});

it("refuses an initial non-HTTPS URL before any request", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal("fetch", fetch);
  expect(
    (await downloadHopperPackage("http://www.hopperapp.com/package")).ok,
  ).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
