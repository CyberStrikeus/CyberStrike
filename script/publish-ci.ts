#!/usr/bin/env bun

import { $ } from "bun"
import { Script } from "@cyberstrike-io/script"

console.log("=== publishing (GitLab CI) ===\n")
console.log(`version: ${Script.version}`)
console.log(`channel: ${Script.channel}`)

const pkgjsons = await Array.fromAsync(
  new Bun.Glob("**/package.json").scan({
    absolute: true,
  }),
).then((arr) => arr.filter((x) => !x.includes("node_modules") && !x.includes("dist")))

for (const file of pkgjsons) {
  let pkg = await Bun.file(file).text()
  pkg = pkg.replaceAll(/"version": "[^"]+"/g, `"version": "${Script.version}"`)
  console.log("updated:", file)
  await Bun.file(file).write(pkg)
}

await $`bun install`
await import(`../packages/sdk/js/script/build.ts`)

console.log("\n=== cli ===\n")
await import(`../packages/cyberstrike/script/publish.ts`)

console.log("\n=== sdk ===\n")
await import(`../packages/sdk/js/script/publish.ts`)

console.log("\n=== plugin ===\n")
await import(`../packages/plugin/script/publish.ts`)

console.log("\n=== done ===\n")
