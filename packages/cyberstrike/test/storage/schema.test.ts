import { expect, test } from "bun:test"
import * as schema from "../../src/storage/schema"

// db.ts hands this whole object to Drizzle and reconciles every table in it at startup, so a table missing from
// here is never checked against its definition. Module under test: src/storage/schema.ts. No existing test covers it.
test("the request-observation and coverage-note tables are part of the drizzle schema", () => {
  expect(Object.keys(schema)).toContain("RequestObservationTable")
  expect(Object.keys(schema)).toContain("CoverageNoteTable")
})
