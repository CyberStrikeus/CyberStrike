import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { unavailable } from "./stub"

export const MigrationHandler = HttpApiBuilder.group(Api, "server.migration", (handlers) =>
  handlers
    .handle("migration.v1.status", () => unavailable)
)
