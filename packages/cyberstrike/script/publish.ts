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
await $`cp ./script/preuninstall.mjs ./${distDir}/preuninstall.mjs`
await Bun.file(`./${distDir}/LICENSE`).write(await Bun.file("../../LICENSE").text())
await Bun.file(`./${distDir}/README.md`).write(await Bun.file("./README.md").text())
// npm dual-use policy: the DISCLOSURE file must ship in the published package root (#113)
await Bun.file(`./${distDir}/DISCLOSURE`).write(await Bun.file("./DISCLOSURE").text())

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
// TEST (isolation — revert to true): skip bundling the offensive skill corpus to confirm
// whether it is what trips npm's automated review on the main package.
const BUNDLE_SKILLS = false
const skillSrcPath = "../../.cyberstrike/skill"
const skillDestPath = `./${distDir}/skill`
const { existsSync } = await import("fs")
if (BUNDLE_SKILLS && existsSync(skillSrcPath)) {
  await $`cp -r ${skillSrcPath} ${skillDestPath}`
  console.log("Bundled skills into npm package")
} else {
  console.warn("Warning: Skills not found — npm package will not include built-in skills")
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
        preuninstall: "bun ./preuninstall.mjs || node ./preuninstall.mjs || true",
      },
      version: version,
      license: pkg.license,
      keywords: pkg.keywords,
      homepage: "https://cyberstrike.io",
      repository: {
        type: "git",
        url: "https://github.com/CyberStrikeus/CyberStrike.git",
      },
      // npm dual-use content declaration — this is a penetration-testing tool (#113)
      contentPolicy: { class: "dual-use" },
      dependencies: {},
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

const access = process.env.CI_SERVER_HOST ? [] : ["--access", "public"]
const tag = process.env.CYBERSTRIKE_NPM_TAG || Script.channel

const tasks = Object.entries(binaries).map(async ([name]) => {
  const dirName = name.replace(`${SCOPE}/`, "")
  if (process.platform !== "win32") {
    await $`chmod -R 755 .`.cwd(`./dist/${dirName}`)
  }
  await $`bun pm pack`.cwd(`./dist/${dirName}`)
  await $`npm publish *.tgz ${access} --tag ${tag}`.cwd(`./dist/${dirName}`)
})
await Promise.all(tasks)
// Main package is declared dual-use (#113) → npm forbids direct publish with a 2FA-bypass
// token, so stage it. A maintainer promotes it with `npm stage approve <id>` (2FA) afterward.
// The binary/sdk/plugin packages are not dual-use and keep publishing directly above.
await $`cd ./${distDir} && bun pm pack && npm stage publish *.tgz ${access} --tag ${tag}`
