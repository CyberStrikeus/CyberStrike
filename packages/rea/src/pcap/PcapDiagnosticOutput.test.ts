import { expect, it } from "vitest";
import { createPcapDiagnosticProjection } from "./PcapDiagnosticOutput.js";

const project = (stdout: string, truncated = false) =>
  createPcapDiagnosticProjection(true)({
    stdout,
    stderr: "selected path: /tmp/caller@data.pcap",
    truncated,
  });

it("removes only parsed HTTP userinfo spans without rewriting JSON or other URI bytes", () => {
  const source = String.raw`{ "dns.qry.name": ["http://caller:keep@data"], "http.request.full_uri": ["http:\/\/u\u0073er:p\u0040ass@host/a/../b?q=%2F#tag"] }`;
  expect(project(source)).toEqual({
    stdout: source.replace(String.raw`u\u0073er:p\u0040ass@`, ""),
    stderr: "selected path: /tmp/caller@data.pcap",
    truncated: false,
  });
});

it.each([
  "http.request.uri",
  "http.request.full_uri",
  "http2.request.full_uri",
])("uses HTTP URI context for %s", (field) => {
  const source = JSON.stringify({
    [field]: ["https://user:password@host/path", "/users/caller@name?q=keep"],
  });
  expect(project(source).stdout).toBe(
    JSON.stringify({
      [field]: ["https://host/path", "/users/caller@name?q=keep"],
    }),
  );
});

it("withholds incomplete HTTP values at every truncation position", () => {
  const source = JSON.stringify({
    "http.request.full_uri": ["http://user:SYNTHETIC_PCAP_AUTH_83A4@host/path"],
  });
  const start = source.indexOf("user:") + 1;
  let checked = 0;
  for (let cutoff = start; cutoff < source.length; cutoff++) {
    const output = project(source.slice(0, cutoff), true);
    expect(output.truncated).toBe(true);
    expect(output.stdout).not.toContain("http://user:");
    expect(output.stdout).not.toContain("SYNTHETIC_PCAP_AUTH_83A4");
    checked++;
  }
  expect(checked).toBe(source.length - start);
});

it.each([
  String.raw`{"http.request.full_uri":["http://user:password@host\q"]}`,
  String.raw`{"http.request.full_uri" "http://user:password@host"]}`,
  `not-json http://user:password@host`,
])("withholds an unclassified malformed suffix", (source) => {
  const output = project(source);
  expect(output.truncated).toBe(true);
  expect(output.stdout).not.toContain("password");
});

it("marks ambiguous URL spellings as omitted and retains empty diagnostics", () => {
  expect(
    project(
      JSON.stringify({
        "http.request.full_uri": ["http://u\tser:password@host/path"],
      }),
    ),
  ).toMatchObject({
    stdout: '{"http.request.full_uri":[""]}',
    truncated: true,
  });
  expect(project("")).toMatchObject({ stdout: "", truncated: false });
});

it("preserves non-JSON command modes and original truncation flags", () => {
  const output = {
    stdout: "http://caller:keep@path",
    stderr: "ordinary warning",
    truncated: true,
    exit_code: 7,
  };
  expect(createPcapDiagnosticProjection(false)(output)).toBe(output);
  const projector = createPcapDiagnosticProjection(true);
  const raw = JSON.stringify({
    "http.request.uri": ["http://user:password@host/path"],
  });
  expect(projector({ ...output, stdout: raw })).toEqual({
    ...output,
    stdout: '{"http.request.uri":["http://host/path"]}',
  });
  expect(projector({ ...output, stdout: raw, exit_code: 9 }).exit_code).toBe(9);
});

it("keeps byte completeness separate from malformed complete producer output", () => {
  expect(project("{")).toMatchObject({ stdout: "{", truncated: false });
  expect(
    project('{"http.request.uri":["http://user:password@host"]'),
  ).toMatchObject({
    stdout: '{"http.request.uri":["http://host"]',
    truncated: false,
  });
});

it("preserves origin-form targets and HTTP/2 paths as recorded path data", () => {
  const source = JSON.stringify({
    "http.request.uri": ["//caller:keep@path/a?value=%2F"],
    "http2.headers.path": [
      "//caller:keep@path/a",
      "https://caller:keep@path/a",
    ],
  });
  expect(project(source)).toEqual({
    stdout: source,
    stderr: "selected path: /tmp/caller@data.pcap",
    truncated: false,
  });
});
