import { expect, it } from "vitest";

import { AnalysisResourceConstraintError } from "../domain/analysisErrorCore.js";
import {
  bridgeMaxRequestBytesRecovery,
  type BridgeMaxRequestBytes,
} from "../config/bridgeMaxRequestBytes.js";
import {
  CutterAuthenticatedResponseDecoder,
  CutterBridgeResponseFrames,
} from "./cutterAuthenticatedResponse.js";

const limit = (
  maximumBytes: number,
  source: BridgeMaxRequestBytes["source"] = "setting",
): BridgeMaxRequestBytes => ({ maximumBytes, source });

const PROOF = "ab".repeat(32);

const envelope = (response: string, proof = PROOF): Buffer =>
  Buffer.from(JSON.stringify({ response, proof }));

const decode = (
  frame: Buffer,
  maximumBytes: number,
  chunkSize = frame.length,
): { readonly response: string; readonly proof: string } => {
  const decoder = new CutterAuthenticatedResponseDecoder(limit(maximumBytes));
  for (let offset = 0; offset < frame.length; offset += chunkSize)
    decoder.push(
      frame.subarray(offset, Math.min(frame.length, offset + chunkSize)),
    );
  return decoder.finish();
};

const splitPoints = (length: number): number[] =>
  [1, 2, 3, 7, 13, 64, 65].filter((size) => size < length);

it("decodes an authenticated response split at escape and proof boundaries", () => {
  const response = JSON.stringify({
    ok: true,
    output:
      'quote " slash \\ newline \n unit \u0001 line \u2028 snow 雪 emoji 😀',
    empty: "",
  });
  const frame = envelope(response);
  const parsed = JSON.parse(frame.toString("utf8")) as {
    response: string;
    proof: string;
  };
  expect(decode(frame, frame.length).response).toBe(parsed.response);
  expect(decode(frame, frame.length).proof).toBe(PROOF);
  for (const size of splitPoints(frame.length))
    expect(decode(frame, frame.length, size).response).toBe(response);
  expect(decode(envelope(""), envelope("").length).response).toBe("");
  const slashes = "\\".repeat(32_000);
  expect(
    decode(envelope(slashes), envelope(slashes).length, 64 * 1024).response,
  ).toBe(slashes);
  expect(
    decode(Buffer.from(`{"response":"\\u0041","proof":"${PROOF}"}`), 256)
      .response,
  ).toBe("A");
});

it("accepts a raw UTF-8 line separator inside the response string", () => {
  const response = `{"ok":"${String.fromCharCode(0x2028)}"}`;
  const body = Buffer.concat(
    [...response].map((character) => {
      if (character === '"') return Buffer.from('\\"');
      if (character === "\\") return Buffer.from("\\\\");
      return Buffer.from(character, "utf8");
    }),
  );
  const frame = Buffer.concat([
    Buffer.from('{"response":"'),
    body,
    Buffer.from(`","proof":"${PROOF}"}`),
  ]);
  expect(decode(frame, frame.length, 5).response).toBe(response);
  expect(
    (
      JSON.parse(frame.toString("utf8")) as {
        response: string;
      }
    ).response,
  ).toBe(response);
});

it("decodes a surrogate-pair escape into one code point", () => {
  const frame = Buffer.from(`{"response":"\\uD83D\\uDE00","proof":"${PROOF}"}`);
  expect(decode(frame, frame.length, 3).response).toBe("😀");
});

it("refuses a malformed envelope, a bad escape, and an unfinished frame", () => {
  const ceiling = limit(4096);
  const refuse = (frame: Buffer): void => {
    const decoder = new CutterAuthenticatedResponseDecoder(ceiling);
    expect(() => {
      decoder.push(frame);
      decoder.finish();
    }).toThrow("invalid authenticated response");
  };
  refuse(Buffer.from(`{"ok":false,"proof":"${PROOF}"}`));
  refuse(Buffer.from(`{"response":"\\x","proof":"${PROOF}"}`));
  refuse(Buffer.from(`{"response":"\\uD800","proof":"${PROOF}"}`));
  refuse(Buffer.from(`{"response":"ok","proof":"${"AB".repeat(32)}"}`));
  refuse(Buffer.from(`{"response":"ok","proof":"${PROOF}"} `));
  const decoder = new CutterAuthenticatedResponseDecoder(ceiling);
  decoder.push(Buffer.from('{"response":"ok"'));
  expect(() => decoder.finish()).toThrow("invalid authenticated response");
});

it("reports the configured ceiling when a response frame does not fit", () => {
  const frame = envelope("x".repeat(80));
  const ceiling = limit(64);
  const decoder = new CutterAuthenticatedResponseDecoder(ceiling);
  let caught: unknown;
  try {
    decoder.push(frame);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AnalysisResourceConstraintError);
  const error = caught as AnalysisResourceConstraintError;
  expect(error._tag).toBe("AnalysisResourceConstraintError");
  expect(error.operation).toBe("cutter_command");
  expect(error.resource).toBe("transport");
  expect(error.reportedLimits).toMatchObject({ max_request_bytes: 64 });
  expect(error.remediationAction).toBe(
    bridgeMaxRequestBytesRecovery(ceiling, "Cutter"),
  );
});

it("reads one challenge and one response without buffering a third frame", () => {
  const challenge = Buffer.from(
    `${JSON.stringify({
      session_id: "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a",
      nonce: "c".repeat(64),
      proof: "d".repeat(64),
    })}\n`,
  );
  const response = JSON.stringify({ output: "split 雪" });
  const body = Buffer.concat([envelope(response), Buffer.from("\n")]);
  const frames = new CutterBridgeResponseFrames(limit(4096, "default"));
  const seen: string[] = [];
  const combined = Buffer.concat([challenge, body]);
  for (let offset = 0; offset < combined.length; offset += 5)
    frames.push(combined.subarray(offset, offset + 5), (frame) => {
      if (frame.kind === "challenge") {
        seen.push("challenge");
        return true;
      }
      seen.push(frame.response);
      return false;
    });
  expect(seen).toEqual(["challenge", response]);
  expect(() => frames.push(Buffer.from("{"), () => true)).toThrow(
    "more than two protocol frames",
  );
});

it("refuses an oversized authentication challenge before the response", () => {
  const frames = new CutterBridgeResponseFrames(limit(4096));
  expect(() => frames.push(Buffer.alloc(2049, 0x7b), () => true)).toThrow(
    "invalid authentication challenge",
  );
});
