import { expect } from "vitest";
import { processTest } from "../../support/process/processFixture.js";

processTest(
  "retains a DOM verifier profile until browser cleanup can be retried",
  async ({ processes }) => {
    const script = new URL(
      "../../../scripts/verify-browser-dom-destinations.mjs",
      import.meta.url,
    );
    const source = `
    import assert from 'node:assert/strict';
    import { existsSync } from 'node:fs';
    import { registerHooks } from 'node:module';
    let profile;
    let allowClose = false;
    let closeAttempts = 0;
    let siteAttempts = 0;
    globalThis.domVerifierLauncher = async (path) => {
      profile = path;
      return {
        pages: () => [{
          goto: async () => undefined,
          evaluate: async () => { throw new Error('native oracle failed'); },
        }],
        close: async () => {
          closeAttempts++;
          assert.equal(existsSync(profile), true);
          if (!allowClose) throw new Error('browser close denied');
        },
      };
    };
    globalThis.domVerifierSite = async () => ({
      origin: 'http://127.0.0.1',
      close: async () => { siteAttempts++; throw new Error('site close denied'); },
    });
    const moduleUrl = (source) => 'data:text/javascript,' + encodeURIComponent(source);
    const hooks = registerHooks({
      resolve(specifier, context, next) {
        if (context.parentURL === ${JSON.stringify(script.href)}) {
          if (specifier === 'playwright-core')
            return { shortCircuit: true, url: moduleUrl('export const chromium = { launchPersistentContext: globalThis.domVerifierLauncher };') };
          if (specifier === './fixtures/browser-verifier-site.mjs')
            return { shortCircuit: true, url: moduleUrl('export const startBrowserVerifierSite = globalThis.domVerifierSite;') };
          if (specifier === './lib/windows-ordinary-user-verifier.mjs')
            return { shortCircuit: true, url: moduleUrl('export async function requireOrdinaryWindowsVerifierCaller() {}') };
        }
        return next(specifier, context);
      },
    });
    let failure;
    try { await import(${JSON.stringify(script.href)}); }
    catch (cause) { failure = cause; }
    finally { hooks.deregister(); }
    assert.ok(failure instanceof AggregateError);
    assert.equal(failure.errors[0].message, 'native oracle failed');
    assert.equal(failure.errors[2].message, 'site close denied');
    assert.equal(siteAttempts, 1);
    assert.equal(existsSync(profile), true);
    const browserFailure = failure.errors[1];
    assert.ok(browserFailure.cleanupLeases.length > 0);
    await assert.rejects(browserFailure.cleanupLeases[0].release(), /browser close denied/);
    assert.equal(existsSync(profile), true);
    allowClose = true;
    await browserFailure.cleanupLeases[0].release();
    await browserFailure.cleanupLeases[0].release();
    assert.equal(closeAttempts, 3);
    assert.equal(existsSync(profile), false);
    console.log('cleanup retried');
  `;
    const result = await processes.run(
      process.execPath,
      ["--input-type=module", "--eval", source],
      {
        env: { ...process.env, REA_BROWSER_EXECUTABLE: "fixture-chrome" },
        timeoutMs: 15_000,
      },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("cleanup retried");
  },
);
