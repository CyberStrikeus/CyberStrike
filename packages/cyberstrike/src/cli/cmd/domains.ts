import { cmd } from "./cmd"
import { Instance } from "../../project/instance"
import { Plugin } from "../../plugin"
import { providerHealth, formatHealthReport } from "../../cloud/provider-health"
import { discoverDomains } from "../../cloud/domain-discovery"
import { EOL } from "os"
import type { Argv } from "yargs"

// `cyberstrike domains` — the diagnostic surface behind the domain-plugin
// architecture: what is installed, what loaded, and what is wrong. Loading the
// plugins first (Plugin.list) forces every domain to register so the health
// report reflects the live registry, then discovery shows installed packages
// (including incompatible / malformed ones the loader skipped).
const DomainsListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list installed security domains and their health",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        await Plugin.list() // force plugin/domain load → registry populated
        const health = await providerHealth()
        const discovery = await discoverDomains()

        process.stdout.write(formatHealthReport(health) + EOL)

        if (discovery.found.length || discovery.errors.length) {
          process.stdout.write(EOL + "Discovered packages (project node_modules):" + EOL)
          for (const d of discovery.found) {
            const tier = d.manifest.tier ? ` [${d.manifest.tier}]` : ""
            const api = d.manifest.coreApi ? ` core>=${d.manifest.coreApi}` : ""
            const mark = d.compatible ? "✓" : "✗"
            const why = d.compatible ? "" : ` — ${d.reason}`
            process.stdout.write(`  ${mark} ${d.name}${tier}${api}${why}` + EOL)
          }
          for (const e of discovery.errors) {
            process.stdout.write(`  ! ${e.name} — ${e.error}` + EOL)
          }
        }
      },
    })
  },
})

const DomainsInfoCommand = cmd({
  command: "info <name>",
  describe: "show the manifest of an installed domain package",
  builder: (yargs: Argv) =>
    yargs.positional("name", {
      type: "string",
      describe: "package name (e.g. @cyberstrike-io/azure)",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const discovery = await discoverDomains()
        const found = discovery.found.find((d) => d.name === args.name)
        if (!found) {
          const bad = discovery.errors.find((e) => e.name === args.name)
          if (bad) {
            process.stderr.write(`${args.name}: ${bad.error}` + EOL)
            process.exit(1)
          }
          process.stderr.write(`domain package not found in project node_modules: ${args.name}` + EOL)
          process.exit(1)
        }
        process.stdout.write(`${found.name}` + EOL)
        process.stdout.write(`  dir:        ${found.dir}` + EOL)
        process.stdout.write(`  tier:       ${found.manifest.tier ?? "(unset)"}` + EOL)
        process.stdout.write(`  coreApi:    ${found.manifest.coreApi ?? "(any)"}` + EOL)
        process.stdout.write(`  compatible: ${found.compatible ? "yes" : `no — ${found.reason}`}` + EOL)
        process.stdout.write(`  domains:    ${(found.manifest.domains ?? []).join(", ") || "(none declared)"}` + EOL)
        process.stdout.write(`  tools:      ${(found.manifest.tools ?? []).join(", ") || "(none declared)"}` + EOL)
      },
    })
  },
})

export const DomainsCommand = cmd({
  command: "domains",
  describe: "manage security domains (plugin packages)",
  builder: (yargs) => yargs.command(DomainsListCommand).command(DomainsInfoCommand).demandCommand(),
  async handler() {},
})
