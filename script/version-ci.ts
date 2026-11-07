#!/usr/bin/env bun

import { Script } from "@cyberstrike-io/script"

console.log(`Version: ${Script.version}`)
console.log(`Channel: ${Script.channel}`)
console.log(`Preview: ${Script.preview}`)

await Bun.write("version.env", [`CYBERSTRIKE_VERSION=${Script.version}`, `CYBERSTRIKE_CHANNEL=${Script.channel}`].join("\n"))
