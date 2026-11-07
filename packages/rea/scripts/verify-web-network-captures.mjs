#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  copyFile,
  chmod,
  readFile,
  truncate,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { PrivateRuntimeRoot } from "../dist/process/PrivateRuntimeRoot.js";
import { runOwnedCommand } from "../dist/process/OwnedCommand.js";
import { WEB_NETWORK_CAPTURE_LIMITS } from "../dist/domain/webNetworkCapture.js";
import {
  mcpTextValue,
  requireMcpOutput,
  requireMcpToolError,
} from "./lib/mcp-verifier-results.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";

const executable = process.env.REA_MITMDUMP_COMMAND;
if (
  process.platform !== "linux" ||
  executable === undefined ||
  !isAbsolute(executable)
)
  throw new Error(
    "verify:web:network-captures requires Linux and absolute REA_MITMDUMP_COMMAND for caller-supplied mitmdump 12.2.3",
  );
await access(executable);
const entrypoint =
  process.argv[2] ?? fileURLToPath(new URL("./rea.mjs", import.meta.url));
const run = createVerifierRun();
const runtime = await PrivateRuntimeRoot.create({
  prefix: "rea-history-verifier-",
});
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === "string"),
);
const client = new Client({
  name: "historical-web-capture-verifier",
  version: "1",
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "mcp"],
  env: environment,
  stderr: "pipe",
});
const failures = [];
let cases = 0;
try {
  await runOwnedCommand(
    {
      command: executable,
      arguments: [
        "--no-server",
        "-q",
        "--set",
        `confdir=${join(runtime.path, "config")}`,
        "--set",
        `rea_fixture_root=${runtime.path}`,
        "--set",
        `rea_adapter_path=${resolve(dirname(entrypoint), "../bridge/mitmproxy/capture.py")}`,
        "-s",
        fileURLToPath(
          new URL("./fixtures/generate-mitmproxy-capture.py", import.meta.url),
        ),
      ],
      cwd: runtime.path,
      runId: `rea-history-fixture-${randomUUID()}`,
      hostEnvironment: environment,
    },
    { timeoutMs: 30_000, diagnosticBytes: 1024 * 1024 },
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(runtime.path, "native-error-classifications.json"),
        "utf8",
      ),
    ),
    { passed: 7 },
  );
  await client.connect(transport);
  for (const format of ["har", "mitmproxy"]) {
    const path = join(
      runtime.path,
      format === "har" ? "producer.har" : "flows.mitm",
    );
    const raw = await readFile(path);
    const input = { capture_path: path, format, record_ordinals: [1, 0] };
    for (const mode of ["cli", "mcp"]) {
      const value = await inspect(mode, input);
      assert.equal(value.total_records, 2);
      assert.deepEqual(
        value.records.map((record) => record.ordinal),
        [1, 0],
      );
      assert.equal(
        value.artifact.sha256,
        createHash("sha256").update(raw).digest("hex"),
      );
      assert.equal(value.runtime_attribution, "unknown");
      const first = value.records[1];
      if (format === "mitmproxy") {
        assert.equal(first.reported.id, "original-producer-id");
        assert.equal(value.records[0].reported.id, first.reported.id);
        assert.equal(first.location.offset, 0);
        assert.equal(
          value.records[0].location.offset + value.records[0].location.bytes,
          raw.length,
        );
        assert.equal(
          first.reported.request.path,
          "http://example.test/a?token=ordinary#fragment",
        );
        assertBinary(
          first,
          "/request/content",
          Buffer.from([0, 255, ...Buffer.from("body")]),
        );
        assertBinary(
          first,
          "/response/content",
          Buffer.from([0, 254, ...Buffer.from("answer")]),
        );
        assertBinary(
          first,
          "/websocket/messages/0/2",
          Buffer.from([0, 253, ...Buffer.from("message")]),
        );
        assert.equal(value.records[0].reported.request.content, null);
        assertBinary(value.records[0], "/response/content", Buffer.alloc(0));
        assert.ok(
          first.numeric_literals.some(
            (number) =>
              number.pointer === "/metadata/big_integer" &&
              number.literal === "9007199254740993",
          ),
        );
        assert.ok(
          first.numeric_literals.some(
            (number) =>
              number.pointer === "/metadata/nonfinite" &&
              number.literal === "inf",
          ),
        );
        assert.equal(
          first.reported.metadata.response.headers[0][1],
          "ordinary-extension-credential-name",
        );
      } else {
        assert.equal(value.container.reported.log.creator.name, "mitmproxy");
        assert.equal(value.container.reported.log.creator.version, "12.2.3");
        assert.equal(value.records[0].reported.request.postData.text, null);
        assertBinary(
          first,
          "/response/content/text",
          Buffer.from([0, 255, 1, 254]),
        );
      }
      const text = JSON.stringify(value);
      for (const secret of [
        "native-transport-secret",
        "cookie-secret",
        "redirect-password",
        "user:password",
      ])
        assert.ok(
          !text.includes(secret),
          `Credential leaked through ${mode}/${format}`,
        );
      cases++;
    }
  }
  for (const mode of ["cli", "mcp"]) {
    const value = await inspect(mode, {
      capture_path: join(runtime.path, "string-urls.mitm"),
      format: "mitmproxy",
    });
    const first = value.records[0];
    for (const state of [first.reported, first.reported.backup]) {
      assert.equal(state.request.path, "https://example.test/string-path");
      assert.equal(state.request.authority, "example.test");
      assert.deepEqual(
        state.request.headers.map((field) => field[1]),
        ["https://example.test/from", "//example.test"],
      );
      assert.equal(state.response.headers[0][1], "https://example.test/to");
    }
    assert.ok(!JSON.stringify(value).includes("password"));
    assert.ok(
      first.redactions.some(
        (redaction) =>
          redaction.pointer === "/backup/request/authority" &&
          redaction.reason === "transport-credential",
      ),
    );
    cases++;
  }
  // Verify Python float spellings through the actual native producer and both public adapters.
  for (const mode of ["cli", "mcp"]) {
    for (const marked of [false, true]) {
      const value = await inspect(mode, {
        capture_path: join(runtime.path, "flows.mitm"),
        format: "mitmproxy",
        sensitive_values: marked ? ["1e-7", "000000"] : [],
      });
      for (const record of value.records) {
        assert.deepEqual(record.reported.metadata.numeric_spellings, {
          small: marked ? null : 1e-7,
          large: marked ? null : 1e20,
          ordinary: 42,
        });
        for (const [key, literal] of [
          ["small", "1e-07"],
          ["large", "1e+20"],
        ]) {
          const pointer = "/metadata/numeric_spellings/" + key;
          assert.equal(
            record.numeric_literals.some(
              (number) =>
                number.pointer === pointer && number.literal === literal,
            ),
            !marked,
          );
          assert.equal(
            record.redactions.some(
              (redaction) =>
                redaction.pointer === pointer &&
                redaction.reason === "explicit-sensitive-value",
            ),
            marked,
          );
        }
      }
      cases++;
    }
  }
  for (const sensitive_values of [
    ["REDACTED", "["],
    ["secret", "REDACTED"],
  ]) {
    for (const format of ["har", "mitmproxy"]) {
      for (const mode of ["cli", "mcp"]) {
        const value = await inspect(mode, {
          capture_path: join(
            runtime.path,
            format === "har" ? "producer.har" : "string-urls.mitm",
          ),
          format,
          record_ordinals: [0],
          sensitive_values,
        });
        const first = value.records[0];
        const markers =
          format === "har"
            ? first.reported._markers
            : first.reported.metadata._markers;
        assert.equal(markers.sensitive, null);
        assert.equal(markers.ordinary, "unmarked");
        assert.equal(
          sensitive_values.includes("[") ? markers.bracket : markers.overlap,
          null,
        );
        if (format === "mitmproxy")
          assert.equal(first.reported.backup.metadata._markers.sensitive, null);
        cases++;
      }
    }
  }
  for (const name of [
    "equal-number",
    "equal-null",
    "equal-object",
    "escaped-key",
    "core",
  ]) {
    const path = join(runtime.path, `duplicate-${name}.har`);
    const original = await readFile(path);
    for (const mode of ["cli", "mcp"]) {
      await inspect(
        mode,
        { capture_path: path, format: "har" },
        "invalid_input",
      );
      assert.deepEqual(await readFile(path), original);
      cases++;
    }
  }
  for (const format of ["har", "mitmproxy"]) {
    const path = join(
      runtime.path,
      format === "har" ? "prototype.har" : "prototype.mitm",
    );
    const original = await readFile(path);
    for (const mode of ["cli", "mcp"]) {
      const value = await inspect(mode, { capture_path: path, format });
      const reported =
        format === "har"
          ? value.container.reported._extension
          : value.records[0].reported.metadata;
      assert.equal(Object.hasOwn(reported, "__proto__"), true);
      assert.deepEqual(reported["__proto__"], { preserved: 7 });
      assert.equal(Object.getPrototypeOf(reported), Object.prototype);
      assert.equal(Reflect.get(Object.prototype, "preserved"), undefined);
      if (format === "har") assert.equal(reported.constructor, "ordinary");
      assert.deepEqual(await readFile(path), original);
      cases++;
    }
  }
  for (const format of ["har", "mitmproxy"]) {
    const path = join(runtime.path, `malformed-${format}`);
    await writeFile(path, format === "har" ? "{invalid-json" : "999999999999:");
    for (const mode of ["cli", "mcp"]) {
      await inspect(mode, { capture_path: path, format }, "invalid_input");
      cases++;
    }
  }
  for (const format of ["har", "mitmproxy"]) {
    for (const mode of ["cli", "mcp"]) {
      const value = await inspect(mode, {
        capture_path: join(
          runtime.path,
          format === "har" ? "producer.har" : "string-urls.mitm",
        ),
        format,
        sensitive_values: ["private-property"],
      });
      const record = value.records[0];
      const properties =
        format === "har"
          ? record.reported._private_properties
          : record.reported.metadata._private_properties;
      assert.deepEqual(properties, { kept: 7 });
      assert.ok(!JSON.stringify(value).includes("private-property"));
      assert.ok(
        record.redactions.some(
          (item) =>
            item.scope === "property-name" &&
            item.pointer ===
              (format === "har"
                ? "/_private_properties"
                : "/metadata/_private_properties"),
        ),
      );
      if (format === "mitmproxy")
        assert.deepEqual(record.reported.backup.metadata._private_properties, {
          kept: 7,
        });
      cases++;
    }
  }
  for (const [fixture, prefix] of [
    ["ows", " \t"],
    ["controls", "\r\n \v\f\x00\x1f"],
  ]) {
    for (const format of ["har", "mitmproxy"]) {
      for (const mode of ["cli", "mcp"]) {
        const value = await inspect(mode, {
          capture_path: join(
            runtime.path,
            `${fixture}.${format === "har" ? "har" : "mitm"}`,
          ),
          format,
        });
        assert.ok(!JSON.stringify(value).includes("ows-secret"));
        const record = value.records[0];
        const states =
          format === "har"
            ? [record.reported]
            : [record.reported, record.reported.backup];
        for (const state of states) {
          if (format === "har") {
            for (const side of ["request", "response"])
              assert.ok(
                state[side].headers.some(
                  (header) =>
                    header.value ===
                    `${prefix}HTTPS://example.test/path?token=ordinary#fragment\t `,
                ),
              );
          } else {
            assert.deepEqual(state.request.headers, [
              [
                "Referer",
                `${prefix}HTTPS://example.test/path?token=ordinary#fragment\t `,
              ],
              [
                "Origin",
                `${prefix}//example.test/path?token=ordinary#fragment\t `,
              ],
            ]);
            assert.deepEqual(state.response.headers, [
              [
                "Location",
                `${prefix}HTTPS://example.test/path?token=ordinary#fragment\t `,
              ],
            ]);
          }
        }
        if (format === "mitmproxy") {
          for (const pointer of [
            "/request/headers/0/1",
            "/backup/request/headers/0/1",
          ])
            assert.deepEqual(
              record.binary_fields.find((field) => field.pointer === pointer),
              {
                pointer,
                representation: "producer-bytes",
                state: "redacted",
                content_base64: null,
                bytes: null,
                sha256: null,
              },
            );
        }
        cases++;
      }
    }
  }
  for (const mode of ["cli", "mcp"]) {
    const value = await inspect(mode, {
      capture_path: join(runtime.path, "non-utf8-urls.mitm"),
      format: "mitmproxy",
    });
    const record = value.records[0];
    assert.ok(!JSON.stringify(value).includes("byte-secret"));
    for (const prefix of ["", "/backup"]) {
      for (const suffix of [
        "/request/path",
        "/request/authority",
        "/request/headers/0/1",
        "/request/headers/1/1",
        "/response/headers/0/1",
      ]) {
        const pointer = prefix + suffix;
        assert.deepEqual(
          record.binary_fields.find((field) => field.pointer === pointer),
          {
            pointer,
            representation: "producer-bytes",
            state: "redacted",
            content_base64: null,
            bytes: null,
            sha256: null,
          },
        );
      }
    }
    cases++;
  }
  const nativeCoordinateInput = {
    capture_path: join(runtime.path, "flows.mitm"),
    format: "mitmproxy",
  };
  const nativeCoordinates = await inspect("mcp", nativeCoordinateInput);
  const originalLocation = nativeCoordinates.records[1].location;
  assert.equal(originalLocation.kind, "byte-range");
  for (const literal of [
    String(originalLocation.offset),
    String(originalLocation.bytes),
  ]) {
    for (const mode of ["cli", "mcp"]) {
      const excluded = await inspect(mode, {
        ...nativeCoordinateInput,
        sensitive_values: [literal],
      });
      assert.deepEqual(excluded.records[1].location, {
        kind: "unknown",
        reason: "explicit-sensitive-value",
      });
      cases++;
    }
  }
  cases++;
  const deniedPath = join(runtime.path, "unreadable.har");
  await copyFile(join(runtime.path, "producer.har"), deniedPath);
  await chmod(deniedPath, 0o000);
  for (const mode of ["cli", "mcp"]) {
    for (const format of ["har", "mitmproxy"]) {
      const failure = await inspect(
        mode,
        { capture_path: deniedPath, format },
        "unavailable",
      );
      assert.equal(failure.code, "access_denied");
      assert.equal(failure.details.system_code, "EACCES");
      assert.equal(failure.details.path, deniedPath);
      cases++;
    }
    for (const literal of ["log", "entries"]) {
      const value = await inspect(mode, {
        capture_path: join(runtime.path, "producer.har"),
        format: "har",
        sensitive_values: [literal],
      });
      assert.equal(value.container.records_pointer, null);
      assert.ok(
        value.records.every(
          (record) =>
            record.location.kind === "unknown" &&
            record.location.reason === "explicit-sensitive-value",
        ),
      );
      assert.ok(!JSON.stringify(value).includes(literal));
      cases++;
    }
    for (const format of ["har", "mitmproxy"]) {
      const value = await inspect(mode, {
        capture_path: join(
          runtime.path,
          format === "har" ? "producer.har" : "string-urls.mitm",
        ),
        format,
        sensitive_values: ["~1"],
      });
      assert.ok(!JSON.stringify(value).includes("~1"));
      cases++;
    }
  }
  for (const mode of ["cli", "mcp"]) {
    for (const format of ["har", "mitmproxy"]) {
      for (const sensitive_values of [
        ["producer"],
        ["producer", "REDACTED", "…"],
      ]) {
        await inspect(mode, {
          capture_path: join(
            runtime.path,
            format === "har" ? "producer.har" : "flows.mitm",
          ),
          format,
          sensitive_values,
        });
        cases++;
      }
    }
  }
  for (const mode of ["cli", "mcp"]) {
    for (const selection of [
      { record_ordinals: [12345], sensitive_values: ["12345"] },
      { record_ordinals: [0, 0], sensitive_values: ["Each"] },
    ]) {
      await inspect(
        mode,
        {
          capture_path: join(runtime.path, "producer.har"),
          format: "har",
          ...selection,
        },
        "invalid_input",
      );
      cases++;
    }
  }
  await inspect(
    "mcp",
    {
      capture_path: "relative.har",
      format: "har",
      sensitive_values: ["absolute"],
    },
    "invalid_input",
  );
  cases++;
  const privatePath = join(runtime.path, "REDACTED.har");
  for (const name of ["mysecret", "/ordinary/secret"]) {
    const unknownArgument = await inspect(
      "mcp",
      {
        capture_path: join(runtime.path, "producer.har"),
        format: "har",
        sensitive_values: ["secret"],
        [name]: true,
      },
      "invalid_input",
    );
    assert.deepEqual(unknownArgument.details.issues[0].path, []);
    cases++;
  }
  await inspect("mcp", {
    capture_path: join(runtime.path, "flows.mitm"),
    format: "mitmproxy",
    sensitive_values: ["\ud800", "ordinary-scalar"],
  });
  cases++;
  const replacementHar = JSON.parse(
    await readFile(join(runtime.path, "producer.har"), "utf8"),
  );
  replacementHar.log.entries[0].response.content = {
    size: 3,
    mimeType: "application/octet-stream",
    encoding: "base64",
    text: "77+9",
  };
  const replacementHarPath = join(runtime.path, "unicode-scalar.har");
  await writeFile(replacementHarPath, JSON.stringify(replacementHar));
  for (const literal of ["\ud800", "\udfff", "\ufffd"]) {
    const unicode = await inspect("mcp", {
      capture_path: replacementHarPath,
      format: "har",
      sensitive_values: [literal],
    });
    const body = unicode.records[0].binary_fields.find(
      (field) => field.pointer === "/response/content/text",
    );
    assert.equal(body?.state, literal === "\ufffd" ? "redacted" : "retained");
    assert.equal(body.content_base64, literal === "\ufffd" ? null : "77+9");
    cases++;
  }
  const numericHar = (
    await readFile(join(runtime.path, "producer.har"), "utf8")
  ).replace('"cache": {}', '"cache": {}, "_big": 9007199254740993');
  const numericPath = join(runtime.path, "numeric.har");
  await writeFile(numericPath, numericHar);
  assert.ok(numericHar.includes('"_big": 9007199254740993'));
  for (const mode of ["cli", "mcp"]) {
    for (const format of ["har", "mitmproxy"]) {
      for (const literal of ["9007199254740993", "4740993"]) {
        const value = await inspect(mode, {
          capture_path:
            format === "har" ? numericPath : join(runtime.path, "flows.mitm"),
          format,
          sensitive_values: [literal],
        });
        assert.ok(!JSON.stringify(value).includes(literal));
        const first = value.records[0];
        const pointer = format === "har" ? "/_big" : "/metadata/big_integer";
        assert.ok(
          first.redactions.some(
            (redaction) =>
              redaction.pointer === pointer &&
              redaction.reason === "explicit-sensitive-value",
          ),
        );
        assert.ok(
          first.numeric_literals.every(
            (number) => !number.literal.includes(literal),
          ),
        );
        cases++;
      }
    }
  }
  for (const mode of ["cli", "mcp"]) {
    for (const format of ["har", "mitmproxy"]) {
      await inspect(mode, {
        capture_path: join(
          runtime.path,
          format === "har" ? "producer.har" : "flows.mitm",
        ),
        format,
        sensitive_values: [format],
      });
      cases++;
    }
  }
  const encodedHar = JSON.parse(
    await readFile(join(runtime.path, "producer.har"), "utf8"),
  );
  encodedHar.log.entries[0].response.content = {
    size: 6,
    mimeType: "application/octet-stream",
    encoding: "base64",
    text: "c2 VjcmV0",
  };
  const encodedHarPath = join(runtime.path, "encoded-sensitive.har");
  await writeFile(encodedHarPath, JSON.stringify(encodedHar));
  for (const mode of ["cli", "mcp"]) {
    for (const format of ["har", "mitmproxy"]) {
      const bytes =
        format === "har"
          ? Buffer.from("secret")
          : Buffer.from([0, 255, ...Buffer.from("body")]);
      for (const literal of [
        bytes.toString("base64"),
        bytes.toString("base64").slice(0, 4),
        createHash("sha256").update(bytes).digest("hex"),
      ]) {
        const value = await inspect(mode, {
          capture_path:
            format === "har"
              ? encodedHarPath
              : join(runtime.path, "flows.mitm"),
          format,
          sensitive_values: [literal],
        });
        const pointer =
          format === "har" ? "/response/content/text" : "/request/content";
        const field = value.records[0].binary_fields.find(
          (field) => field.pointer === pointer,
        );
        assert.equal(field?.state, "redacted");
        assert.equal(field.content_base64, null);
        assert.equal(field.sha256, null);
        assert.ok(!JSON.stringify(value).includes(literal));
        cases++;
      }
    }
  }
  for (const mode of ["cli", "mcp"]) {
    for (const format of ["har", "mitmproxy"]) {
      const capturePath = join(
        runtime.path,
        format === "har" ? "producer.har" : "flows.mitm",
      );
      const digest = createHash("sha256")
        .update(await readFile(capturePath))
        .digest("hex");
      for (const literal of [digest, digest.slice(0, 12)]) {
        const value = await inspect(mode, {
          capture_path: capturePath,
          format,
          sensitive_values: [literal],
        });
        assert.equal(value.artifact.sha256, null);
        assert.equal(value.artifact.path, capturePath);
        assert.ok(!JSON.stringify(value).includes(literal));
        cases++;
      }
    }
  }
  const oversizedPath = join(runtime.path, "oversized-capture");
  for (const mode of ["cli", "mcp"]) {
    for (const literal of ["log", "entries"]) {
      const hidden = await inspect(mode, {
        capture_path: join(runtime.path, "producer.har"),
        format: "har",
        sensitive_values: [literal],
      });
      assert.equal(hidden.total_records, 2);
      assert.equal(hidden.container.records_pointer, null);
      for (const [ordinal, record] of hidden.records.entries()) {
        assert.equal(record.ordinal, ordinal);
        assert.deepEqual(record.location, {
          kind: "unknown",
          reason: "explicit-sensitive-value",
        });
        assert.equal(record.reported, null);
        assert.deepEqual(record.binary_fields, []);
        assert.deepEqual(record.numeric_literals, []);
      }
      cases++;
    }
  }
  await writeFile(oversizedPath, "");
  await truncate(oversizedPath, WEB_NETWORK_CAPTURE_LIMITS.inputBytes + 1);
  await copyFile(join(runtime.path, "producer.har"), privatePath);
  for (const mode of ["cli", "mcp"]) {
    for (const format of ["har", "mitmproxy"]) {
      const failure = await inspect(
        mode,
        { capture_path: oversizedPath, format },
        "invalid_input",
      );
      assert.equal(failure.details.issues[0].reason, "out_of_range");
      assert.deepEqual(failure.details.issues[0].path, ["capture_path"]);
      assert.equal(
        failure.details.issues[0].expected.maximum_capture_bytes,
        WEB_NETWORK_CAPTURE_LIMITS.inputBytes,
      );
      cases++;
    }
    for (const format of ["har", "mitmproxy"]) {
      const failure = await inspect(
        mode,
        {
          capture_path: join(
            runtime.path,
            format === "har" ? "deep.har" : "deep.mitm",
          ),
          format,
        },
        "invalid_input",
      );
      const issue = failure.details.issues[0];
      assert.equal(issue.reason, "out_of_range");
      assert.equal(issue.path[0], "capture_path");
      assert.match(issue.path[1], /^\/_extension\/child/);
      assert.equal(
        issue.expected.maximum_capture_nesting,
        WEB_NETWORK_CAPTURE_LIMITS.depth,
      );
      cases++;
    }
    await inspect(
      mode,
      {
        capture_path: join(runtime.path, "invalid-credential-key.mitm"),
        format: "mitmproxy",
      },
      "invalid_input",
    );
    cases++;
    const credentialDepth = await inspect(
      mode,
      {
        capture_path: join(runtime.path, "deep-credential.mitm"),
        format: "mitmproxy",
      },
      "invalid_input",
    );
    assert.equal(credentialDepth.details.issues[0].reason, "out_of_range");
    assert.match(
      credentialDepth.details.issues[0].path[1],
      /^\/request\/headers\/0\/1\/child/,
    );
    cases++;
    const value = await inspect(mode, {
      capture_path: privatePath,
      format: "har",
      sensitive_values: ["REDACTED", "["],
    });
    assert.equal(value.artifact.path, "");
    assert.ok(!JSON.stringify(value).includes("REDACTED"));
    cases++;
    await inspect(
      mode,
      {
        capture_path: join(runtime.path, "invalid-private-parent.har"),
        format: "har",
        sensitive_values: ["response"],
      },
      "invalid_input",
    );
    cases++;
    await inspect(
      mode,
      {
        capture_path: join(runtime.path, "private-property-absent.har"),
        format: "har",
        sensitive_values: ["private-property", "REDACTED"],
      },
      "invalid_input",
    );
    cases++;
    await inspect(
      mode,
      {
        capture_path: join(runtime.path, "invalid-private-key.mitm"),
        format: "mitmproxy",
        sensitive_values: ["private-property"],
      },
      "invalid_input",
    );
    cases++;
  }
  for (const mode of ["cli", "mcp"]) {
    const value = await inspect(mode, {
      capture_path: join(runtime.path, "flows.mitm"),
      format: "mitmproxy",
      record_ordinals: [0],
      sensitive_values: ["body"],
    });
    assert.equal(
      value.records[0].binary_fields.find(
        (field) => field.pointer === "/request/content",
      ).state,
      "redacted",
    );
    cases++;
  }
  for (const format of ["har", "mitmproxy"]) {
    const path = join(runtime.path, `empty-${format}`);
    await writeFile(
      path,
      format === "har"
        ? JSON.stringify({
            log: {
              version: "1.2",
              creator: { name: "source-owned-empty-fixture", version: "1" },
              entries: [],
            },
          })
        : "",
    );
    for (const mode of ["cli", "mcp"]) {
      const value = await inspect(mode, { capture_path: path, format });
      assert.equal(value.total_records, 0);
      cases++;
    }
  }
} catch (cause) {
  failures.push(cause);
} finally {
  for (const cleanup of [
    () => client.close(),
    () => transport.close(),
    () => runtime.close(),
  ]) {
    try {
      await cleanup();
    } catch (cause) {
      failures.push(cause);
    }
  }
}
const verifier = await completeVerifierRun(run);
try {
  assert.equal(verifier.process_lineage.status, "verified");
  assert.deepEqual(verifier.process_lineage.descendants, []);
} catch (cause) {
  failures.push(cause);
}
if (failures.length > 0) {
  console.error(
    JSON.stringify(
      { status: "failed", public_cases: cases, verifier },
      null,
      2,
    ),
  );
  throw new AggregateError(
    failures,
    "Historical capture verification failed; analysis and cleanup failures are retained.",
  );
}
console.log(
  JSON.stringify(
    {
      status: "passed",
      public_cases: cases,
      upstream: "mitmproxy 12.2.3 FlowWriter + SaveHar",
      native_failure_classifications: 7,
      offline: true,
      verifier,
    },
    null,
    2,
  ),
);

