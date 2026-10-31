import { expect, it } from "vitest";
import {
  addSkillManifestToolCount,
  parseSkillManifestMetadata,
} from "./skillManifest.js";

const manifest = (metadata: string, body = "\n# Instructions\n") =>
  `---\nname: reverse-engineer-anything\nmetadata:\n${metadata}---\n${body}`;

it.each(["'49'", '"49"'])(
  "reads semantic metadata with version %s",
  (version) => {
    expect(
      parseSkillManifestMetadata(
        manifest(`  version: ${version}\n  tool_count: 0\n`),
      ),
    ).toEqual({
      ok: true,
      value: {
        version: "49",
        toolCount: 0,
        hasToolCount: true,
        hasCatalogDigest: false,
      },
    });
  },
);

it("does not read counterfeit metadata from the Markdown body", () => {
  const content =
    '---\nname: reverse-engineer-anything\n---\n\n```yaml\nmetadata:\n  version: "counterfeit"\n  tool_count: 42\n```\n';
  expect(parseSkillManifestMetadata(content)).toEqual({
    ok: true,
    value: {
      version: null,
      toolCount: null,
      hasToolCount: false,
      hasCatalogDigest: false,
    },
  });
  expect(addSkillManifestToolCount(content, 5)).toMatchObject({
    ok: false,
    error: { message: "Missing authored skill version" },
  });
});

it.each(["-1", "1.5", "9007199254740992", '"7"', "null"])(
  "retains a valid version when tool_count is invalid: %s",
  (count) => {
    expect(
      parseSkillManifestMetadata(
        manifest(`  version: '49'\n  tool_count: ${count}\n`),
      ),
    ).toMatchObject({
      ok: false,
      error: {
        _tag: "SkillManifestMetadataError",
        metadata: { version: "49", toolCount: null },
      },
    });
  },
);

it.each([
  "  version: [\n",
  "  version: '49'\n  version: '50'\n",
  "  version: '49'\n  tool_count: 1\n  tool_count: 2\n",
])("rejects invalid or duplicate YAML metadata", (metadata) => {
  expect(parseSkillManifestMetadata(manifest(metadata))).toMatchObject({
    ok: false,
  });
});

it("retains a valid count when the version is invalid", () => {
  expect(
    parseSkillManifestMetadata(manifest("  version: 49\n  tool_count: 7\n")),
  ).toMatchObject({
    ok: false,
    error: { metadata: { version: null, toolCount: 7 } },
  });
});

it("updates bounded frontmatter without changing Markdown examples or comments", () => {
  const body =
    '\n# Instructions\n\n```yaml\nmetadata:\n  version: "body-only"\n  tool_count: 99\n```\n';
  const content = manifest("  version: '49' # keep version comment\n", body);
  const generated = addSkillManifestToolCount(content, 7);
  expect(generated.ok).toBe(true);
  if (!generated.ok) throw generated.error;
  expect(generated.value.endsWith(body)).toBe(true);
  expect(generated.value).toContain("version: '49' # keep version comment");
  expect(parseSkillManifestMetadata(generated.value)).toMatchObject({
    ok: true,
    value: { version: "49", toolCount: 7 },
  });
});

it.each(["tool_count: 0", "catalog_digest: abc"])(
  "rejects authored generated metadata: %s",
  (field) => {
    expect(
      addSkillManifestToolCount(manifest(`  version: '49'\n  ${field}\n`), 7),
    ).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("Catalog metadata belongs") },
    });
  },
);

it("rejects unsupported YAML tags without treating their scalars as metadata", () => {
  expect(
    parseSkillManifestMetadata(manifest("  version: !custom '49'\n")),
  ).toMatchObject({
    ok: false,
    error: {
      message: expect.stringContaining("Unsupported skill YAML frontmatter"),
      metadata: { version: null },
    },
  });
});
