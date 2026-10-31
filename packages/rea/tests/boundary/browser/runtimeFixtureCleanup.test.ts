import { execFile } from "node:child_process";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform === "win32")(
  "rejects an exited fixture before returning a lease and removes its profile",
  async () => {
    const root = await createTestTempDirectory("rea-runtime-startup-failure-");
    const helper = new URL(
      "../../../scripts/lib/browser-runtime-fixture-lifecycle.mjs",
      import.meta.url,
    );
    const script = `
      const { startRuntimeFixtureBrowser } = await import(${JSON.stringify(helper.href)});
      // Node rejects Chrome's arguments immediately, exercising actual process exit.
      try {
        const fixture = await startRuntimeFixtureBrowser(process.execPath, 'http://127.0.0.1');
        await fixture.close();
        throw new Error('Expected startup failure');
      } catch (error) {
        if (error._tag !== 'BrowserStartupError') throw error;
        console.log(JSON.stringify({
          failure: error.failure,
          exitCode: error.exitCode,
          stderr: error.stderr,
        }));
      }
    `;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root },
        timeout: 10_000,
      },
    );
    expect(JSON.parse(stdout)).toEqual({
      failure: "exited",
      exitCode: expect.any(Number),
      stderr: expect.stringContaining("bad option"),
    });
    expect(await readdir(root)).toEqual([]);
  },
);

it.skipIf(process.platform === "win32")(
  "retains browser ownership after denied cleanup and retries the whole process group",
  async () => {
    const root = await createTestTempDirectory("rea-runtime-owned-browser-");
    const executable = await writeFixtureBrowser(root);
    const helper = new URL(
      "../../../scripts/lib/browser-runtime-fixture-lifecycle.mjs",
      import.meta.url,
    );
    const script = `
      import assert from 'node:assert/strict';
      import { existsSync, readFileSync } from 'node:fs';
      import { join } from 'node:path';
      const { startRuntimeFixtureBrowser } = await import(${JSON.stringify(helper.href)});
      const fixture = await startRuntimeFixtureBrowser(${JSON.stringify(executable)}, 'http://127.0.0.1');
      const descendant = Number(readFileSync(join(fixture.profile, 'descendant'), 'utf8'));
      fixture.process.emit('error', Object.assign(new Error('late EPERM fixture'), { code: 'EPERM' }));
      const kill = process.kill;
      let denied = false;
      process.kill = function(pid, signal) {
        if (pid < 0 && signal !== 0) {
          denied = true;
          throw Object.assign(new Error('denied fixture group cleanup'), { code: 'EPERM' });
        }
        return kill(pid, signal);
      };
      try {
        await assert.rejects(fixture.close(), /incomplete/);
        assert.equal(denied, true);
        assert.equal(existsSync(fixture.profile), true);
        assert.ok(fixture.process.listenerCount('error') > 0);
      } finally {
        process.kill = kill;
        await fixture.close();
      }
      assert.equal(existsSync(fixture.profile), false);
      assert.equal(fixture.process.listenerCount('error'), 0);
      const { createSystemProcessOwnershipHost } = await import(${JSON.stringify(new URL("../../../dist/process/ProcessOwnershipObservation.js", import.meta.url).href)});
      const { liveProcesses } = await import(${JSON.stringify(new URL("../../../dist/process/ProcessOwnershipProcessTree.js", import.meta.url).href)});
      const live = liveProcesses(await createSystemProcessOwnershipHost().listProcesses());
      assert.equal(live.some(item => item.pid === fixture.process.pid || item.pid === descendant), false);
      // The process may finish while the separately owned socket still needs retry.
      const { CdpConnection } = await import(${JSON.stringify(new URL("../../../dist/browser/CdpConnection.js", import.meta.url).href)});
      const { WebSocketServer } = await import('ws');
      const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
      await new Promise(resolve => server.once('listening', resolve));
      server.on('connection', socket => socket.on('message', data => {
        const { id } = JSON.parse(data.toString());
        socket.send(JSON.stringify({ id, result: {} }));
      }));
      const connect = CdpConnection.connect;
      let connections = 0;
      let closeAttempts = 0;
      let socketOwner;
      CdpConnection.connect = async function(...args) {
        connections++;
        args[0] = 'ws://127.0.0.1:' + server.address().port + '/devtools/browser/fixture';
        const onConnected = args[4];
        args[4] = (connection) => {
          socketOwner = connection;
          const close = connection.close.bind(connection);
          connection.close = async () => {
            closeAttempts++;
            if (closeAttempts === 1) throw new Error('denied socket close');
            await close();
          };
          onConnected?.(connection);
        };
        return connect.apply(this, args);
      };
      const socketFixture = await startRuntimeFixtureBrowser(${JSON.stringify(executable)}, 'http://127.0.0.1');
      try {
        await assert.rejects(socketFixture.close(), cause => hasFailure(cause, 'denied socket close'));
        assert.ok(socketFixture.process.exitCode !== null || socketFixture.process.signalCode !== null);
        assert.equal(existsSync(socketFixture.profile), true);
        assert.ok(socketOwner, 'Acquire ownership before the WebSocket handshake');
        assert.equal(server.clients.size, 1, 'Failed socket close must keep its actual open transport');
        await socketFixture.close();
        assert.equal(connections, 1, 'Retry must reuse the exact retained socket');
        assert.equal(closeAttempts, 2);
        assert.equal(existsSync(socketFixture.profile), false);
      } finally {
        CdpConnection.connect = connect;
        await socketFixture.close();
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }

      // A late launcher exit must preserve the sibling/descendant cleanup lease
      // even though startup never returned a browser handle.
      process.kill = function(pid, signal) {
        if (pid < 0 && signal !== 0)
          throw Object.assign(new Error('denied startup cleanup'), { code: 'EPERM' });
        return kill(pid, signal);
      };
      let startupFailure;
      try {
        await startRuntimeFixtureBrowser(${JSON.stringify(executable)}, 'http://127.0.0.1/startup-fail');
        throw new Error('Expected startup failure');
      } catch (cause) {
        startupFailure = cause;
      } finally {
        process.kill = kill;
      }
      function hasFailure(cause, message) {
        if (!cause) return false;
        return cause?.message === message || hasFailure(cause?.cause, message) ||
          (cause?.errors ?? []).some(error => hasFailure(error, message));
      }
      function findCleanupFailure(cause) {
        if (cause.cleanupLeases?.length) return cause;
        for (const error of cause.errors ?? []) {
          const found = findCleanupFailure(error);
          if (found) return found;
        }
      }
      const retained = findCleanupFailure(startupFailure);
      assert.ok(retained, 'Failed startup must retain exact cleanup authority');
      const lease = retained.cleanupLeases[0];
      const [failedProfile] = lease.cleanupResources;
      const lateDescendant = Number(readFileSync(join(failedProfile, 'descendant'), 'utf8'));
      assert.equal(existsSync(failedProfile), true);
      await lease.release();
      assert.equal(existsSync(failedProfile), false);
      const afterRetry = liveProcesses(await createSystemProcessOwnershipHost().listProcesses());
      assert.equal(afterRetry.some(item => item.pid === lateDescendant), false);
      console.log(JSON.stringify({ retried: true, descendant_removed: true, startup_retry: true, socket_retry: true }));
    `;
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      ["--input-type=module", "-e", script],
      { timeout: 15_000 },
    );
    expect(JSON.parse(stdout)).toEqual({
      retried: true,
      descendant_removed: true,
      startup_retry: true,
      socket_retry: true,
    });
    expect(stderr).toContain(
      "Browser verifier process error: late EPERM fixture",
    );
  },
);

