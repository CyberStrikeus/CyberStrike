import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect } from "vitest";

import { workspaceCliTest } from "../support/cli/workspaceCliFixture.js";

workspaceCliTest(
  "preserves successful TOON text across CLI token pages",
  async ({ processes, workspace }) => {
    const fileName = `${"😀é".repeat(20)}.plist`;
    const plist = workspace.path(fileName);
    await writeFile(
      plist,
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ` +
        `"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
        `<plist version="1.0"><dict>` +
        `<key>Long</key><string>${"abcdefghij".repeat(300)}</string>` +
        `<key>Emoji</key><string>${"😀é".repeat(300)}</string>` +
        `</dict></plist>`,
    );
    const run = async (filter: string, ...window: string[]) =>
      processes.run(
        process.execPath,
        [
          resolve("scripts/rea.mjs"),
          "inspect-artifact",
          plist,
          "--format",
          "toon",
          "--filter-output",
          filter,
          ...window,
        ],
        {
          cwd: workspace.root,
          env: { PATH: process.env.PATH ?? "", REA_LOG_LEVEL: "silent" },
        },
      );

    const fullDigest = await run("subject.digest.sha256");
    expect(
      fullDigest.exitCode,
      `${fullDigest.stderr}\n${fullDigest.stdout}`,
    ).toBe(0);
    const firstPage = await run(
      "subject.digest.sha256",
      "--token-limit",
      "10",
      "--token-offset",
      "0",
    );
    expect(firstPage.exitCode, firstPage.stderr).toBe(0);
    const firstMarker = firstPage.stdout.match(
      /\n\[truncated: showing tokens 0–10 of (\d+)\]\n?$/,
    );
    expect(firstMarker).not.toBeNull();
    const total = Number(firstMarker?.[1]);
    let joinedDigest = "";
    for (let offset = 0; offset < total; offset += 10) {
      const page =
        offset === 0
          ? firstPage
          : await run(
              "subject.digest.sha256",
              "--token-limit",
              "10",
              "--token-offset",
              String(offset),
            );
      expect(page.exitCode, page.stderr).toBe(0);
      joinedDigest += page.stdout.replace(
        /\n\[truncated: showing tokens \d+–\d+ of \d+\]\n?$/,
        "",
      );
    }
    expect(joinedDigest).toBe(fullDigest.stdout.trimEnd());

    // Artifact inspection exposes the actual Unicode filename on every platform.
    const fullName = await run("subject.name");
    expect(fullName.exitCode, fullName.stderr).toBe(0);
    expect(fullName.stdout).toContain(fileName);
    let joinedName = "";
    let nameTotal = Number.POSITIVE_INFINITY;
    for (let offset = 0; offset < nameTotal; offset += 7) {
      const page = await run(
        "subject.name",
        "--token-limit",
        "7",
        "--token-offset",
        String(offset),
      );
      expect(page.exitCode, page.stderr).toBe(0);
      const marker = page.stdout.match(
        /\n\[truncated: showing tokens \d+–\d+ of (\d+)\]\n?$/,
      );
      expect(marker).not.toBeNull();
      nameTotal = Number(marker?.[1]);
      const body = page.stdout.slice(0, marker?.index);
      expect(body.length).toBeGreaterThan(0);
      expect(body).not.toContain("\uFFFD");
      joinedName += body;
    }
    expect(joinedName).toBe(fullName.stdout.trimEnd());
  },
);
