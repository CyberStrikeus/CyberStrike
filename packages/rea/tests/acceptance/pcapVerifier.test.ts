import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { parseEvidence } from "../../src/domain/evidence.js";
import { pcapResultSchemas } from "../../src/domain/pcap/pcapAnalysis.js";
import { offlineHttpCapture } from "../fixtures/pcap/offlineHttpCapture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const execute = promisify(execFile);

it.skipIf(
  process.platform !== "linux" ||
    !existsSync("/usr/bin/tshark") ||
    !existsSync("/usr/bin/capinfos"),
)(
  "verifies complete and unresolved HTTP coverage with real Wireshark tools",
  async () => {
    const root = await createTestTempDirectory("rea-pcap-verifier-test-");
    const capture = join(root, "capture.pcap");
    for (const unresolved of [false, true]) {
      await writeFile(
        capture,
        offlineHttpCapture(
          "/without-host",
          1,
          unresolved ? null : "example.test",
        ),
      );
      const environment = {
        ...process.env,
        REA_TSHARK_COMMAND: "/usr/bin/tshark",
        REA_CAPINFOS_COMMAND: "/usr/bin/capinfos",
      };
      const cli = await execute(
        process.execPath,
        ["scripts/rea.mjs", "inspect-pcap-capture", capture, "--json"],
        { env: environment, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
      );
      const result = pcapResultSchemas.inspect_pcap_capture.parse(
        parseEvidence(JSON.parse(cli.stdout)).normalized_result,
      );
      expect(result.coverage).toBe(unresolved ? "partial" : "complete");
      expect(result.http_request_uri_count).toBe(unresolved ? 0 : 1);
      expect(result.http_request_uris).toEqual(
        unresolved ? [] : ["http://example.test/without-host"],
      );
      await execute(
        process.execPath,
        ["scripts/verify-pcap.mjs", "--pcap", capture],
        {
          env: environment,
          timeout: 60_000,
          maxBuffer: 8 * 1024 * 1024,
        },
      );
    }
  },
  120_000,
);
