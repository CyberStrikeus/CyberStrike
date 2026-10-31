import { Writable } from "node:stream";

import { Cli, Formatter } from "incur";
import { estimateTokenCount } from "tokenx";
import { describe, expect, it } from "vitest";

import { parseCliOutputArguments } from "../../../src/cliOutput.js";
import {
  createCliResultOutput,
  streamCliCommandResults,
} from "../../../src/cli/cliResultOutput.js";

const renderWindow = async (
  value: unknown,
  offset: number,
  limit: number,
  fullOutput = false,
  terminal = false,
  formatExplicit = true,
): Promise<{ readonly handled: boolean; readonly text: string }> => {
  const chunks: Buffer[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });
  if (terminal) Object.defineProperty(destination, "isTTY", { value: true });
  const argv = [
    "fixture",
    ...(formatExplicit ? ["--format", "toon"] : []),
    ...(fullOutput ? ["--full-output"] : []),
    "--token-limit",
    String(limit),
    "--token-offset",
    String(offset),
  ];
  const output = createCliResultOutput(
    parseCliOutputArguments(argv),
    destination,
  );
  if (output === undefined) throw new Error("Missing TOON output surface");
  const handled = await output.write(value, {
    command: "fixture",
    duration: "0ms",
    format: "toon",
  });
  return { handled, text: Buffer.concat(chunks).toString("utf8") };
};

describe("successful CLI token windows", () => {
  it.each([undefined, null, ""])(
    "preserves the full-output data field for a fitting empty value (%j)",
    async (value) => {
      const page = await renderWindow(value, 0, 1000, true);
      expect(page.handled).toBe(true);
      expect(page.text).toBe(
        `${Formatter.format(
          {
            ok: true,
            data: value,
            meta: { command: "fixture", duration: "0ms" },
          },
          "toon",
        )}\n`,
      );
    },
  );

  it("preserves an existing final newline when the whole result fits", async () => {
    const page = await renderWindow("abcdefghij\n", 0, 1000);
    expect(page.handled).toBe(true);
    expect(page.text).toBe("abcdefghij\n");
  });

  it.each([false, true])(
    "owns fitting windows and preserves full-output structure (%s)",
    async (fullOutput) => {
      const value = { text: "😀é", nested: { value: 42 } };
      const page = await renderWindow(value, 0, 1000, fullOutput);
      expect(page.handled).toBe(true);
      expect(page.text).toBe(
        `${Formatter.format(
          fullOutput
            ? {
                ok: true,
                data: value,
                meta: { command: "fixture", duration: "0ms" },
              }
            : value,
          "toon",
        )}\n`,
      );
      expect(page.text).not.toContain("nextOffset");
      expect(page.text).not.toContain("[truncated:");
    },
  );

  it("does not reformat a fitting ordinary result", async () => {
    let reads = 0;
    const page = await renderWindow(
      {
        get text() {
          reads++;
          return "abcdefghij";
        },
      },
      0,
      1000,
    );
    expect(page.handled).toBe(true);
    // TOON reads this property once per formatting pass.
    expect(reads).toBe(1);
    expect(page.text).toBe("text: abcdefghij\n");
  });

  it.each([
    { terminal: false, formatExplicit: false },
    { terminal: true, formatExplicit: false },
    { terminal: true, formatExplicit: true },
  ])(
    "preserves digest and Unicode pages ($terminal, $formatExplicit)",
    async ({ terminal, formatExplicit }) => {
      const value = {
        sha256:
          "6764c190e641f1c59c638f9bf32fee05f66992811c5605ebd25056156f21e221",
        text: "😀é".repeat(300),
      };
      const full = Formatter.format(value, "toon");
      const total = estimateTokenCount(full);
      const pages: string[] = [];
      for (let offset = 0; offset < total; offset += 10) {
        const page = await renderWindow(
          value,
          offset,
          10,
          false,
          terminal,
          formatExplicit,
        );
        expect(page.handled).toBe(true);
        const marker = page.text.lastIndexOf("\n[truncated: showing tokens ");
        expect(marker).toBeGreaterThanOrEqual(0);
        pages.push(page.text.slice(0, marker));
      }
      const joined = pages.join("");
      expect(joined).toBe(full);
      expect(joined).toContain(value.sha256);
      expect(joined).not.toContain("\uFFFD");
    },
  );

  it("retains full-output metadata while returning a truncated page", async () => {
    const page = await renderWindow(
      { value: "abcdefghij" },
      0,
      2,
      true,
      true,
      false,
    );
    expect(page.handled).toBe(true);
    expect(page.text).toContain("ok: true");
    expect(page.text).toContain("nextOffset: 2");
    expect(page.text).toContain("showing tokens 0–2 of");
  });

  it.each(["abcdefghij abcdefghij abcdefghij \n", "  😀é abcdefghij\t\r\n"])(
    "preserves all whitespace across text pages: %j",
    async (value) => {
      let joined = "";
      const total = estimateTokenCount(value);
      for (let offset = 0; offset < total; offset += 1) {
        const page = await renderWindow(value, offset, 1);
        expect(page.handled).toBe(true);
        joined += page.text.slice(
          0,
          page.text.lastIndexOf("\n[truncated: showing tokens "),
        );
      }
      expect(joined).toBe(value);
    },
  );
});

