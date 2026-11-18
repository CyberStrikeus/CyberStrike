import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { Glob } from "bun"
import { COMMANDS, type CommandSurface } from "@cyberstrike-io/sdk/v2/commands"

// The command catalog (@cyberstrike-io/sdk/v2 COMMANDS) is the single source of truth for which
// surfaces offer each UI command — its `surfaces` field literally reads "A surface MUST register
// every id that lists it". Nothing ENFORCED that, so a command added to one surface's registry (the
// web app, or the TUI) but not the other drifted silently — the recurring "it's in the web palette
// but /stats never showed up in the TUI" bug. This test makes that drift a hard failure: it scans
// each surface's actual registration sites and asserts registered ids == catalog `surfaces` exactly.
//
// When you add a command: add it to the catalog with the right `surfaces`, then register it in EACH
// listed surface. When you intentionally scope one to a single surface, set `surfaces` to just that
// surface — this test then keeps the others honest instead of letting a half-wired command slip in.

const here = import.meta.dir

// Where each surface's code lives. Scanned WHOLE — not a hand-listed set of files — so a command
// registered in a newly-added file can never slip the net and read as "missing" (the logs-export
// trap). Command entries key off `value: "<id>"` in the TUI (opentui `command.register`) and
// `id: "<id>"` in the web app (SolidJS). i18n catalogs only hold translated titles, and desktop-menu
// only BINDS to ids — neither registers, so both are excluded.
const SURFACE_ROOT: Record<CommandSurface, string> = {
  tui: `${here}/../src/cli/cmd/tui`,
  web: `${here}/../../app/src`,
}
const ID_KEY: Record<CommandSurface, RegExp> = {
  tui: /value:\s*"([^"]+)"/g,
  web: /id:\s*"([^"]+)"/g,
}
const EXCLUDE = /(^|\/)(i18n|desktop-menu)[./]|\.test\./

const catalogIds = new Set(COMMANDS.map((c) => c.id))

// The catalog ids a surface actually registers (ignore the surface's own non-command value/id strings
// by intersecting with the catalog).
function registered(surface: CommandSurface): Set<string> {
  const out = new Set<string>()
  for (const rel of new Glob("**/*.{ts,tsx}").scanSync(SURFACE_ROOT[surface])) {
    if (EXCLUDE.test(rel)) continue
    const src = readFileSync(`${SURFACE_ROOT[surface]}/${rel}`, "utf8")
    for (const m of src.matchAll(ID_KEY[surface])) if (catalogIds.has(m[1]!)) out.add(m[1]!)
  }
  return out
}

describe("command catalog ↔ surface registration parity (single source of truth)", () => {
  const surfaces: CommandSurface[] = ["tui", "web"]
  const live = { tui: registered("tui"), web: registered("web") } as Record<CommandSurface, Set<string>>

  for (const surface of surfaces) {
    test(`${surface}: every command declaring surface "${surface}" is registered, and no extra`, () => {
      const declared = new Set(COMMANDS.filter((c) => c.surfaces.includes(surface)).map((c) => c.id))
      const actual = live[surface]
      const missing = [...declared].filter((id) => !actual.has(id)).sort() // in catalog for this surface, not registered
      const extra = [...actual].filter((id) => !declared.has(id)).sort() // registered but catalog doesn't list this surface
      expect({ surface, missing, extra }).toEqual({ surface, missing: [], extra: [] })
    })
  }
})
