export * as File from "./file"

import { Revert } from "@cyberstrike-io/schema/revert"

export const Diff = Revert.FileDiff
export type Diff = typeof Diff.Type
