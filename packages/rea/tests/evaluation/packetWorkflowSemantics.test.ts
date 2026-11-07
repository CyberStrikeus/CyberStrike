import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "vitest";

test("packet page verification rejects skipped matches with unchanged counts and monotone frames", () => {
  const moduleUrl = new URL(
    "../../tests/support/analysis-efficiency/packet-entry.mjs",
    import.meta.url,
  ).href;
  const source = `
    import assert from 'node:assert/strict';
    import {verifyPacketPage} from ${JSON.stringify(moduleUrl)};
    const rows = Array.from({length:36}, (_,i)=>({frame:i+1, source_port:1000,destination_port:5432,flags:16}));
    const sha256 = 'a'.repeat(64);
    const report = (selected)=>({artifact:{sha256},output_window:{matching_packets:36},packets:selected.map(row=>({
      'frame.number':[String(row.frame)],'tcp.srcport':['1000'],'tcp.dstport':['5432'],'tcp.flags':['0x0010']
    }))});
    const oracle={sha256,matching_packets:36,rows:rows.slice(0,24)};
    const first=report(rows.slice(0,12));
    verifyPacketPage(first,report(rows.slice(12,24)),oracle);
    assert.throws(()=>verifyPacketPage(first,report(rows.slice(24,36)),oracle),/independently parsed/);
    assert.throws(()=>verifyPacketPage(first,report(rows.slice(12,24).reverse()),oracle),/independently parsed/);
    assert.throws(()=>verifyPacketPage(first,{...report(rows.slice(12,24)),artifact:{sha256:'b'.repeat(64)}},oracle),/independently parsed/);
  `;
  // Semantic checker only; synthetic rows do not establish provider behavior.
  const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: source,
    encoding: "utf8",
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
