import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { unavailable } from "./stub"

export const WorktreeHandler = HttpApiBuilder.group(Api, "server.worktree", (handlers) =>
  handlers
    .handle("worktree.list", () => unavailable)
    .handle("worktree.create", () => unavailable)
    .handle("worktree.remove", () => unavailable)
    .handle("worktree.refresh", () => unavailable)
)