describe("token windows through Incur output policies", () => {
  it.each([{ windowFlags: [] }, { windowFlags: ["--token-limit", "2"] }])(
    "retains filtered typed failures despite suppressed human results ($windowFlags)",
    async ({ windowFlags }) => {
      let text = "";
      const destination = new Writable({
        write(chunk, _encoding, callback) {
          text += chunk.toString();
          callback();
        },
      });
      const output = createCliResultOutput(
        parseCliOutputArguments([
          "fixture",
          "--filter-output",
          "missing",
          ...windowFlags,
        ]),
        destination,
      )!;
      const handled = await output.write(
        {
          error: "Analysis failed",
          code: "target_unavailable",
          category: "unavailable",
          message: "Artifact missing",
          retryable: false,
          remediation: { action: "Check the path." },
          details: {},
        },
        {
          command: "fixture",
          duration: "0ms",
          format: "toon",
          renderOutput: false,
        },
      );
      expect(handled).toBe(true);
      expect(text).toContain("target_unavailable");
      expect(text).toContain("Artifact missing");
    },
  );
  it.each([
    { terminal: true, flags: [], visible: false },
    { terminal: false, flags: [], visible: true },
    { terminal: true, flags: ["--format", "toon"], visible: true },
    { terminal: true, flags: ["--full-output"], visible: true },
    { terminal: true, flags: ["--token-count"], visible: true },
  ])(
    "honors agent-only presentation ($terminal, $flags)",
    async ({ terminal, flags, visible }) => {
      const descriptor = Object.getOwnPropertyDescriptor(
        process.stdout,
        "isTTY",
      );
      Object.defineProperty(process.stdout, "isTTY", {
        value: terminal,
        configurable: true,
      });
      try {
        for (const grouped of [false, true]) {
          const argv = [
            ...(grouped ? ["group"] : []),
            "fixture",
            "--token-limit",
            "2",
            ...flags,
          ];
          let text = "";
          const destination = new Writable({
            write(chunk, _encoding, callback) {
              text += chunk.toString();
              callback();
            },
          });
          const output = createCliResultOutput(
            parseCliOutputArguments(argv),
            destination,
          )!;
          const cli = Cli.create("policy-test", { sync: false });
          if (grouped) {
            const group = Cli.create("group", {
              sync: false,
              outputPolicy: "agent-only",
            });
            group.command("fixture", {
              run: () => ({ value: "😀é".repeat(100) }),
            });
            cli.command(group);
          } else {
            cli.command("fixture", {
              outputPolicy: "agent-only",
              run: () => ({ value: "😀é".repeat(100) }),
            });
          }
          streamCliCommandResults(cli, output);
          await cli.serve(argv, {
            stdout: (chunk) => {
              if (!output.handled) text += chunk;
            },
            exit: () => {},
          });
          expect(text.length > 0).toBe(visible);
          expect(text).not.toContain("\uFFFD");
          if (visible && !flags.includes("--token-count"))
            expect(text).toContain("showing tokens 0–2 of");
        }
      } finally {
        if (descriptor)
          Object.defineProperty(process.stdout, "isTTY", descriptor);
        else Reflect.deleteProperty(process.stdout, "isTTY");
      }
    },
  );
});
