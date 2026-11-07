import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { readStableArtifact } from "../../artifacts/readStableArtifact.js";
import { WEB_NETWORK_CAPTURE_LIMITS } from "../../domain/webNetworkCapture.js";
import { CaptureFormatError } from "./CaptureFormatError.js";

const requestSchema = z.strictObject({
  snapshot_path: z.string(),
  reply_path: z.string(),
  sensitive_values: z.array(z.string().min(1)),
});

/** Parse untrusted captures in an owned heap and return one complete bounded reply. */
const main = async (): Promise<void> => {
  const format = z.enum(["har", "saz", "qlog"]).parse(process.argv[3]);
  const request = requestSchema.parse(
    JSON.parse(await readFile(process.argv[2] ?? "", "utf8")),
  );
  let reply: unknown;
  try {
    let value;
    if (format !== "saz") {
      const { decodeCaptureText } = await import("./CaptureJson.js");
      const decoder =
        format === "har"
          ? (await import("./HarCapture.js")).decodeHarCapture
          : (await import("./QlogCapture.js")).decodeQlogCapture;
      const snapshot = await readStableArtifact(
        request.snapshot_path,
        WEB_NETWORK_CAPTURE_LIMITS.inputBytes,
      );
      value = decoder(
        decodeCaptureText(snapshot.bytes, format === "har" ? "HAR" : "qlog"),
        request.sensitive_values,
      );
    } else {
      const { decodeSazCapture } = await import("./SazCapture.js");
      value = await decodeSazCapture(
        request.snapshot_path,
        request.sensitive_values,
      );
    }
    reply = { ok: true, value };
  } catch (cause: unknown) {
    reply =
      cause instanceof CaptureFormatError
        ? {
            ok: false,
            reason: cause.reason,
            message: cause.message,
            pointer: cause.pointer,
          }
        : {
            ok: false,
            reason: "decoder",
            message: `Capture decoder failed unexpectedly (${cause instanceof Error ? cause.name : "unknown exception"}).`,
            pointer: "",
          };
  }
  let text = JSON.stringify(reply);
  if (Buffer.byteLength(text) > WEB_NETWORK_CAPTURE_LIMITS.outputBytes)
    text = JSON.stringify({
      ok: false,
      reason: "limit",
      message:
        "Capture reply exceeds the complete-evidence output budget. This release has no runtime override.",
      pointer: "",
    });
  await writeFile(request.reply_path, text, { flag: "wx", mode: 0o600 });
};
await main();
