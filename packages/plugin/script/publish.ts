#!/usr/bin/env bun
import { Script } from "@cyberstrike-io/script"
import { $ } from "bun"

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

await $`bun tsc`
const pkg = await import("../package.json").then((m) => m.default)
const original = JSON.parse(JSON.stringify(pkg))
for (const [key, value] of Object.entries(pkg.exports)) {
  const file = value.replace("./src/", "./dist/").replace(".ts", "")
  // @ts-ignore
  pkg.exports[key] = {
    import: file + ".js",
    types: file + ".d.ts",
  }
}
await Bun.write("package.json", JSON.stringify(pkg, null, 2))
const access = process.env.CI_SERVER_HOST ? [] : ["--access", "public"]
const tag = process.env.CYBERSTRIKE_NPM_TAG || Script.channel
await $`bun pm pack && npm publish *.tgz --tag ${tag} ${access}`
await Bun.write("package.json", JSON.stringify(original, null, 2))
