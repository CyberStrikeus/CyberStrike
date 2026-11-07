import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { CapturedWebScript } from "./webScriptExport.js";
import { planWebScriptExport } from "./webScriptExportPlan.js";

const source = (url: string, index = 1): CapturedWebScript => {
  const bytes = Buffer.from(`export const marker = ${index};`);
  return {
    url,
    source: {
      kind: "page-script",
      script_key: `script-${index}`,
      frame_id: null,
      is_module: true,
      language: "JavaScript",
      source_map_url: null,
    },
    content: {
      state: "captured",
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      media_type: "text/javascript",
      redacted: null,
      representation: "debugger-source-utf8",
    },
  };
};

describe("captured script path projection", () => {
  it("preserves ordinary relative layouts separately for each origin", () => {
    const planned = planWebScriptExport([
      source("https://a.test/app/main.js"),
      source("https://a.test/app/lib/value.mjs", 2),
      source("https://b.test/app/main.js", 3),
    ]);
    const paths = planned.map(({ record }) =>
      record.content.state === "exported" ? record.content.relative_path : "",
    );
    expect(paths[0]).toMatch(/^origins\/[a-f0-9]{64}\/app\/main\.js$/u);
    expect(paths[1]?.replace("lib/value.mjs", "main.js")).toBe(paths[0]);
    expect(paths[2]).not.toBe(paths[0]);
  });

  it.each(["+", "!", "$", "&", "'", "(", ")", ",", ";", "=", "@"])(
    "preserves the portable literal URL path character %s",
    (character) => {
      const url = `https://a.test/app/chunk${character}name.js`;
      const [planned] = planWebScriptExport([source(url)]);
      expect(planned?.record.content).toMatchObject({
        state: "exported",
        layout: "url-path",
        relative_path: expect.stringContaining(`/app/chunk${character}name.js`),
      });
    },
  );

  it.each([
    ["https://a.test/main.js", "https://a.test/main.js"],
    ["https://a.test/main.js", "https://a.test/main.js?v=2"],
    ["https://a.test/main.js", "https://a.test/main.js/child.js"],
  ])(
    "isolates every version in a conflicting layout (%s, %s)",
    (first, second) => {
      const planned = planWebScriptExport([source(first), source(second, 2)]);
      expect(
        planned.every(
          ({ record }) =>
            record.content.state === "exported" &&
            record.content.layout === "isolated",
        ),
      ).toBe(true);
      expect(
        new Set(
          planned.map(({ record }) =>
            record.content.state === "exported"
              ? record.content.relative_path
              : null,
          ),
        ).size,
      ).toBe(2);
    },
  );

  it.each([
    "",
    "https://a.test/main.js?v=2",
    "https://a.test/main.js?",
    "https://a.test/main.js#",
    "https://a.test/main.js?#",
    "https://a.test/main.js#variant",
    "data:text/javascript,export{}",
    "https://a.test/%2fescape.js",
    "https://a.test/app/chunk:part.js",
    "https://a.test/app/chunk*part.js",
    "https://a.test/CON.js",
    "https://a.test/目录/main.js",
    "https://a.test/app",
  ])(
    "retains unrepresentable URLs without using them as filesystem paths: %s",
    (url) => {
      const [{ record } = { record: undefined }] = planWebScriptExport([
        source(url),
      ]);
      expect(record).toMatchObject({
        url,
        content: {
          state: "exported",
          layout: "isolated",
          relative_path: expect.stringMatching(
            /^isolated\/source-1-[a-f0-9]{64}\.js$/u,
          ),
        },
      });
    },
  );

  it("keeps case-distinct URL paths until the destination collides", () => {
    const planned = planWebScriptExport([
      source("https://a.test/A/main.js"),
      source("https://a.test/a/other.js", 2),
    ]);
    expect(
      planned.every(
        ({ record }) =>
          record.content.state === "exported" &&
          record.content.layout === "url-path",
      ),
    ).toBe(true);
    const paths = planned.map(({ record }) =>
      record.content.state === "exported" ? record.content.relative_path : "",
    );
    expect(paths[0]).toMatch(/\/A\/main\.js$/u);
    expect(paths[1]).toMatch(/\/a\/other\.js$/u);
  });

  it("does not choose a canonical version when a competing source is unavailable", () => {
    const missing: CapturedWebScript = {
      ...source("https://a.test/main.js?v=2", 2),
      content: {
        state: "unavailable",
        reason: "not_requested",
        message: "Not retained",
      },
    };
    const planned = planWebScriptExport([
      source("https://a.test/main.js"),
      missing,
    ]);
    expect(planned[0]?.record.content).toMatchObject({
      state: "exported",
      layout: "isolated",
    });
    expect(planned[1]?.record.content).toEqual(missing.content);
  });
});
