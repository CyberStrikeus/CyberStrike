"""Deterministic RPC receipt failures; not real-provider or model evidence."""
import json
from pathlib import Path
import subprocess
import unittest


class RetainedQueryReceipts(unittest.TestCase):
    def run_node(self, body):
        module = Path(__file__).with_name('retained-query-calls.mjs').resolve().as_uri()
        finalizer = Path(__file__).with_name('retained-query-finalization.mjs').resolve().as_uri()
        source = ('import assert from "node:assert/strict";\n'
                  'const {createRetainedQueryCaller} = await import(' + json.dumps(module) + ');\n'
                  'const {finalizeRetainedQueryReceipt} = await import(' + json.dumps(finalizer) + ');\n' + body)
        result = subprocess.run(['node', '--input-type=module', '-'], input=source,
                                text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)

    def run_finalization(self, body):
        self.run_node('''
import {mkdtemp,mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Writable} from 'node:stream';
import {finished} from 'node:stream/promises';
const root=await mkdtemp(join(tmpdir(),'rea-receipt-test-'));
const account=join(root,'account');const output=join(root,'output');
await mkdir(account);await mkdir(output);
const chunks=[];
const stdout=new Writable({write(chunk,encoding,done){chunks.push(chunk.toString());done();}});
const serverLog=new Writable({write(chunk,encoding,done){done();}});
const serverLogFinished=finished(serverLog);serverLogFinished.catch(()=>{});
const originalFailure={name:'Error',message:'original request failed'};
const report={status:'failed',failure:originalFailure,calls:[{phase:'page',elapsed_ms:17}]};
const input={report,client:{close:async()=>{}},transport:{close:async()=>{}},
  account,output,stdout,serverLog,serverLogFinished};
const saved=async()=>JSON.parse(await readFile(join(output,'report.json'),'utf8'));
try {
''' + body + '''
} finally {
  serverLog.destroy();await serverLogFinished.catch(()=>{});stdout.destroy();
  await rm(root,{recursive:true,force:true});
}
''')

    def test_rejected_call_preserves_request_phase_cost_and_original_failure(self):
        self.run_node('''
const failure = new Error('owned server closed');
const input = {offset:0, limit:2}; const rows=[]; const events=[];
const call = createRetainedQueryCaller({callTool:async request=>{
  assert.strictEqual(request.arguments,input);throw failure;
}}, async(row,event)=>{rows.push(row);events.push(event);});
await assert.rejects(call('list_unknowns',input,'resume-2'), e=>e===failure);
assert.equal(rows.length,1);assert.equal(events.length,1);
assert.strictEqual(rows[0].input,input);assert.equal(rows[0].name,'list_unknowns');
assert.equal(rows[0].phase,'resume-2');assert.ok(rows[0].elapsed_ms>=0);
assert.equal(rows[0].reply_bytes,null);assert.equal(rows[0].is_error,true);
assert.deepEqual(events[0].failure,{name:'Error',message:'owned server closed'});
''')

    def test_protocol_error_is_a_received_reply_with_known_bytes(self):
        self.run_node('''
const reply={isError:true,content:[{type:'text',text:'capacity refusal'}]};const rows=[];
const call=createRetainedQueryCaller({callTool:async()=>reply},async row=>rows.push(row));
assert.strictEqual(await call('get_evidence_bundle',{},'complete'),reply);
assert.equal(rows.length,1);assert.equal(rows[0].is_error,true);
assert.equal(rows[0].reply_bytes,Buffer.byteLength(JSON.stringify(reply)));
assert.equal(Object.hasOwn(rows[0],'failure'),false);
''')

    def test_receipt_write_error_does_not_reclassify_a_completed_rpc(self):
        self.run_node('''
const failure=new Error('receipt disk unavailable');const rows=[];
const call=createRetainedQueryCaller({callTool:async()=>({content:[]})},async row=>{
  rows.push(row);throw failure;
});
await assert.rejects(call('list_unknowns',{},'read'),e=>e===failure);
assert.equal(rows.length,1);assert.equal(rows[0].is_error,false);
assert.equal(Object.hasOwn(rows[0],'failure'),false);
''')

    def test_failed_recording_preserves_the_prior_rpc_failure(self):
        self.run_node('''
const rpc=new Error('request timeout');const disk=new Error('receipt close failed');
const call=createRetainedQueryCaller({callTool:async()=>{throw rpc;}},async()=>{throw disk;});
await assert.rejects(call('inspect_analysis_view',{},'selected'),e=>
  e instanceof AggregateError && e.errors[0]===rpc && e.errors[1]===disk);
''')

    def test_log_stream_failure_keeps_costs_both_receipts_and_workspace(self):
        self.run_finalization('''
const log=new Writable({write(chunk,encoding,done){done(new Error('log disk failed'));}});
const logFinished=finished(log);logFinished.catch(()=>{});log.write('diagnostic');
assert.equal(await finalizeRetainedQueryReceipt({...input,serverLog:log,
  serverLogFinished:logFinished}),false);
assert.match(report.cleanup_failures[0],/server-log:.*log disk failed/);
assert.strictEqual(report.failure,originalFailure);
assert.equal(report.calls[0].elapsed_ms,17);assert.equal(report.retained_workspace,account);
assert.equal((await stat(account)).isDirectory(),true);
assert.deepEqual(await saved(),report);assert.deepEqual(JSON.parse(chunks.join('')),report);
''')

    def test_workspace_removal_error_still_writes_the_original_failure(self):
        self.run_finalization('''
const blocked=join(root,'owned-file');await writeFile(blocked,'owned');
const malformedAccount=join(blocked,'child');
assert.equal(await finalizeRetainedQueryReceipt({...input,account:malformedAccount}),false);
assert.match(report.cleanup_failures[0],/^workspace:/);
assert.equal(report.retained_workspace,malformedAccount);
assert.deepEqual((await saved()).failure,originalFailure);
assert.deepEqual(JSON.parse(chunks.join('')),report);
''')

    def test_transcript_failure_cannot_skip_cleanup_or_lose_original_failure(self):
        self.run_finalization('''
await mkdir(join(output,'transcript.json'));
const closed=[];
assert.equal(await finalizeRetainedQueryReceipt({...input,transcript:[{phase:'page'}],
  client:{close:async()=>{closed.push('client');}},
  transport:{close:async()=>{closed.push('transport');}}}),false);
assert.deepEqual(closed,['client','transport']);
assert.equal(serverLog.writableEnded,true);
await assert.rejects(stat(account),error=>error.code==='ENOENT');
assert.deepEqual(report.cleanup_failures,[]);
assert.match(report.receipt_failures[0],/^transcript-file:/);
assert.strictEqual(report.failure,originalFailure);
assert.equal(report.calls[0].elapsed_ms,17);
assert.deepEqual(await saved(),report);assert.deepEqual(JSON.parse(chunks.join('')),report);
''')

    def test_report_file_refusal_preserves_the_stdout_receipt(self):
        self.run_finalization('''
await mkdir(join(output,'report.json'));
assert.equal(await finalizeRetainedQueryReceipt(input),false);
assert.deepEqual(report.cleanup_failures,[]);
assert.match(report.receipt_failures[0],/^report-file:/);
assert.deepEqual(JSON.parse(chunks.join('')),report);
assert.deepEqual(report.failure,originalFailure);
''')

    def test_stdout_write_error_is_handled_and_saved_in_the_file(self):
        self.run_finalization('''
const failedStdout=new Writable({write(chunk,encoding,done){done(new Error('broken pipe'));}});
assert.equal(await finalizeRetainedQueryReceipt({...input,stdout:failedStdout}),false);
assert.match(report.receipt_failures[0],/stdout:.*broken pipe/);
assert.deepEqual(await saved(),report);assert.deepEqual(report.failure,originalFailure);
''')

    def test_partial_retry_after_stdout_failure_preserves_the_prior_receipt(self):
        self.run_finalization('''
const fs=await import('node:fs/promises');
const {syncBuiltinESMExports}=await import('node:module');
const originalWrite=fs.default.writeFile;let writes=0;let before;
fs.default.writeFile=async(...args)=>{
  if(++writes===2){await originalWrite(args[0],'partial',args[2]);throw new Error('disk quota');}
  return originalWrite(...args);
};
syncBuiltinESMExports();
try {
  const failedStdout=new Writable({async write(chunk,encoding,done){
    before=await readFile(join(output,'report.json'),'utf8');done(new Error('broken pipe'));
  }});
  assert.equal(await finalizeRetainedQueryReceipt({...input,stdout:failedStdout}),false);
  assert.equal(writes,2);assert.equal(report.receipt_failures.length,2);
  assert.match(report.receipt_failures[1],/report-file-retry:.*disk quota/);
  assert.equal(await readFile(join(output,'report.json'),'utf8'),before);
  assert.deepEqual((await saved()).failure,originalFailure);
  assert.equal((await saved()).calls[0].elapsed_ms,17);
} finally {fs.default.writeFile=originalWrite;syncBuiltinESMExports();}
''')

    def test_failed_client_close_keeps_ownership_and_attempts_peer_cleanup(self):
        self.run_finalization('''
const closed=[];
assert.equal(await finalizeRetainedQueryReceipt({...input,
  client:{close(){closed.push('client');throw new Error('close failed');}},
  transport:{close:async()=>{closed.push('transport');}}}),false);
assert.deepEqual(closed,['client','transport']);
assert.match(report.cleanup_failures[0],/client:.*close failed/);
assert.equal(report.retained_workspace,account);assert.equal(serverLog.writableEnded,true);
assert.equal((await stat(account)).isDirectory(),true);
assert.deepEqual(await saved(),report);assert.deepEqual(JSON.parse(chunks.join('')),report);
''')

    def test_setup_failure_without_acquired_resources_still_publishes_receipts(self):
        self.run_finalization('''
assert.equal(await finalizeRetainedQueryReceipt({report,output,stdout,transcript:[]}),true);
assert.deepEqual(report.cleanup_failures,[]);
assert.deepEqual((await saved()).failure,originalFailure);
assert.deepEqual(JSON.parse(await readFile(join(output,'transcript.json'),'utf8')),[]);
assert.ok((await stat(account)).isDirectory());
''')

    def test_partial_setup_closes_acquired_transport_and_releases_its_workspace(self):
        self.run_finalization('''
let closed=0;
assert.equal(await finalizeRetainedQueryReceipt({report,output,stdout,account,
  transport:{close:async()=>{closed++;}}}),true);
assert.equal(closed,1);
await assert.rejects(stat(account),{code:'ENOENT'});
assert.deepEqual((await saved()).failure,originalFailure);
assert.deepEqual(report.cleanup_failures,[]);
''')
