import path from "path"
import { OpenApi } from "effect/http-api"
import { ClientApi } from "@opencode/protocol/client"

const file = path.join(import.meta.dir, "../openapi.json")
const text = JSON.stringify(OpenApi.fromApi(ClientApi), null, 2) + "\n"

if (Bun.argv.includes("--check")) {
  const current = await Bun.file(file)
    .text()
    .catch(() => "")
  if (current === text) process.exit(0)
  console.error(`${file} is out of date; run "bun run generate"`)
  process.exit(1)
}

await Bun.write(file, text)
console.log(`wrote ${file}`)
