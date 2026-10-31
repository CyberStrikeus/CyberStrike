import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it as test } from "vitest";
import { ProviderCleanupError } from "../../../../src/domain/providerCleanupError.js";
import { fakeKunaCalls, setFakeKunaBehavior } from "./fakeKuna.js";
import { session } from "./kunaSessionFixture.js";

const it = test.skipIf(process.platform === "win32");

const gatedInstallation = async () => {
  const fixture = await session("rea-kuna-installation-cancel-");
  const gate = join(fixture.root, "release-version");
  await setFakeKunaBehavior(fixture.kuna, {
    version: { stdout: "kuna 1.833\n", gate },
  });
  const started = async () => {
    await expect
      .poll(async () => (await fakeKunaCalls(fixture.kuna)).length)
      .toBe(2);
    const call = (await fakeKunaCalls(fixture.kuna))[1];
    if (call === undefined) throw new Error("Missing version probe");
    return call;
  };
  return {
    ...fixture,
    started,
    release: () => writeFile(gate, "release"),
  };
};

const gone = (pid: number) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause;
    return true;
  }
};

it("lets one caller leave acquisition with its exact reason while a peer keeps the probe", async () => {
  const fixture = await gatedInstallation();
  const client = fixture.open();
  const controller = new AbortController();
  const reason = new ProviderCleanupError("foreign", ["foreign-owner"], {});
  const leaving = client.execute("health", {}, { signal: controller.signal });
  const peer = client.execute("health", {});
  let settled = false;
  void leaving.then(() => {
    settled = true;
  });
  try {
    const probe = await fixture.started();
    controller.abort(reason);
    await expect.poll(() => settled, { timeout: 1500 }).toBe(true);
    const result = await leaving;
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error).toMatchObject({
      _tag: "AnalysisCancelledError",
      cleanupIncomplete: false,
    });
    expect(result.error.cause).toBe(reason);
    expect(gone(probe.pid)).toBe(false);
    await fixture.release();
    expect((await peer).ok).toBe(true);
    expect((await fakeKunaCalls(fixture.kuna)).length).toBe(2);
    expect(reason.cleanupIncomplete).toBe(true);
  } finally {
    await fixture.release();
    await Promise.all([leaving, peer]);
    expect((await client.close()).ok).toBe(true);
  }
});

it.each([null, "caller stopped"])(
  "joins the final caller's probe stop before retrying: %j",
  async (reason) => {
    const fixture = await gatedInstallation();
    const client = fixture.open();
    const controller = new AbortController();
    const pending = client.execute("health", {}, { signal: controller.signal });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    try {
      const probe = await fixture.started();
      controller.abort(reason);
      await expect.poll(() => settled, { timeout: 1500 }).toBe(true);
      const result = await pending;
      if (result.ok) throw new Error("Expected cancellation");
      expect(result.error).toMatchObject({
        _tag: "AnalysisCancelledError",
        cleanupIncomplete: false,
      });
      expect(result.error.cause).toBe(reason);
      expect(gone(probe.pid)).toBe(true);
      await fixture.release();
      expect((await client.execute("health", {})).ok).toBe(true);
      expect((await fakeKunaCalls(fixture.kuna)).length).toBe(3);
    } finally {
      await fixture.release();
      await pending;
      expect((await client.close()).ok).toBe(true);
    }
  },
);

it("close cancels and joins an installation probe while callers wait", async () => {
  const fixture = await gatedInstallation();
  const client = fixture.open();
  const pending = client.execute("health", {});
  let closed = false;
  let closing: ReturnType<typeof client.close> | undefined;
  try {
    const probe = await fixture.started();
    closing = client.close();
    void closing.then(() => {
      closed = true;
    });
    await expect.poll(() => closed, { timeout: 1500 }).toBe(true);
    expect((await closing).ok).toBe(true);
    const result = await pending;
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(gone(probe.pid)).toBe(true);
  } finally {
    await fixture.release();
    await Promise.all([pending, closing]);
    expect((await client.close()).ok).toBe(true);
  }
});
