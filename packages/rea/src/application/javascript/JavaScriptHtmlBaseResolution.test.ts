import { describe, expect, it } from "vitest";
import { resolveArtifactPathByContext } from "./JavaScriptArtifactPathResolution.js";
import { JavaScriptJsonDocuments } from "./JavaScriptJsonDocuments.js";
import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
const paths = [
  "renderer/index.html",
  "assets/app.js",
  "renderer/app.js",
  "renderer/a/app.js",
  "renderer/assets/app.js",
  "app.js",
];
const files = new Map<string, JavaScriptArtifactFile>(
  paths.map((path) => [
    path,
    {
      path,
      container_sha256: "a".repeat(64),
      sha256: "b".repeat(64),
      bytes: 0,
      inventory_artifact_id: path,
      kind: "javascript",
      unpacked: false,
      text: { included: true, value: "" },
    },
  ]),
);
const jsonDocuments = new JavaScriptJsonDocuments();
const resolve = (declaredPath: string, htmlBaseHref: string) =>
  resolveArtifactPathByContext({
    declaredPath,
    htmlBaseHref,
    sourcePath: "renderer/index.html",
    context: "html-reference",
    files,
    jsonDocuments,
  });
const documentUrl = "https://artifact.test/renderer/index.html";
describe("HTML base href URL components", () => {
  it.each(["?base=1", "#base-fragment"])(
    "keeps the document pathname for suffix-only base href %s",
    (base) => {
      const resolvedBase = new URL(base, documentUrl);
      expect(new URL("app.js", resolvedBase).pathname).toBe("/renderer/app.js");
      expect(resolve("app.js", base)).toMatchObject({
        resolved_path: "renderer/app.js",
        resolution_status: "resolved",
      });

      const emptyPathReference = "?script=1#fragment";
      expect(new URL(emptyPathReference, resolvedBase).pathname).toBe(
        "/renderer/index.html",
      );
      expect(resolve(emptyPathReference, base)).toMatchObject({
        declared_path: emptyPathReference,
        resolved_path: "renderer/index.html",
        resolution_status: "resolved",
      });
    },
  );

  it.each([
    "/assets/?cache=/wrong/",
    "/assets/#/wrong/",
    "/assets/index.html?cache=/wrong/",
  ])("ignores query and fragment path-looking characters in %s", (base) => {
    expect(
      new URL(
        "app.js",
        new URL(base, "https://artifact.test/renderer/index.html"),
      ).pathname,
    ).toBe("/assets/app.js");
    expect(resolve("app.js", base)).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "assets/app.js",
    });
  });
  it.each(["https://external.test/", "//external.test/"])(
    "keeps root-relative references external when their base is %s",
    (base) => {
      expect(resolve("/assets/app.js", base)).toMatchObject({
        resolution_status: "external",
        resolved_path: null,
      });
    },
  );
});
describe("HTML base href dot segments", () => {
  it.each([
    [".", "renderer/app.js"],
    ["./", "renderer/app.js"],
    ["a/.", "renderer/a/app.js"],
    ["a/..", "renderer/app.js"],
    ["..", "app.js"],
  ])(
    "resolves %s against the document directory like the URL parser",
    (base, expected) => {
      // A relative reference resolves against the base URL's directory, which
      // drops a trailing "." or ".." segment instead of stepping through it.
      expect(
        decodeURIComponent(
          new URL("app.js", new URL(base, documentUrl)).pathname,
        ).replace(/^\/+/, ""),
      ).toBe(expected);
      expect(resolve("app.js", base)).toMatchObject({
        resolution_status: "resolved",
        resolved_path: expected,
      });
    },
  );
  it.each([
    ["app.js/", "/assets/", "assets/app.js"],
    ["app.js/.", "/assets/", "assets/app.js"],
    ["?cache=1", "/assets/app.js/", "assets/app.js"],
  ])(
    "keeps directory-form HTML reference %s with base %s distinct from %s",
    (declared, base, directory) => {
      expect(resolve(declared, base)).toMatchObject({
        declared_path: declared,
        resolution_status: "not-found",
        resolved_path: null,
        limitations: [
          `The HTML reference resolves to directory ${directory}, not an exact selected application file.`,
        ],
      });
    },
  );
});
describe("HTML base href empty segments", () => {
  it("lets the script reference remove an empty segment from the base", () => {
    // URL resolution keeps the base's empty segment until `..` removes it.
    expect(
      new URL("../app.js", new URL("./assets//", documentUrl)).pathname,
    ).toBe("/renderer/assets/app.js");
    expect(resolve("../app.js", "./assets//")).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "renderer/assets/app.js",
    });
  });
  it("keeps an above-root base escape when the reference also climbs", () => {
    expect(resolve("../app.js", "../../")).toMatchObject({
      resolution_status: "rejected",
      limitations: [
        "The resolved candidate escapes the canonical artifact root.",
      ],
    });
  });
});
describe("HTML base href path syntax", () => {
  it.each(["%2e%2e/secret/", "/a/%2e%2e/", "/a\\b/", "a\0b"])(
    "rejects base href %j with the same admission rules a declared path gets",
    (base) => {
      const outcome = resolve("app.js", base);
      expect(outcome.resolution_status).toBe("rejected");
      expect(outcome.limitations[0]).toContain(
        "not admitted for canonical artifact paths",
      );
    },
  );
  it("still confines a base href that escapes the artifact root", () => {
    expect(resolve("app.js", "/a/../../secret/")).toMatchObject({
      resolution_status: "rejected",
      limitations: [
        "The resolved candidate escapes the canonical artifact root.",
      ],
    });
  });
  it("reports an external base href as external rather than malformed", () => {
    expect(resolve("app.js", "https://external.test/%2e%2e/")).toMatchObject({
      resolution_status: "external",
      resolved_path: null,
    });
  });
});
describe("HTML reference URL text", () => {
  const urlPath = (declared: string, base: string) =>
    decodeURIComponent(
      new URL(declared.trim(), new URL(base.trim(), documentUrl)).pathname,
    ).replace(/^\/+/, "");
  it.each([
    ["%61pp.js", "/assets/", "assets/app.js"],
    [" app.js ", "/assets/", "assets/app.js"],
    ["\napp.js\t", "/assets/", "assets/app.js"],
    ["a\npp.js", "/assets/", "assets/app.js"],
    ["app.js", "%61/", "renderer/a/app.js"],
    ["app.js", " /%61ssets/ ", "assets/app.js"],
    ["/%61ssets/app.js", "", "assets/app.js"],
  ])(
    "resolves %j against base %j like the URL parser",
    (declared, base, expected) => {
      if (base !== "") expect(urlPath(declared, base)).toBe(expected);
      expect(resolve(declared, base)).toMatchObject({
        declared_path: declared,
        resolution_status: "resolved",
        resolved_path: expected,
      });
    },
  );
  it("keeps a literal percent sign that starts no escape", () => {
    expect(resolve("100%.js", "")).toMatchObject({
      resolution_status: "not-found",
      limitations: [
        "The exact HTML resource renderer/100%.js was not found among the selected application files.",
      ],
    });
  });
  it.each(["%00app.js", "%ff.js"])(
    "rejects %j, which decodes to no canonical artifact path",
    (declared) => {
      expect(resolve(declared, "")).toMatchObject({
        resolution_status: "rejected",
        resolved_path: null,
      });
    },
  );
  it("rejects a base href whose URL whitespace splits an encoded separator", () => {
    expect(resolve("app.js", "a%2\nf/")).toMatchObject({
      resolution_status: "rejected",
      resolved_path: null,
    });
  });
  it("rejects a base href that decodes to NUL", () => {
    expect(resolve("app.js", "/a%00/")).toMatchObject({
      resolution_status: "rejected",
      resolved_path: null,
    });
  });
  it.each([" https://external.test/app.js", "\t//external.test/app.js"])(
    "reports %j as external after removing URL whitespace",
    (declared) => {
      expect(resolve(declared, "")).toMatchObject({
        resolution_status: "external",
      });
    },
  );
  it.each(["%2e%2e/app.js", "a%2fapp.js", "%2\nfapp.js", "%2\ne%2\te/app.js"])(
    "still rejects encoded dot and separator bytes in %j",
    (declared) => {
      expect(resolve(declared, "")).toMatchObject({
        resolution_status: "rejected",
      });
    },
  );
});
