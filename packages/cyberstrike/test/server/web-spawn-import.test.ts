import { describe, expect, test } from "bun:test"

// The spawn-profile route does `await import("@cyberstrike-io/hackbrowser/v2-spawn")`
// at request time. This proves that cross-package import RESOLVES at runtime (not just
// under typecheck) and that the imported module builds the exact args a spawned role
// browser needs — everything up to the actual Bun.spawn, which is NOT exercised (it
// would open a real Chrome window).
describe("@cyberstrike-io/hackbrowser/v2-spawn — runtime import from cyberstrike", () => {
  test("resolves and exports callable spawn helpers", async () => {
    const m = await import("@cyberstrike-io/hackbrowser/v2-spawn")
    expect(typeof m.spawnProfile).toBe("function")
    expect(typeof m.buildProfileArgs).toBe("function")
    expect(typeof m.defaultExtensionPath).toBe("function")
  })

  test("builds the role browser's args + hash the way the route calls it", async () => {
    const m = await import("@cyberstrike-io/hackbrowser/v2-spawn")
    // Same shape the route passes: cred=role, session=sessionID. Fake browser so we
    // never spawn; real extension dir so the manifest check passes.
    const built = m.buildProfileArgs({
      url: "https://target.example.com",
      cred: "admin",
      session: "ses_1",
      browser: "/fake/Chrome",
      extPath: m.defaultExtensionPath(),
    })
    expect(built.args[built.args.length - 1]).toBe("https://target.example.com#__cs_cred=admin&__cs_sess=ses_1")
    // Session-scoped profile dir (hb2-profile-<session>-<cred>) — a fresh per-session profile is
    // the fix for stale MV3 service workers in a reused persistent profile.
    expect(built.profileDir).toEndWith("hb2-profile-ses_1-admin")
    expect(built.args.some((a) => a.startsWith("--load-extension="))).toBe(true)
  })
})