async function inspect(mode, input, errorCategory) {
  if (mode === "mcp") {
    const result = await client.callTool({
      name: "inspect_web_network_capture",
      arguments: input,
    });
    if (errorCategory !== undefined) {
      const error = requireMcpToolError(result);
      assert.equal(error.category, errorCategory);
      const rawError = JSON.parse(mcpTextValue(result)).error;
      for (const literal of input.sensitive_values ?? [])
        assert.ok(!JSON.stringify(rawError).includes(literal));
      return error;
    }
    const value = requireMcpOutput(result, "inspect_web_network_capture");
    assertSensitiveLimitations(value, input.sensitive_values ?? []);
    if (input.format === "har") {
      const surface = await client.callTool({
        name: "inspect_analysis_view",
        arguments: {
          source: { kind: "retained-evidence", evidence_id: value.evidence_id },
          view: { kind: "api-surface" },
        },
      });
      if ((input.sensitive_values ?? []).length > 0) {
        // Derived view text cannot be checked against undisclosed declarations.
        requireMcpToolError(surface);
        const refused = JSON.parse(mcpTextValue(surface));
        for (const literal of input.sensitive_values)
          assert.ok(!JSON.stringify(refused).includes(literal));
      } else {
        const projected = requireMcpOutput(surface, "inspect_analysis_view");
        assert.equal(projected.normalized_result.kind, "api-surface");
        assert.equal(
          projected.normalized_result.records.examined,
          value.normalized_result.records.length,
        );
      }
      const manifest = await client.callTool({
        name: "inspect_analysis_view",
        arguments: {
          source: { kind: "retained-evidence", evidence_id: value.evidence_id },
          view: { kind: "environment-manifest" },
        },
      });
      if ((input.sensitive_values ?? []).length > 0) {
        requireMcpToolError(manifest);
        const refusedManifest = JSON.parse(mcpTextValue(manifest));
        for (const literal of input.sensitive_values)
          assert.ok(!JSON.stringify(refusedManifest).includes(literal));
      } else {
        const projected = requireMcpOutput(manifest, "inspect_analysis_view");
        assert.equal(projected.normalized_result.kind, "environment-manifest");
        assert.equal(projected.normalized_result.unknowns.length, 3);
        for (const record of projected.normalized_result.records)
          assert.deepEqual(Object.keys(record).sort(), [
            "content_type",
            "method",
            "ordinal",
            "path",
            "status",
          ]);
      }
    }
    return value.normalized_result;
  }
  const args = [
    entrypoint,
    "inspect-web-network-capture",
    input.capture_path,
    input.format,
    "--json",
    ...(input.record_ordinals ?? []).flatMap((ordinal) => [
      "--record",
      String(ordinal),
    ]),
    ...(input.sensitive_values ?? []).flatMap((value) => [
      "--sensitive-value",
      value,
    ]),
  ];
  let result;
  try {
    result = await promisify(execFile)(process.execPath, args, {
      env: environment,
      timeout: 40_000,
      maxBuffer: 96 * 1024 * 1024,
    });
  } catch (cause) {
    if (errorCategory === undefined) throw cause;
    assert.equal(typeof cause.code, "number");
    const value = JSON.parse(cause.stdout);
    assert.equal(value.category, errorCategory);
    for (const literal of input.sensitive_values ?? [])
      assert.ok(!JSON.stringify(value).includes(literal));
    return value;
  }
  assert.equal(errorCategory, undefined, "Expected malformed capture to fail");
  const evidence = JSON.parse(result.stdout);
  assertSensitiveLimitations(evidence, input.sensitive_values ?? []);
  return evidence.normalized_result;
}

