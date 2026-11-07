import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "vitest";

test("SAZ verification preserves source identities, duplicate headers and encoded empty bodies", () => {
  const moduleUrl = new URL(
    "../../tests/support/analysis-efficiency/saz-entry.mjs",
    import.meta.url,
  ).href;
  const source = `
    import assert from 'node:assert/strict';
    import {verifySazRecords,verifySazOracleIdentity,sazRequest,sazEvidenceParameters} from ${JSON.stringify(moduleUrl)};
    const omitted=sazRequest('xbox-clear_nomp.saz','/tmp/sample.saz','baseline');
    assert.equal(Object.hasOwn(omitted,'record_ordinals'),false);
    assert.deepEqual(sazEvidenceParameters(omitted,3),{capture_path:'/tmp/sample.saz',format:'saz',record_ordinals:[0,1,2],sensitive_value_count:0});
    assert.deepEqual(sazEvidenceParameters(sazRequest('xbox-clear_nomp.saz','/tmp/sample.saz','focused'),13).record_ordinals,[12,0,6]);
    const empty={bytes:0,sha256:'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',content_base64:'',text:''};
    const raw=[12,0,6].map(ordinal=>{
      const session_id=String(ordinal+1).padStart(2,'0');
      return {ordinal,session_id,members:['raw/'+session_id+'_c.txt','raw/'+session_id+'_s.txt'],
        request:{member:'raw/'+session_id+'_c.txt',method:'GET',url:'/',http_version:'HTTP/1.1',headers:[],body:empty},
        response:{member:'raw/'+session_id+'_s.txt',status:'200',reason:'OK',http_version:'HTTP/1.1',headers:[{name:'Content-Type',value:' text/plain'},{name:'content-type',value:''}],body:empty}};
    });
    const oracle={kind:'saz',artifact:'xbox-clear_nomp.saz',sha256:'3e808663a99cbb9160186f7419633248200fbc6863d2c897f5d4d9972dde0375',total_records:13,record_ordinals:[12,0,6],records:raw};
    const rows=raw.map(row=>({ordinal:row.ordinal,location:{kind:'archive-members',members:row.members},
      reported:{session_id:row.session_id,request:{...row.request,body:''},response:{...row.response,body:''}},
      binary_fields:['request','response'].map(side=>({pointer:'/'+side+'/body',representation:'producer-bytes',state:'retained',...empty}))}));
    verifySazOracleIdentity('xbox-clear_nomp.saz',oracle);
    const facts=verifySazRecords(rows,oracle);assert.deepEqual(facts.map(row=>row.ordinal),[12,0,6]);
    assert.equal(facts[0].response.content_types.length,2);
    assert.throws(()=>verifySazRecords(rows.slice(1),oracle),/coverage/);
    assert.throws(()=>verifySazRecords(rows.toReversed(),oracle),/order/);
    const changed=mutate=>{const copy=structuredClone(rows);mutate(copy);return copy;};
    assert.throws(()=>verifySazRecords(changed(copy=>copy[1].reported.session_id='1'),oracle),/identity/);
    assert.throws(()=>verifySazRecords(changed(copy=>copy[0].reported.response.headers.pop()),oracle),/Content-Type/);
    assert.throws(()=>verifySazRecords(changed(copy=>copy[0].binary_fields[1].content_base64='WA=='),oracle),/encoded body/);
    assert.throws(()=>verifySazRecords(changed(copy=>copy[0].reported.response=null),oracle));
    assert.throws(()=>verifySazRecords(changed(copy=>copy[0].location.members=['raw/other_s.txt']),oracle),/coordinates/);
    assert.throws(()=>verifySazOracleIdentity('xbox-clear_nomp.saz',{...oracle,sha256:'a'.repeat(64)}),/corpus/);
    assert.throws(()=>sazRequest('__proto__','/tmp/sample.saz','focused'),/pinned/);
  `;
  // Checker-only synthesized rows; actual-provider verification is separate.
  const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: source,
    encoding: "utf8",
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
