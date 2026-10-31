import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "vitest";

test("signal verification rejects skipped identical UART bytes and reordered I2C samples", () => {
  const moduleUrl = new URL(
    "../../tests/support/analysis-efficiency/signal-entry.mjs",
    import.meta.url,
  ).href;
  const source = `
    import assert from 'node:assert/strict';
    import {verifySignalRows,signalDataRows,verifySignalOracleIdentity} from ${JSON.stringify(moduleUrl)};
    const sha256='a'.repeat(64);
    const rows=Array.from({length:8},(_,i)=>({start:i*100+10,end:i*100+80,byte:72}));
    const uart={kind:'uart',sha256,total_samples:2000,rows:rows.map((_,i)=>({start:i*100,end_exclusive:i*100+90,first_data_sample:i*100+15,last_data_sample:i*100+75,byte:72}))};
    verifySignalRows('uart',rows,uart,sha256);
    verifySignalRows('uart',rows.map((row,i)=>({...row,start:i*100+15,end:i*100+75})),uart,sha256);
    assert.throws(()=>verifySignalRows('uart',[{...rows[0],start:0,end:0},...rows.slice(1)],uart,sha256),/interval/);
    assert.throws(()=>verifySignalRows('uart',[{...rows[0],end:74},...rows.slice(1)],uart,sha256),/interval/);
    assert.throws(()=>verifySignalRows('uart',[{...rows[0],start:16},...rows.slice(1)],uart,sha256),/interval/);
    assert.throws(()=>verifySignalRows('uart',rows,{...uart,rows:uart.rows.map(({first_data_sample,...row})=>row)},sha256),/interval/);
    assert.throws(()=>verifySignalRows('uart',rows.slice(1).concat({start:810,end:880,byte:72}),uart,sha256),/interval/);
    assert.throws(()=>verifySignalRows('uart',rows.slice(1),uart,sha256),/coverage/);
    assert.throws(()=>verifySignalRows('uart',rows,uart,'b'.repeat(64)),/identity/);
    const data=Array.from({length:18},(_,i)=>({start:i*100+10,end:i*100+90,byte:117}));
    const raw=data.map((_,i)=>({byte:117,first_clock:i*100+20,last_clock:i*100+80}));
    const i2c={kind:'i2c',sha256,total_samples:2000,reads:[{bytes:[{byte:165,last_clock:0},...raw],stop:1900}]};
    verifySignalRows('i2c',data,i2c,sha256);
    assert.throws(()=>verifySignalRows('i2c',data.toReversed(),i2c,sha256),/interval/);
    assert.throws(()=>verifySignalRows('i2c',[{...data[0],byte:118},...data.slice(1)],i2c,sha256),/sample bits/);
    assert.throws(()=>verifySignalRows('i2c',data.map((row,i)=>({...row,start:i,end:1999})),i2c,sha256),/interval/);
    assert.throws(()=>verifySignalRows('i2c',[{...data[0],start:0},...data.slice(1)],i2c,sha256),/interval/);
    assert.throws(()=>verifySignalRows('i2c',[...data.slice(0,-1),{...data.at(-1),end:1900}],i2c,sha256),/interval/);
    verifySignalOracleIdentity('sigrok-uart-max3232e.sr',{kind:'uart',sha256:'f797d60d6b8e12d2a1549b9a5a499ef389f44cb9e870e8610af26b57c3b2be76'});
    assert.throws(()=>verifySignalOracleIdentity('sigrok-uart-max3232e.sr',uart),/pinned signal corpus/);
    assert.throws(()=>verifySignalOracleIdentity('sigrok-i2c-nunchuk.sr',{kind:'uart',sha256:'0fa6adb8297d7f3fe5ba19c94ee655c9b0f952a8b5e48a17aaa499a2f6d10d70'}),/pinned signal corpus/);
    assert.throws(()=>signalDataRows('uart','9007199254740993-9007199254740994 uart-1: 48'),/sample interval/);
  `;
  // Checker semantics only; synthesized rows do not establish provider behavior.
  const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: source,
    encoding: "utf8",
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
