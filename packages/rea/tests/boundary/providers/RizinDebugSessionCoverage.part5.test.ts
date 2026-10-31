import { afterEach, expect, it } from "vitest";
import { createRizinCoverageHarness } from "./RizinDebugSessionCoverage.fixtures.js";

const { cleanup, makeProvider, start } = createRizinCoverageHarness();
afterEach(cleanup);

it.skipIf(process.platform === "win32")(
  "keeps command output bounded when many frames arrive for a command",
  async () => {
    const provider = await makeProvider(
      `process.stdout.write("\\0");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const end = input.indexOf("\\n");
    if (end < 0) break;
    const line = input.slice(0, end); input = input.slice(end + 1);
    if (line === "many") process.stdout.write(Array.from({ length: 4100 }, (_, i) => "frame" + i + "\\0").join(""));
    else if (line.startsWith("!echo ")) process.stdout.write(line.slice(6) + "\\0");
  }
});`,
    );
    const { manager, sessionId } = await start(provider, {
      frameTimeoutMs: 1000,
    });
    const result = await manager.execute(sessionId, "many");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.result).toMatchObject({
        output_truncated: true,
        completion_status: "unknown",
      });
      const limitations = result.value.evidence.limitations.join("\n");
      expect(limitations).toContain("4096 frame command limit");
      expect(limitations).not.toContain("16777216");
    }
  },
);

it.skipIf(process.platform === "win32")(
  "returns partial evidence when the command frame deadline is already expired",
  async () => {
    const provider = await makeProvider(
      'process.stdout.write("\\0"); process.stdin.resume();',
    );
    const { manager, sessionId } = await start(provider, {
      frameTimeoutMs: 0,
    });
    const result = await manager.execute(sessionId, "dr");
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.result).toMatchObject({
        output: "",
        output_truncated: true,
        completion_status: "unknown",
      });
  },
);

it.skipIf(process.platform === "win32")(
  "does not exceed the exact command byte cap when marker output follows a full frame",
  async () => {
    const provider = await makeProvider(
      `process.stdout.write("\\0");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const end = input.indexOf("\\n");
    if (end < 0) break;
    const line = input.slice(0, end); input = input.slice(end + 1);
    if (line === "full") process.stdout.write(Buffer.alloc(16 * 1024 * 1024, 0x61).toString() + "\\0");
    else if (line.startsWith("!echo ")) process.stdout.write("x" + line.slice(6) + "\\0");
  }
});`,
    );
    const { manager, sessionId } = await start(provider, {
      frameTimeoutMs: 3000,
    });
    const result = await manager.execute(sessionId, "full");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Buffer.byteLength(result.value.result.output, "utf8")).toBe(
        16 * 1024 * 1024,
      );
      expect(result.value.result).toMatchObject({
        output_truncated: true,
        completion_status: "unknown",
      });
    }
  },
);

it.skipIf(process.platform === "win32")(
  "caps aggregate output across multiple valid NUL frames",
  async () => {
    const provider = await makeProvider(
      `process.stdout.write("\\0");
let input = "";
let aggregatePending = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const end = input.indexOf("\\n");
    if (end < 0) break;
    const line = input.slice(0, end); input = input.slice(end + 1);
    if (line === "aggregate") {
      process.stdout.write("a".repeat(10 * 1024 * 1024) + "\\0");
      aggregatePending = true;
    } else if (line.startsWith("!echo ")) {
      process.stdout.write((aggregatePending ? "b".repeat(7 * 1024 * 1024) : "") + line.slice(6) + "\\0");
      aggregatePending = false;
    }
  }
});`,
    );
    const { manager, sessionId } = await start(provider, {
      frameTimeoutMs: 3000,
    });
    const result = await manager.execute(sessionId, "aggregate");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Buffer.byteLength(result.value.result.output, "utf8")).toBe(
        16 * 1024 * 1024,
      );
      expect(result.value.result.completion_status).toBe("unknown");
    }
  },
);

it.skipIf(process.platform === "win32")(
  "truncates an oversized NUL frame without decoding a split UTF-8 character",
  async () => {
    const provider = await makeProvider(
      `process.stdout.write("\\0");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const end = input.indexOf("\\n");
    if (end < 0) break;
    const line = input.slice(0, end); input = input.slice(end + 1);
    if (line === "large") {
      process.stdout.write("prefix\\0");
      process.stdout.write(Buffer.alloc(16 * 1024 * 1024 + 1, 0xF0));
    } else if (line.startsWith("!echo ")) process.stdout.write("\\0" + line.slice(6) + "\\0");
  }
});`,
    );
    const { manager, sessionId } = await start(provider, {
      frameTimeoutMs: 2000,
    });
    const result = await manager.execute(sessionId, "large");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.result).toMatchObject({
        output_truncated: true,
        completion_status: "unknown",
      });
      expect(result.value.result.output.startsWith("prefix\n")).toBe(true);
    }
  },
);

it.skipIf(process.platform === "win32")(
  "truncates an oversized frame when its NUL boundary arrives with the crossing chunk",
  async () => {
    const provider = await makeProvider(
      `process.stdout.write("\\0");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const end = input.indexOf("\\n");
    if (end < 0) break;
    const line = input.slice(0, end); input = input.slice(end + 1);
    if (line === "large") {
      const frame = Buffer.alloc(16 * 1024 * 1024 + 2, 0x61);
      frame[frame.length - 1] = 0;
      process.stdout.write(frame);
    } else if (line.startsWith("!echo ")) process.stdout.write(line.slice(6) + "\\0");
  }
});`,
    );
    const { manager, sessionId } = await start(provider, {
      frameTimeoutMs: 2000,
    });
    const result = await manager.execute(sessionId, "large");
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.result).toMatchObject({
        output_truncated: true,
        completion_status: "unknown",
      });
  },
);
