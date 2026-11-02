#!/usr/bin/env bun

import { Script } from "@cyberstrike-io/script"
import { $ } from "bun"
import { buildNotes, getLatestRelease } from "./changelog"

const output = [`version=${Script.version}`]

// Create the GitHub release for stable AND preview (canary/beta) so CI ships the release with
// binaries + skills.tar.gz either way (build.ts uploads them). Stable stays a draft, published
// by publish.ts after the git tag/push. Preview is a live prerelease targeting HEAD — no git
// version-bump commit for canary, so the branch isn't polluted with per-canary release commits.
if (["latest", "canary", "beta"].includes(Script.channel)) {
  const previous = await getLatestRelease()
  const notes = await buildNotes(previous, "HEAD")
  const body = notes.join("\n") || "No notable changes"
  const dir = process.env.RUNNER_TEMP ?? "/tmp"
  const file = `${dir}/cyberstrike-release-notes.txt`
  await Bun.write(file, body)
  if (Script.preview) {
    const sha = await $`git rev-parse HEAD`.text().then((x) => x.trim())
    await $`gh release create v${Script.version} --prerelease --target ${sha} --title "v${Script.version}" --notes-file ${file}`
  } else {
    await $`gh release create v${Script.version} -d --title "v${Script.version}" --notes-file ${file}`
  }
  const release = await $`gh release view v${Script.version} --json tagName,databaseId`.json()
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
}

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output.join("\n"))
}

process.exit(0)
