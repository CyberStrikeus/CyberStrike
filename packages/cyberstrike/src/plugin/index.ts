import type { Hooks, PluginInput, Plugin as PluginInstance } from "@cyberstrike-io/plugin"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { createOpencodeClient } from "@cyberstrike-io/sdk"
import { Server } from "../server/server"
import { BunProc } from "../bun"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import { CodexAuthPlugin } from "./codex"
import { Session } from "../session"
import { NamedError } from "@cyberstrike-io/util/error"
import { CopilotAuthPlugin } from "./copilot"
import { AnthropicAuthPlugin } from "./anthropic"
import { gitlabAuthPlugin as GitlabAuthPlugin } from "@gitlab/opencode-gitlab-auth"
import { registerProvider } from "../cloud/provider-registry"
import { buildCoreRuntime } from "../cloud/core-runtime"
import { discoverDomains } from "../cloud/domain-discovery"
import { Tier } from "../tier/tier"

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  const BUILTIN: string[] = []

  // Built-in plugins that are directly imported (not installed from npm)
  const INTERNAL_PLUGINS: PluginInstance[] = [
    CodexAuthPlugin,
    CopilotAuthPlugin,
    AnthropicAuthPlugin,
    GitlabAuthPlugin as unknown as PluginInstance,
  ]

  // Free-tier security domains that ship WITH core (bundledDependencies) and load
  // by default — the user gets them out of the box, no `npm install` and no plugin
  // config. Paid domains (e.g. @cyberstrike-io/azure-pro) are user-installed via the
  // plugin config instead. Each is a normal domain plugin: it registers via the
  // `provider`/`tool` hooks and reaches core through the injected input.core.
  //
  // IMPORTANT: default domains use a STATIC import map (not `import(variable)`) so
  // Bun's compiled-binary bundler includes their code. A dynamic `import(name)` with
  // a variable string is invisible to the bundler → the package is silently missing
  // at runtime inside $bunfs → web specialists never load → inspection dispatches 0
  // child sessions. The static map fixes this while keeping the try/catch safety.
  const DEFAULT_DOMAINS: string[] = ["@cyberstrike-io/web"]
  const DEFAULT_DOMAIN_MODULES: Record<string, () => Promise<any>> = {
    "@cyberstrike-io/web": () => import("@cyberstrike-io/web"),
  }

  // Package name of a config.plugin spec (strip a trailing @version, keep the
  // scope's leading @, leave file:// specs untouched) — used to dedupe against
  // auto-discovered domains so a configured package isn't also discovery-loaded.
  function pluginPackageName(spec: string): string {
    if (spec.startsWith("file://")) return spec
    const at = spec.lastIndexOf("@")
    return at > 0 ? spec.substring(0, at) : spec
  }

  const state = Instance.state(async () => {
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
      directory: Instance.directory,
      // @ts-ignore - fetch type incompatibility
      fetch: async (...args) => Server.App().fetch(...args),
    })
    const config = await Config.get()
    const hooks: Hooks[] = []
    const input: PluginInput = {
      client,
      project: Instance.project,
      worktree: Instance.worktree,
      directory: Instance.directory,
      serverUrl: Server.url(),
      $: Bun.$,
      // Live core runtime for domain plugins that need it (e.g. @cyberstrike-io/azure)
      // — injected so they work in the compiled binary without importing the host.
      core: buildCoreRuntime(),
    }

    for (const plugin of INTERNAL_PLUGINS) {
      log.info("loading internal plugin", { name: plugin.name })
      const init = await plugin(input)
      hooks.push(init)
    }

    // Default free-tier domains — bundled with core, loaded directly (no install),
    // and given the same injected `input.core`. A broken default domain must not
    // take down the host, so its failure is logged and skipped.
    for (const name of DEFAULT_DOMAINS) {
      try {
        const loader = DEFAULT_DOMAIN_MODULES[name]
        if (!loader) { log.warn("no static loader for default domain", { name }); continue }
        const mod: any = await loader()
        const init = typeof mod?.default === "function" ? mod.default : mod
        hooks.push(await init(input))
      } catch (err) {
        log.error("failed to load default domain", { name, error: err })
      }
    }

    // Auto-discovered domains — packages installed in the project's node_modules
    // that declare a `cyberstrike` manifest (domain-discovery.ts). This makes
    // `npm install @cyberstrike-io/<domain>` "just work" with no plugin config.
    // Skip anything already loaded (bundled defaults) or explicitly configured
    // (loaded by the config loop below) so nothing loads twice. Incompatible or
    // broken domains are skipped — visible via `cyberstrike domains`, never fatal.
    const configuredNames = new Set((config.plugin ?? []).map(pluginPackageName))
    const discovery = await discoverDomains({ skip: [...DEFAULT_DOMAINS, ...configuredNames] })
    for (const domain of discovery.found) {
      if (!domain.compatible) {
        log.warn("skipping incompatible discovered domain", { name: domain.name, reason: domain.reason })
        continue
      }
      // Tier gate (issue #35): the free/public build refuses pro/enterprise domains
      // (aws/azure/gcp/oracle/etc.); raising CYBERSTRIKE_TIER unlocks them.
      const domainTier = domain.manifest.tier ?? "free"
      if (!Tier.allows(domainTier)) {
        log.info("skipped domain above active tier", { name: domain.name, tier: domainTier, active: Tier.active() })
        continue
      }
      try {
        const mod: any = await import(domain.dir)
        const init = typeof mod?.default === "function" ? mod.default : mod
        hooks.push(await init(input))
        log.info("loaded discovered domain", { name: domain.name, tier: domain.manifest.tier })
      } catch (err) {
        log.error("failed to load discovered domain", { name: domain.name, error: err })
      }
    }
    for (const bad of discovery.errors) {
      log.warn("ignoring package with a malformed cyberstrike manifest", { name: bad.name, error: bad.error })
    }

    let plugins = config.plugin ?? []
    if (plugins.length) await Config.waitForDependencies()
    if (!Flag.CYBERSTRIKE_DISABLE_DEFAULT_PLUGINS) {
      plugins = [...BUILTIN, ...plugins]
    }

    for (let plugin of plugins) {
      // ignore old codex plugin since it is supported first party now
      if (plugin.includes("cyberstrike-openai-codex-auth") || plugin.includes("cyberstrike-copilot-auth")) continue
      log.info("loading plugin", { path: plugin })
      if (!plugin.startsWith("file://")) {
        const lastAtIndex = plugin.lastIndexOf("@")
        const pkg = lastAtIndex > 0 ? plugin.substring(0, lastAtIndex) : plugin
        const version = lastAtIndex > 0 ? plugin.substring(lastAtIndex + 1) : "latest"
        const builtin = BUILTIN.some((x) => x.startsWith(pkg + "@"))
        plugin = await BunProc.install(pkg, version).catch((err) => {
          if (!builtin) throw err

          const message = err instanceof Error ? err.message : String(err)
          log.error("failed to install builtin plugin", {
            pkg,
            version,
            error: message,
          })
          Bus.publish(Session.Event.Error, {
            error: new NamedError.Unknown({
              message: `Failed to install built-in plugin ${pkg}@${version}: ${message}`,
            }).toObject(),
          })

          return ""
        })
        if (!plugin) continue
      }
      const mod = await import(plugin)
      // Prevent duplicate initialization when plugins export the same function
      // as both a named export and default export (e.g., `export const X` and `export default X`).
      // Object.entries(mod) would return both entries pointing to the same function reference.
      const seen = new Set<PluginInstance>()
      for (const [_name, fn] of Object.entries<PluginInstance>(mod)) {
        if (seen.has(fn)) continue
        seen.add(fn)
        const init = await fn(input)
        hooks.push(init)
      }
    }

    // Register any domain providers a plugin contributed via its `provider` hook,
    // so an installed domain package (e.g. @cyberstrike/aws) shows up in the agent
    // registry. Registration is a side-effect of loading; the agent registry
    // (built lazily, or after restart) then collects them alongside the built-ins.
    for (const hook of hooks) {
      for (const [key, factory] of Object.entries(hook.provider ?? {})) {
        log.info("registering domain provider from plugin", { domain: key })
        registerProvider(key, factory)
      }
    }

    return {
      hooks,
      input,
    }
  })

  export async function trigger<
    Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool" | "provider">,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(name: Name, input: Input, output: Output): Promise<Output> {
    if (!name) return output
    for (const hook of await state().then((x) => x.hooks)) {
      const fn = hook[name]
      if (!fn) continue
      // @ts-expect-error if you feel adventurous, please fix the typing, make sure to bump the try-counter if you
      // give up.
      // try-counter: 2
      await fn(input, output)
    }
    return output
  }

  export async function list() {
    return state().then((x) => x.hooks)
  }

  export async function init() {
    const hooks = await state().then((x) => x.hooks)
    const config = await Config.get()
    for (const hook of hooks) {
      // @ts-expect-error this is because we haven't moved plugin to sdk v2
      await hook.config?.(config)
    }
    Bus.subscribeAll(async (input) => {
      const hooks = await state().then((x) => x.hooks)
      for (const hook of hooks) {
        hook["event"]?.({
          event: input,
        })
      }
    })
  }
}