function assertSensitiveLimitations(evidence, literals) {
  for (const value of Object.values(evidence.parameters))
    if (typeof value === "string")
      for (const literal of literals)
        assert.ok(
          !value.includes(literal),
          "Declared literal retained in Evidence parameter",
        );
  const result = evidence.normalized_result;
  if (result.artifact.sha256 === null) assert.equal(evidence.subject, null);
  else assert.equal(evidence.subject.digest.sha256, result.artifact.sha256);
  assert.deepEqual(
    evidence.provider,
    result.decoder,
    "Evidence provider tuple changed",
  );
  assert.equal(
    result.decoder.name,
    result.format === "har"
      ? "REA HAR capture adapter"
      : "REA offline native mitmproxy adapter",
  );
  const texts = [
    evidence.limitations,
    result.limitations,
    ...result.records.map((record) => record.limitations),
  ].flat();
  for (const literal of literals)
    assert.ok(
      texts.every((text) => !text.includes(literal)),
      "Declared literal retained in authored limitations",
    );
}

function assertBinary(record, pointer, bytes) {
  const field = record.binary_fields.find((item) => item.pointer === pointer);
  assert.ok(field, `Missing native byte field ${pointer}`);
  assert.equal(field.state, "retained");
  assert.equal(field.content_base64, bytes.toString("base64"));
  assert.equal(field.bytes, bytes.length);
  assert.equal(field.sha256, createHash("sha256").update(bytes).digest("hex"));
}
