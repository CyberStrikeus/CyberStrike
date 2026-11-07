import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { z } from "zod";
import { fileURLToPath } from "node:url";

type Delivery = "complete" | "summary";
type Observation = {
  evidence_id: string;
  parent_evidence_id?: string;
  limitations: string[];
  kind?: string;
  view?: { kind: string; facet?: string; offset?: number; limit?: number };
  coverage?:
    | string
    | {
        examined: number;
        total: number;
        next_offset: number | null;
        exhausted: boolean;
      };
  unknowns?: string[];
};
type Fixture = {
  summary: {
    artifact: string;
    delivery: Delivery;
    provider_search_path_sha256: string;
    calls: unknown[];
    packet_selection?: string;
    signal_selection?: string;
  };
  answer: {
    capture: { coverage: string; capture_start: null };
    http_request_uris_first2: string[];
    delivery_observations: Observation[];
    facts?: {
      kind: string;
      matching_packets?: number;
      rows?: { frame: number }[];
      bytes?: number[];
    };
  };
};
const reportSchema = z.object({
  facts_match: z.boolean(),
  settings_match: z.boolean(),
  fact_differences: z.array(z.string()),
  preserved_run_specific_values: z.array(z.object({ value: z.unknown() })),
});

// Synthetic measurement directories exercise the comparator CLI, not providers.
const observation = (kind: string): Observation => ({
  evidence_id: `ev_${kind}`,
  parent_evidence_id: "ev_parent",
  limitations: ["saved bytes only"],
  kind,
  view:
    kind === "summary"
      ? { kind }
      : { kind, facet: "http-uris", offset: 0, limit: 2 },
  coverage: { examined: 2, total: 3, next_offset: 2, exhausted: false },
  unknowns: ["unrecorded traffic"],
});
const fixture = (delivery: Delivery, artifact: string): Fixture => ({
  summary: {
    artifact,
    delivery,
    provider_search_path_sha256: "a".repeat(64),
    calls: [],
  },
  answer: {
    capture: { coverage: "complete", capture_start: null },
    http_request_uris_first2: [
      "http://example.test/one",
      "http://example.test/two",
    ],
    delivery_observations:
      delivery === "summary"
        ? [observation("summary"), observation("pcap")]
        : [
            {
              evidence_id: "ev_complete",
              limitations: ["saved bytes only"],
              coverage: "complete",
            },
          ],
  },
});
function compare(left: Fixture, right: Fixture) {
  const root = mkdtempSync(join(tmpdir(), "rea-compare-test-"));
  try {
    const directories = [join(root, "left"), join(root, "right")] as const;
    for (const [index, value] of [left, right].entries()) {
      const directory = directories[index];
      assert.ok(directory);
      mkdirSync(directory);
      for (const name of ["summary", "answer"] as const)
        writeFileSync(
          join(directory, `${name}.json`),
          JSON.stringify(value[name]),
        );
    }
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            "../../tests/support/analysis-efficiency/compare.mjs",
            import.meta.url,
          ),
        ),
        "--left",
        directories[0],
        "--right",
        directories[1],
      ],
      { encoding: "utf8" },
    );
    assert.ifError(result.error);
    assert.equal(result.stderr, "");
    return {
      status: result.status,
      report: reportSchema.parse(JSON.parse(result.stdout)),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const artifact of [
  "wireshark-pgsql-jdbc.pcap",
  "wireshark-dns.cap",
  "wireshark-dhcp.pcap",
]) {
  test(`${artifact}: compare requested facts across packet plans and preserve observations`, () => {
    const left = fixture("complete", artifact);
    left.summary.packet_selection = "baseline";
    left.answer.facts = {
      kind: "packet",
      matching_packets: 1337,
      rows: [{ frame: 9 }],
    };
    const right = structuredClone(left);
    right.summary.packet_selection = "focused";
    right.answer.delivery_observations[0]!.evidence_id = "ev_focused";
    right.answer.delivery_observations[0]!.coverage =
      "up-to-input-packet-limit";
    const equivalent = compare(left, right);
    assert.equal(equivalent.status, 0);
    assert.equal(equivalent.report.facts_match, true);
    assert.deepEqual(
      equivalent.report.preserved_run_specific_values.map((row) => row.value),
      [left.answer.delivery_observations, right.answer.delivery_observations],
    );
    right.answer.facts!.matching_packets = 1338;
    assert.equal(compare(left, right).report.facts_match, false);
    right.answer.facts!.matching_packets = 1337;
    right.summary.packet_selection = "baseline";
    assert.equal(compare(left, right).report.facts_match, false);
  });
}

