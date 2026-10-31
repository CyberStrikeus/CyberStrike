import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { webPageInspectionSchema } from "../../../src/domain/browserObservationSchemas.js";
import { webObservationSessionSchema } from "../../../src/domain/browserSession.js";
import { webScreenshotSchema } from "../../../src/domain/webScreenshot.js";

const fields = [
  ["screenshot capture", webScreenshotSchema.shape.captured_at],
  [
    "page inspection start",
    webPageInspectionSchema.shape.capture_window.shape.started_at,
  ],
  [
    "session observation end",
    webObservationSessionSchema.shape.window.shape.ended_at,
  ],
] as const;

describe.each(fields)("%s timestamp compatibility", (_name, schema) => {
  const advertised = z.toJSONSchema(schema, { target: "draft-2020-12" });
  const validate = new Ajv2020().compile(advertised);

  it.each([
    "2026-10-09T04:00Z",
    "2026-10-09T04:00:00Z",
    "2026-10-09T04:00:00.1234567890123456789Z",
  ])("preserves the admitted source spelling %s", (value) => {
    expect(schema.parse(value)).toBe(value);
    expect(validate(value)).toBe(true);
  });

  it.each([
    "2026-10-09T04:00",
    "2026-10-09T04:00+02:00",
    "2026-10-09T04:00:00-03:00",
    "2026-04-31T04:00Z",
    "2026-10-09T04:00.5Z",
  ])("rejects %s in both the canonical and advertised contracts", (value) => {
    expect(schema.safeParse(value).success).toBe(false);
    expect(validate(value)).toBe(false);
  });
});
