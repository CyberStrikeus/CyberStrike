import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { keyedArchiveResultSchema } from "../../../src/domain/apple/keyedArchive.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const fixtures = {
  supported:
    "YnBsaXN0MDDUAQIDBAUGBwpZJGFyY2hpdmVyWCR2ZXJzaW9uWCRvYmplY3RzVCR0b3BfEA9OU0tleWVkQXJjaGl2ZXISAAGGoKIICVUkbnVsbFV2YWx1ZdELDFRyb290gAEIERskLTJESUxSWFtgAAAAAAAAAQEAAAAAAAAADQAAAAAAAAAAAAAAAAAAAGI=",
  offsetWidth3:
    "YnBsaXN0MDDUAQIDBAUGBwpZJGFyY2hpdmVyWCR2ZXJzaW9uWCRvYmplY3RzVCR0b3BfEA9OU0tleWVkQXJjaGl2ZXISAAGGoKIICVUkbnVsbFV2YWx1ZdELDFRyb290gAEAAAgAABEAABsAACQAAC0AADIAAEQAAEkAAEwAAFIAAFgAAFsAAGAAAAAAAAADAQAAAAAAAAANAAAAAAAAAAAAAAAAAAAAYg==",
  referenceWidth3:
    "YnBsaXN0MDDUAAABAAACAAADAAAEAAAFAAAGAAAHAAAKWSRhcmNoaXZlclgkdmVyc2lvblgkb2JqZWN0c1QkdG9wXxAPTlNLZXllZEFyY2hpdmVyEgABhqCiAAAIAAAJVSRudWxsVXZhbHVl0QAACwAADFRyb290gAEIISs0PUJUWWBmbHN4AAAAAAAAAQMAAAAAAAAADQAAAAAAAAAAAAAAAAAAAHo=",
} as const;

const expectArchive = (bytes: Buffer, result: unknown) => {
  const archive = keyedArchiveResultSchema.parse(result);
  expect(archive.archive_sha256).toBe(
    createHash("sha256").update(bytes).digest("hex"),
  );
  expect(archive.references).toContainEqual(
    expect.objectContaining({
      source: null,
      path: ["root"],
      target: 1,
      status: "resolved",
    }),
  );
  expect(archive.objects.find(({ id }) => id === 1)).toMatchObject({
    kind: "scalar",
    status: "observed",
    value: "value",
  });
};

cliTest(
  "decodes nonstandard binary-plist table widths without changing evidence",
  async ({ cli }) => {
    const directory = await createTestTempDirectory("rea-plist-table-widths-");
    const { call } = await connectLocalToolsMcp({
      HOME: directory,
      USERPROFILE: directory,
    });
    for (const [name, encoded] of Object.entries(fixtures)) {
      const bytes = Buffer.from(encoded, "base64");
      const path = join(directory, `${name}.plist`);
      await writeFile(path, bytes);
      const cliOutput = await cli.run({
        arguments: ["inspect-keyed-archive", path, "--json"],
        environment: {
          REA_LOG_LEVEL: "silent",
          HOME: directory,
          USERPROFILE: directory,
        },
      });
      expect(cliOutput.exitCode, cliOutput.stderr).toBe(0);
      const cliResult = parseEvidence(cliOutput.json).normalized_result;
      expectArchive(bytes, cliResult);

      const opened = await call("open_binary", { path });
      expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
      const mcpOutput = await call("inspect_keyed_archive", {});
      expect(mcpOutput.isError, JSON.stringify(mcpOutput)).not.toBe(true);
      const mcpResult = parseEvidence(
        mcpOutput.structuredContent,
      ).normalized_result;
      expectArchive(bytes, mcpResult);
      expect(mcpResult).toEqual(cliResult);
    }
  },
);
