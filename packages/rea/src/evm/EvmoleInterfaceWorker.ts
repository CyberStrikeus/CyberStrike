import { EvmAdmissionError } from "./EvmAdmissionError.js";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  decodeEvmBytecodeCarrier,
  EvmCarrierFailure,
} from "./EvmBytecodeCarrier.js";
import { evmoleInterfaceReplySchema } from "./EvmoleInterfaceAdapter.js";
import { inspectSolidityMetadata } from "./SolidityMetadata.js";
import {
  EVM_INTERFACE_LIMITS,
  EVM_FILE_SIZE_FAILURE_EXIT,
} from "./EvmoleRelease.js";

const requestSchema = z.strictObject({
  snapshot_path: z.string(),
  reply_path: z.string(),
  failure_marker_path: z.string(),
  encoding: z.enum(["raw", "hex"]),
});
class UnsupportedContainer extends Error {}

const main = async (): Promise<void> => {
  const requestPath = process.argv[2];
  if (requestPath === undefined)
    throw new EvmAdmissionError("request_path_missing");
  const request = requestSchema.parse(
    JSON.parse(await readFile(requestPath, "utf8")),
  );
  let reply: unknown;
  try {
    const bytes = decodeEvmBytecodeCarrier(
      await readFile(request.snapshot_path),
      request.encoding,
    );
    if (bytes[0] === 0xef && bytes[1] === 0x00)
      throw new UnsupportedContainer(
        "Container marker EF00 is outside the verified flat-bytecode interface profile.",
      );
    const modulePath = import.meta.resolve("evmole/no_tla");
    const metadata = z
      .object({ version: z.literal("0.9.3") })
      .parse(
        JSON.parse(
          await readFile(new URL("../package.json", modulePath), "utf8"),
        ),
      );
    const engine = await import("evmole/no_tla");
    engine.initSync({
      module: await readFile(
        new URL(import.meta.resolve("evmole/evmole_bg.wasm")),
      ),
    });
    const raw = evmoleInterfaceReplySchema.parse(
      engine.contractInfo(Buffer.from(bytes).toString("hex"), {
        selectors: true,
        arguments: true,
        stateMutability: true,
      }),
    );
    reply = {
      ok: true,
      version: metadata.version,
      bytecode: {
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
        hex: Buffer.from(bytes).toString("hex"),
        metadata: inspectSolidityMetadata(bytes),
      },
      raw,
    };
  } catch (cause: unknown) {
    reply = {
      ok: false,
      reason:
        cause instanceof EvmCarrierFailure
          ? "format"
          : cause instanceof UnsupportedContainer
            ? "unsupported"
            : "decoder",
      message: cause instanceof Error ? cause.message : String(cause),
    };
  }
  let encoded = JSON.stringify(reply);
  if (Buffer.byteLength(encoded) > EVM_INTERFACE_LIMITS.outputBytes)
    encoded = JSON.stringify({
      ok: false,
      reason: "output-limit",
      message: "Complete interface evidence exceeds the 16 MiB reply budget.",
    });
  try {
    await writeFile(request.reply_path, encoded, { flag: "wx", mode: 0o600 });
  } catch (cause: unknown) {
    if (cause instanceof Error && "code" in cause && cause.code === "EFBIG") {
      try {
        await writeFile(request.failure_marker_path, "F", {
          flag: "wx",
          mode: 0o600,
        });
      } catch (markerFailure: unknown) {
        process.stderr.write(
          `File-size failure marker unavailable: ${markerFailure instanceof Error ? markerFailure.message : String(markerFailure)}\n`,
        );
      }
      process.exitCode = EVM_FILE_SIZE_FAILURE_EXIT;
    } else throw cause;
  }
};

await main();