for (const artifact of ["sigrok-uart-max3232e.sr", "sigrok-i2c-nunchuk.sr"]) {
  test(`${artifact}: compare decoded facts across signal plans and preserve display scope`, () => {
    const left = fixture("complete", artifact);
    left.summary.signal_selection = "baseline";
    left.answer.facts = { kind: "signal", bytes: [72, 101] };
    const right = structuredClone(left);
    right.summary.signal_selection = "focused";
    right.answer.delivery_observations[0]!.coverage =
      "selected annotation lines";
    const equivalent = compare(left, right);
    assert.equal(equivalent.status, 0);
    assert.equal(equivalent.report.facts_match, true);
    assert.deepEqual(
      equivalent.report.preserved_run_specific_values.map((row) => row.value),
      [left.answer.delivery_observations, right.answer.delivery_observations],
    );
    right.answer.facts!.bytes![0] = 73;
    assert.equal(compare(left, right).report.facts_match, false);
    right.answer.facts!.bytes![0] = 72;
    right.summary.signal_selection = "baseline";
    assert.equal(compare(left, right).report.facts_match, false);
  });
}

for (const artifact of [
  "wireshark-http.cap",
  "wireshark-http_redirects.pcapng",
]) {
  test(`${artifact}: repeated modes ignore only receipt IDs`, () => {
    for (const delivery of ["complete", "summary"] as const) {
      const left = fixture(delivery, artifact);
      const right = structuredClone(left);
      for (const value of right.answer.delivery_observations) {
        value.evidence_id += "_second";
        if (typeof value.parent_evidence_id === "string")
          value.parent_evidence_id += "_second";
      }
      const { status, report } = compare(left, right);
      assert.equal(status, 0);
      assert.equal(report.facts_match, true);
      assert.deepEqual(
        report.preserved_run_specific_values.map((value) => value.value),
        [left.answer.delivery_observations, right.answer.delivery_observations],
      );
    }
  });

  test(`${artifact}: repeated modes reject stable observation changes`, () => {
    for (const delivery of ["complete", "summary"] as const) {
      const left = fixture(delivery, artifact);
      const mutations: ((values: Observation[]) => void)[] = [
        (values) => values[0]!.limitations.push("new limitation"),
        (values) => {
          values[0]!.coverage = "partial";
        },
        (values) => {
          delete values[0]!.coverage;
        },
      ];
      if (delivery === "summary")
        mutations.push(
          (values) => {
            values[1]!.view!.offset = 1;
          },
          (values) => {
            const coverage = values[1]!.coverage;
            assert.ok(typeof coverage === "object" && coverage !== null);
            coverage.next_offset = null;
          },
          (values) => values[1]!.unknowns!.push("extra unknown"),
          (values) => values.reverse(),
        );
      for (const mutate of mutations) {
        const right = structuredClone(left);
        mutate(right.answer.delivery_observations);
        const { status, report } = compare(left, right);
        assert.equal(status, 1);
        assert.equal(report.settings_match, true);
        assert.equal(report.facts_match, false);
        assert.deepEqual(report.fact_differences, ["delivery_observations"]);
      }
    }
  });

  test(`${artifact}: different modes preserve their different receipt scopes`, () => {
    const left = fixture("complete", artifact);
    const right = fixture("summary", artifact);
    const { status, report } = compare(left, right);
    assert.equal(status, 0);
    assert.equal(report.facts_match, true);
    assert.deepEqual(
      report.preserved_run_specific_values.map((value) => value.value),
      [left.answer.delivery_observations, right.answer.delivery_observations],
    );
    right.answer.capture.coverage = "partial";
    assert.equal(compare(left, right).report.facts_match, false);
  });
}
