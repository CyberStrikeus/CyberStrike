import { readStableArtifact } from "../../artifacts/readStableArtifact.js";
import { WEB_SOURCE_MAP_LIMITS } from "../../domain/webSourceLocation.js";
import { traceSourceMap } from "./TraceSourceMap.js";
import { SourceMapFormatFailure } from "./SourceMapFormat.js";
import {
  sourceMapCodecInputSchema,
  sourceMapCodecReplySchema,
} from "./SourceMapCodecProtocol.js";
import { z } from "zod";

/** Dedicated process entrypoint invoked only for an explicitly selected map. */
const execute = async (): Promise<string> => {
  try {
    const path = process.argv[2];
    if (path === undefined)
      throw new SourceMapFormatFailure(
        "format",
        "Codec request path is missing.",
      );
    const data = await readStableArtifact(
      path,
      WEB_SOURCE_MAP_LIMITS.outputBytes,
    );
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data.bytes);
    const value: unknown = JSON.parse(text);
    const input = sourceMapCodecInputSchema.parse(value);
    if (Buffer.byteLength(input.text) > WEB_SOURCE_MAP_LIMITS.mapBytes)
      throw new SourceMapFormatFailure(
        "limit",
        "Source map exceeds the 4 MiB codec input budget.",
      );
    const report = traceSourceMap(input.text, input.url, input.position);
    const reply = JSON.stringify(
      sourceMapCodecReplySchema.parse({ state: "success", report }),
    );
    if (Buffer.byteLength(reply) > WEB_SOURCE_MAP_LIMITS.outputBytes)
      throw new SourceMapFormatFailure(
        "limit",
        "Complete source-map point evidence exceeds the 32 MiB output budget; no partial evidence was returned.",
      );
    return reply;
  } catch (cause: unknown) {
    if (
      !(
        cause instanceof SourceMapFormatFailure ||
        cause instanceof z.ZodError ||
        cause instanceof SyntaxError
      )
    )
      throw cause;
    return JSON.stringify({
      state: "failure",
      reason:
        cause instanceof SourceMapFormatFailure &&
        cause.reason !== "section-overlap"
          ? cause.reason
          : "format",
      message: cause.message,
    });
  }
};

process.stdout.write(await execute());
