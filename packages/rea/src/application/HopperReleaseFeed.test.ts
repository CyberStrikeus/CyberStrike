import { describe, expect, it } from "vitest";

import {
  parseLinuxHopperReleases,
  parseMacHopperReleases,
  parseHopperReleaseJson,
} from "./HopperReleaseFeed.js";

const release = {
  version: "99.2.1",
  filename:
    "https://www.hopperapp.com:443/downloader/public/Hopper-99.2.1-Linux-demo.deb",
  file_length: "123",
  file_hash: "a".repeat(40),
  main_exe_hash: "b".repeat(64),
  signature: "AQ==",
  public: "1",
  beta: "0",
  published_at: "preserved vendor field",
};

describe("Linux Hopper release feed boundary", () => {
  it("preserves future release identity and partial platform facts", () => {
    const parsed = parseLinuxHopperReleases({
      "Ubuntu / Mint": release,
      "OS X": { signature: "Sparkle DSA" },
    });
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        deb: { ok: true, value: release },
        rpm: { ok: false },
        arch: { ok: false },
      },
    });
    if (!parsed.ok || !parsed.value.deb.ok) throw new Error("Missing release");
    expect(parsed.value.deb.value.filename).toBe(release.filename);
  });

  it.each([
    { signature: undefined },
    { signature: "AQ==garbage" },
    { main_exe_hash: "b".repeat(40) },
    { file_length: "100000001" },
    { file_length: "NaN" },
    { public: "0" },
    { beta: "1" },
    {
      filename:
        "https://other.example/downloader/public/Hopper-99.2.1-Linux-demo.deb",
    },
    { filename: release.filename + "?token=caller" },
    { filename: release.filename + "?" },
    { filename: release.filename + "#" },
    { filename: release.filename + "?#" },
    { filename: release.filename + "#selection" },
    {
      filename: release.filename.replace("https://", "https://user:password@"),
    },
    { filename: release.filename.replace(".deb", ".rpm") },
    { filename: release.filename.replace("demo.deb", "full.deb") },
  ])(
    "rejects metadata outside the selected public package contract: %j",
    (changes) => {
      expect(
        parseLinuxHopperReleases({
          "Ubuntu / Mint": { ...release, ...changes },
        }),
      ).toMatchObject({
        ok: true,
        value: { deb: { ok: false, error: { reason: "release_metadata" } } },
      });
    },
  );

  it.each([null, [], "html error page"])(
    "keeps malformed feed roots unknown",
    (raw) => {
      expect(parseLinuxHopperReleases(raw)).toMatchObject({
        ok: false,
        error: { reason: "release_metadata" },
      });
    },
  );
});

it("retains complete vendor release rows including own special keys and nested observations", () => {
  const row: unknown = JSON.parse(
    JSON.stringify(release).replace(
      /\}$/u,
      ',"__proto__":{"observed":true},"constructor":"vendor constructor","nested":[{"__proto__":"nested fact","future":null}]}',
    ),
  );
  const parsed = parseLinuxHopperReleases({ "Ubuntu / Mint": row });
  if (!parsed.ok || !parsed.value.deb.ok) throw new Error("Missing release");
  expect(JSON.stringify(parsed.value.deb.value)).toBe(JSON.stringify(row));
  expect(Object.hasOwn(parsed.value.deb.value, "__proto__")).toBe(true);
  expect(Object.hasOwn(parsed.value.deb.value, "constructor")).toBe(true);
});

it("retains the full selected macOS release row", () => {
  const row: unknown = JSON.parse(
    '{"filename":"https://www.hopperapp.com:443/downloader/public/Hopper-demo.dmg","file_length":"123","file_hash":"' +
      "a".repeat(40) +
      '","__proto__":{"observed":true},"constructor":"vendor constructor","nested":[{"__proto__":"nested fact"}]}',
  );
  const parsed = parseMacHopperReleases({ "OS X": row });
  if (!parsed.ok) throw new Error("Missing release");
  expect(JSON.stringify(parsed.value)).toBe(JSON.stringify(row));
  expect(Object.hasOwn(parsed.value, "__proto__")).toBe(true);
});

it("distinguishes malformed UTF-8 from a genuine replacement character and tolerates the initial BOM", () => {
  expect(
    parseHopperReleaseJson(
      new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]),
    ).ok,
  ).toBe(false);
  for (const bom of ["", "\uFEFF"])
    expect(
      parseHopperReleaseJson(new TextEncoder().encode(bom + '{"x":"雪�"}')),
    ).toMatchObject({ ok: true, value: { x: "雪�" } });
});

describe("macOS Hopper public download channel", () => {
  const macRelease = {
    filename: "https://www.hopperapp.com:443/downloader/public/Hopper-demo.dmg",
    file_length: "123",
    file_hash: "a".repeat(40),
  };

  it.each([
    "https://www.hopperapp.com/downloader/public/Hopper-demo.dmg",
    "https://WWW.HOPPERAPP.COM:443/downloader/public/Hopper-demo.dmg",
    "https://www.hopperapp.com:443/downloader/public/Hopper%20demo.dmg",
  ])("preserves the admitted source spelling %s", (filename) => {
    expect(
      parseMacHopperReleases({ "OS X": { ...macRelease, filename } }),
    ).toEqual({ ok: true, value: { ...macRelease, filename } });
  });

  it.each([
    "https://www.hopperapp.com:443/downloader/public/../private/Hopper-demo.dmg",
    "https://www.hopperapp.com:443/downloader/public/%2e%2e/private/Hopper-demo.dmg",
    "https://www.hopperapp.com:443/downloader/public/Hopper-demo.dmg?",
    "https://www.hopperapp.com:443/downloader/public/Hopper-demo.dmg#",
    "https://user:password@www.hopperapp.com:443/downloader/public/Hopper-demo.dmg",
    "https://other.example/downloader/public/Hopper-demo.dmg",
    "http://www.hopperapp.com/downloader/public/Hopper-demo.dmg",
  ])("rejects a URL outside the public channel: %s", (filename) => {
    expect(
      parseMacHopperReleases({ "OS X": { ...macRelease, filename } }),
    ).toMatchObject({ ok: false, error: { reason: "release_metadata" } });
  });
});
