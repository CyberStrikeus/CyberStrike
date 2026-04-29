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
if (Object.keys(binaries).length === 0) {
  console.error("No binary packages found in dist/. Run build.ts first.")
  process.exit(1)
}
const version = Object.values(binaries)[0]

await $`mkdir -p ./${distDir}`
await $`cp -r ./bin ./${distDir}/bin`
await $`cp ./script/postinstall.mjs ./${distDir}/postinstall.mjs`
await Bun.file(`./${distDir}/LICENSE`).write(await Bun.file("../../LICENSE").text())
await Bun.file(`./${distDir}/README.md`).write(await Bun.file("./README.md").text())

// Bundle web UI if available (built by publish workflow build-app job)
const webDistPath = "../../packages/app/dist"
const webDestPath = `./${distDir}/web`
if (await Bun.file(`${webDistPath}/index.html`).exists()) {
  await $`cp -r ${webDistPath} ${webDestPath}`
  console.log("Bundled web UI into npm package")
} else {
  console.warn("Warning: Web UI dist not found — npm package will not include web UI")
}

// Bundle built-in skills
const skillSrcPath = "../../.cyberstrike/skill"
const skillDestPath = `./${distDir}/skill`
const { existsSync } = await import("fs")
if (existsSync(skillSrcPath)) {
  await $`cp -r ${skillSrcPath} ${skillDestPath}`
  console.log("Bundled skills into npm package")
} else {
  console.warn("Warning: Skills not found — npm package will not include built-in skills")
}

// Bundle hackbrowser worker JS (subprocess.md). Placed by postinstall into
// Global.Path.bin (~/.local/share/cyberstrike/bin/) so the main binary can
// spawn it at runtime without playwright in the main binary's module graph.
const workerSrcPath = "./dist/hackbrowser-worker/hackbrowser-worker.js"
const workerDestPath = `./${distDir}/hackbrowser-worker.js`
if (await Bun.file(workerSrcPath).exists()) {
  await $`cp ${workerSrcPath} ${workerDestPath}`
  console.log("Bundled hackbrowser-worker.js into npm package")
} else {
  console.warn("Warning: hackbrowser-worker.js not found — run build.ts first")
}

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
      homepage: "https://cyberstrike.io",
      repository: {
        type: "git",
        url: "https://github.com/CyberStrikeus/CyberStrike.git",
      },
      dependencies: {
        // playwright is an npm dependency so it is installed next to the
        // worker JS and can be resolved at runtime. It is NOT bundled into
        // the main binary (subprocess.md — zero playwright in main binary).
        playwright: "1.58.2",
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
