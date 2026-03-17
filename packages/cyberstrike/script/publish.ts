#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@cyberstrike-io/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const SCOPE = "@cyberstrike-io"
const scopedName = `${SCOPE}/${pkg.name}`
const distDir = `dist/${pkg.name}`

const binaries: Record<string, string> = {}
for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })) {
  const binPkg = await Bun.file(`./dist/${filepath}`).json()
  // Prefix binary package names with scope
  const scopedBinName = binPkg.name.startsWith(SCOPE) ? binPkg.name : `${SCOPE}/${binPkg.name}`
  binaries[scopedBinName] = binPkg.version
}
console.log("binaries", binaries)
const version = Object.values(binaries)[0]

await $`mkdir -p ./${distDir}`
await $`cp -r ./bin ./${distDir}/bin`
await $`cp ./script/postinstall.mjs ./${distDir}/postinstall.mjs`
await Bun.file(`./${distDir}/LICENSE`).write(await Bun.file("../../LICENSE").text())

await Bun.file(`./${distDir}/package.json`).write(
  JSON.stringify(
    {
      name: scopedName,
      description: pkg.description,
      bin: {
        [pkg.name]: `./bin/${pkg.name}`,
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      version: version,
      license: pkg.license,
      keywords: pkg.keywords,
      homepage: "https://github.com/CyberStrikeus/CyberStrike",
      repository: {
        type: "git",
        url: "https://github.com/CyberStrikeus/CyberStrike.git",
      },
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

const tasks = Object.entries(binaries).map(async ([name]) => {
  // name is scoped like "@cyberstrike-io/cyberstrike-darwin-arm64"
  // directory on disk is just "cyberstrike-darwin-arm64"
  const dirName = name.replace(`${SCOPE}/`, "")
  if (process.platform !== "win32") {
    await $`chmod -R 755 .`.cwd(`./dist/${dirName}`)
  }
  await $`bun pm pack`.cwd(`./dist/${dirName}`)
  await $`npm publish *.tgz --access public --tag ${Script.channel}`.cwd(`./dist/${dirName}`)
})
await Promise.all(tasks)
await $`cd ./${distDir} && bun pm pack && npm publish *.tgz --access public --tag ${Script.channel}`

