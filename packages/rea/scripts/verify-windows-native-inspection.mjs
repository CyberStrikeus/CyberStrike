import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { prepareWindowsNativeInspectionWorkspace } from "./lib/windows-native-inspection-workspace.mjs";

if (process.platform !== "win32")
  throw new Error("Native inspection ownership requires real Windows NTFS");
const root = resolve(process.argv[2] ?? ".");
const artifact = resolve(
  process.argv[3] ?? ".cache/windows-native-inspection-fixture",
);
const workspace = await mkdtemp(join(tmpdir(), "rea-inspection-conformance-"));
try {
  const loader = await prepareWindowsNativeInspectionWorkspace({
    root,
    artifact,
    workspace,
  });
  const source = `import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,readFileSync,readdirSync,renameSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {systemWindowsNativeAuthority} from ${JSON.stringify(loader)};
const temp=process.env.TEMP;
const mode=process.argv[2];
const creation=mode.startsWith('create-');
const native=creation?createRequire(import.meta.url)(${JSON.stringify(join(workspace, "native", "windows", "build", "rea-windows-x64.node"))}):null;
if(creation){
 let failure;
 try{native.call('runtime_create',[temp,'rea-native-created-'])}catch(error){failure=error}
 assert.ok(failure instanceof Error,'runtime_create unexpectedly passed injected post-create validation failure');
 assert.equal(failure.constraint,'Read private DACL by handle failed');
 assert.equal(failure.win32Code,5);
 assert.equal(failure.cleanupConstraint,'Delete owned object by handle failed');
 assert.equal(failure.cleanupWin32Code,5);
 assert.notEqual(failure.runtimeAllocation,'not-started');
} else {
 const first=systemWindowsNativeAuthority();
 assert.equal(first.available,false);
 assert.equal(first.retryable,true);
 assert.match(first.reason,/Delete owned object by handle failed.*Win32 5/s);
}
const [name,...extra]=readdirSync(temp);assert.ok(name);assert.equal(extra.length,0);
const path=join(temp,name);const identity=statSync(path,{bigint:true});
// Delete sharing permits rename; ownership follows the retained NTFS handle.
writeFileSync(join(path,'owned-child.txt'),'owned child');
const renamed=path+'-renamed';renameSync(path,renamed);
const moved=statSync(renamed,{bigint:true});
assert.equal(moved.dev,identity.dev);assert.equal(moved.ino,identity.ino);
mkdirSync(path);const replacement=statSync(path,{bigint:true});
assert.notEqual(replacement.ino,identity.ino);
const sentinel=join(path,'unrelated.txt');writeFileSync(sentinel,'unrelated replacement');
if(mode==='retry'){
 const second=systemWindowsNativeAuthority();assert.equal(second.available,true);
 assert.equal(existsSync(renamed),false);
 assert.deepEqual(readdirSync(temp),[name]);
 assert.equal(readFileSync(sentinel,'utf8'),'unrelated replacement');
 assert.equal(statSync(path,{bigint:true}).ino,replacement.ino);
 assert.equal(systemWindowsNativeAuthority(),second);
} else if(mode==='create-retry') {
 const second=native.call('runtime_create',[temp,'rea-native-created-retry-']);
 assert.equal(existsSync(renamed),false);
 assert.equal(readFileSync(sentinel,'utf8'),'unrelated replacement');
 native.call('runtime_close',[second.handle]);
 assert.equal(existsSync(second.path),false);
 assert.equal(statSync(path,{bigint:true}).ino,replacement.ino);
}
console.log(JSON.stringify({mode,firstFailed:true,retainedOwner:true,name,renamed,device:identity.dev.toString(),inode:identity.ino.toString(),replacementInode:replacement.ino.toString()}));
`;
  const fixture = join(workspace, "probe.mjs");
  await writeFile(fixture, source);
  for (const mode of ["retry", "teardown", "create-retry", "create-teardown"]) {
    const temp = join(workspace, mode);
    await mkdir(temp);
    const child = spawnSync(process.execPath, [fixture, mode], {
      encoding: "utf8",
      timeout: 20_000,
      windowsHide: true,
      env: {
        ...process.env,
        TEMP: temp,
        TMP: temp,
        ...(mode.startsWith("create-")
          ? { REA_NATIVE_CREATION_FAILURE: "1" }
          : {}),
      },
    });
    if (child.error !== undefined) throw child.error;
    assert.equal(child.status, 0, child.stderr);
    assert.equal(
      child.stderr,
      "",
      "Native environment teardown reported a cleanup failure",
    );
    const observed = JSON.parse(child.stdout);
    assert.equal(observed.mode, mode);
    assert.equal(observed.firstFailed, true);
    assert.equal(observed.retainedOwner, true);
    await assert.rejects(access(observed.renamed), { code: "ENOENT" });
    assert.deepEqual(await readdir(temp), [observed.name]);
    const replacement = join(temp, observed.name);
    const identity = await stat(replacement, { bigint: true });
    assert.equal(identity.dev.toString(), observed.device);
    assert.equal(identity.ino.toString(), observed.replacementInode);
    assert.notEqual(identity.ino.toString(), observed.inode);
    assert.deepEqual(await readdir(replacement), ["unrelated.txt"]);
    assert.equal(
      await readFile(join(replacement, "unrelated.txt"), "utf8"),
      "unrelated replacement",
    );
  }
  process.stdout.write(
    `${JSON.stringify({ ok: true, inspectionPostCreateValidationFailure: true, runtimeCreatePostCreateValidationFailure: true, controlledRollbackDispositionFailure: true, retainedOwner: true, renamedOwnerCleansChildren: true, unrelatedReplacementPreserved: true, retryRecoversByInspectionAndCreation: true, successfulAdmissionCached: true, environmentTeardownCleansProbeAndCreation: true, issue1701HostCauseReproduced: false })}\n`,
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
}
