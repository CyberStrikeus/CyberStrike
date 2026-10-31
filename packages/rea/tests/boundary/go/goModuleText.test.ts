import { describe, expect, it } from "vitest";
import { parseGoModuleBytes } from "../../../src/go/GoModuleText.js";

describe("Go producer module text", () => {
  it("preserves local replacements, empty fields and ordered duplicate build settings", () => {
    const parsed = parseGoModuleBytes(
      Buffer.from(
        "path\texample.invalid/app\nmod\texample.invalid/app\t(devel)\t\ndep\texample.invalid/lib\tv1.2.3\th1:bytes\n=>\t../local lib\t\t\nbuild\tGOOS=linux\nbuild\tGOOS=custom\nbuild\t__proto__=kept\n",
      ),
    );
    expect(parsed).toMatchObject({
      path: "example.invalid/app",
      main: { version: "(devel)", sum: "" },
      dependencies: [
        {
          path: "example.invalid/lib",
          version: "v1.2.3",
          sum: "h1:bytes",
          replacement: { path: "../local lib", version: "", sum: "" },
        },
      ],
      settings: [
        { key: "GOOS", value: "linux" },
        { key: "GOOS", value: "custom" },
        { key: "__proto__", value: "kept" },
      ],
      complete: true,
      unparsed_lines: [],
      unparsed_line_bytes_base64: [],
    });
  });

  it("decodes Go quoting including byte, octal and Unicode escapes without JSON substitution", () => {
    const text =
      String.raw`build\t"key=quoted"="\a\v\xC3\xA9\303\251\u263a\U0001F680"`.replace(
        "\\t",
        "\t",
      ) +
      "\n" +
      "build\traw=`a\rb`\n";
    expect(parseGoModuleBytes(Buffer.from(text))).toMatchObject({
      settings: [
        { key: "key=quoted", value: "\x07\x0béé☺🚀" },
        { key: "raw", value: "ab" },
      ],
      complete: true,
    });
  });

  it("reports unparsed records and malformed escaped bytes while retaining observed fields", () => {
    const text =
      'path\tapp\nmod\tapp\t(devel)\nbuild\tbad="\\xff"\nfuture\tdata\nbuild\tGOARCH=amd64';
    expect(parseGoModuleBytes(Buffer.from(text))).toMatchObject({
      path: "app",
      main: { sum: null },
      settings: [],
      complete: false,
      unparsed_lines: [
        'build\tbad="\\xff"',
        "future\tdata",
        "build\tGOARCH=amd64",
      ],
    });
  });

  it("does not attach a replacement after a malformed module declaration", () => {
    const parsed = parseGoModuleBytes(
      Buffer.from("dep\tfirst\tv1\ndep\tmalformed\n=>\tlocal\t\t\n"),
    );
    expect(parsed.dependencies).toEqual([
      { path: "first", version: "v1", sum: null, replacement: null },
    ]);
    expect(parsed.complete).toBe(false);
  });

  it("preserves duplicate singleton declarations as unknown instead of silently overwriting", () => {
    expect(
      parseGoModuleBytes(
        Buffer.from(
          "path\tfirst\npath\tsecond\nmod\tfirst\tv1\nmod\tsecond\tv2\n",
        ),
      ),
    ).toMatchObject({
      path: "first",
      main: { path: "first", version: "v1" },
      unparsed_lines: ["path\tsecond", "mod\tsecond\tv2"],
      complete: false,
    });
  });
});

describe("Go producer module bytes", () => {
  it("retains byte-valued producer settings and parses surrounding UTF-8 records", () => {
    const setting = Buffer.concat([
      Buffer.from("build\t-tags="),
      Buffer.from([0xff]),
    ]);
    const trailing = Buffer.from([0xfe]);
    const parsed = parseGoModuleBytes(
      Buffer.concat([
        Buffer.from("path\tapp\nmod\tapp\t(devel)\t\nbuild\tGOOS=linux\n"),
        setting,
        Buffer.from("\nbuild\tGOARCH=amd64\n"),
        trailing,
      ]),
    );
    expect(parsed).toEqual({
      path: "app",
      main: { path: "app", version: "(devel)", sum: "", replacement: null },
      dependencies: [],
      settings: [
        { key: "GOOS", value: "linux" },
        { key: "GOARCH", value: "amd64" },
      ],
      unparsed_lines: [],
      unparsed_line_bytes_base64: [
        setting.toString("base64"),
        trailing.toString("base64"),
      ],
      complete: false,
    });
  });

  it.each(["mod", "dep", "=>"])(
    "does not bind a replacement through an undecodable %s record",
    (record) => {
      const invalid = Buffer.concat([
        Buffer.from(`${record}\t`),
        Buffer.from([0xff]),
        Buffer.from("\tv2\t"),
      ]);
      expect(
        parseGoModuleBytes(
          Buffer.concat([
            Buffer.from("dep\tfirst\tv1\n"),
            invalid,
            Buffer.from("\n=>\tlocal\t\t\n"),
          ]),
        ),
      ).toMatchObject({
        dependencies: [
          { path: "first", version: "v1", sum: null, replacement: null },
        ],
        unparsed_lines: ["=>\tlocal\t\t"],
        unparsed_line_bytes_base64: [invalid.toString("base64")],
        complete: false,
      });
    },
  );

  it.each(["build\t-tags=", "future\t"])(
    "preserves replacement context through an undecodable %s record",
    (prefix) => {
      const invalid = Buffer.concat([Buffer.from(prefix), Buffer.from([0xff])]);
      expect(
        parseGoModuleBytes(
          Buffer.concat([
            Buffer.from("dep\tfirst\tv1\n"),
            invalid,
            Buffer.from("\n=>\tlocal\t\t\n"),
          ]),
        ),
      ).toMatchObject({
        dependencies: [
          {
            path: "first",
            version: "v1",
            sum: null,
            replacement: { path: "local", version: "", sum: "" },
          },
        ],
        unparsed_lines: [],
        unparsed_line_bytes_base64: [invalid.toString("base64")],
        complete: false,
      });
    },
  );
});