async function writeFixtureBrowser(root: string): Promise<string> {
  const executable = join(root, "fixture-browser.cjs");
  await writeFile(
    executable,
    `#!${process.execPath}
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { createServer } = require('node:http');
const profile = process.argv.find(value => value.startsWith('--user-data-dir=')).split('=').slice(1).join('=');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
writeFileSync(join(profile, 'descendant'), String(child.pid));
if (!process.argv.at(-1).endsWith('/startup-fail')) {
  const origin = process.argv.at(-1);
  const server = createServer((req, res) => {
    const port = server.address().port;
    res.end(JSON.stringify(req.url === '/json/version'
      ? { Browser: 'Fixture/1', 'Protocol-Version': '1.3', 'User-Agent': 'Fixture', 'V8-Version': '1', 'WebKit-Version': '1', webSocketDebuggerUrl: 'ws://127.0.0.1:' + port + '/devtools/browser/fixture' }
      : [{ id: 'fixture', type: 'page', title: 'fixture', url: origin }]));
  });
  server.listen(0, '127.0.0.1', () => writeFileSync(join(profile, 'DevToolsActivePort'), String(server.address().port) + '\\n/devtools/browser/fixture'));
} else setTimeout(() => process.exit(3), 30);
console.error('owned fixture diagnostics');
setInterval(() => {}, 1000);
`,
    { mode: 0o755 },
  );
  return executable;
}
