import { WabtAdmissionError } from "./WabtAdmissionError.js";
import { parseWabtInterface } from "./WabtInterface.js";
import { watString, watStringEnd } from "./WabtString.js";
import { watCommentEnd } from "./WabtComment.js";
import { err, ok, type Result } from "../domain/result.js";

interface WabtNameMetadataFailure {
  readonly _tag: "WabtNameMetadataFailure";
  readonly reason: string;
  /** Names WABT already observed before rejecting the remaining metadata. */
  readonly partial: readonly string[];
}

/** Read only module-name metadata from WABT's preserved name-section payload. */
const moduleNames = (
  bytes: Uint8Array,
): Result<readonly string[], WabtNameMetadataFailure> => {
  const names: string[] = [];
  let offset = 0;
  const uint32 = (end: number): number => {
    let value = 0;
    for (let shift = 0; shift <= 28 && offset < end; shift += 7) {
      const byte = bytes[offset++];
      if (byte === undefined) break;
      if (shift === 28 && byte > 15) break;
      value += (byte & 127) * 2 ** shift;
      if (byte < 128) return value;
    }
    throw new WabtAdmissionError("incomplete_name_metadata");
  };
  try {
    let previousType = -1;
    while (offset < bytes.length) {
      const type = uint32(bytes.length);
      if (type <= previousType)
        throw new WabtAdmissionError("name_subsection_order");
      previousType = type;
      const size = uint32(bytes.length);
      const end = offset + size;
      if (end > bytes.length)
        throw new WabtAdmissionError("incomplete_name_metadata");
      if (type === 0 && size !== 0) {
        const length = uint32(end);
        const nameEnd = offset + length;
        if (nameEnd > end)
          throw new WabtAdmissionError("incomplete_module_name");
        names.push(
          new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
            bytes.subarray(offset, nameEnd),
          ),
        );
        // WABT calls OnModuleName before rejecting trailing subsection bytes.
        if (nameEnd !== end)
          throw new WabtAdmissionError("unfinished_module_name");
      }
      offset = end;
    }
  } catch (cause) {
    if (!(cause instanceof Error)) throw cause;
    return err({
      _tag: "WabtNameMetadataFailure",
      reason: cause.message,
      partial: names,
    });
  }
  return ok(names);
};

/** Extract exact top-level WABT WAT forms; no raw WASM decoding or import/export name unescaping. */
export const parseWabtWat = (text: string) => {
  if (!/^\(module(?:\s|\))/u.test(text))
    throw new WabtAdmissionError("unsupported_module_prefix");
  const forms: string[] = [];
  const imports: string[] = [];
  const exports: string[] = [];
  const customSectionNames: string[] = [];
  const debugModuleNames: string[] = [];
  let debugNameMetadata: "not-present" | "complete" | "uninterpretable" =
    "not-present";
  let depth = 0;
  let start = 0;
  let closed = false;
  const boundaries = /[()";]/gu;
  for (let index = 0; index < text.length; index++) {
    // Instructions and whitespace inside a form cannot change its framing.
    if (depth > 0) {
      boundaries.lastIndex = index;
      const boundary = boundaries.exec(text);
      if (boundary === null) break;
      index = boundary.index;
    }
    const char = text[index];
    const commentEnd = watCommentEnd(text, index);
    if (commentEnd !== undefined) {
      index = commentEnd - 1;
      continue;
    }
    if (char === '"') {
      if (depth === 0) throw new WabtAdmissionError("unexpected_string");
      index = watStringEnd(text, index + 1) - 1;
      continue;
    }
    if (char === "(") {
      if (closed) throw new WabtAdmissionError("unexpected_second_module");
      depth++;
      if (depth === 2) start = index;
    } else if (char === ")") {
      if (depth === 2) {
        const form = text.slice(start, index + 1);
        if (
          /^\((?:type|rec|import|export|func|table|memory|global|tag)\s/u.test(
            form,
          )
        )
          forms.push(form);
        if (/^\(import\s/u.test(form)) imports.push(form);
        else if (/^\(export\s/u.test(form)) exports.push(form);
        else if (/^\(@custom\s/u.test(form)) {
          const prefix = /^\(@custom\s+"/u.exec(form);
          if (prefix === null)
            throw new WabtAdmissionError("unsupported_custom_name");
          const nameString = watString(form, prefix[0].length);
          // A WASM name is length-delimited UTF-8; leading U+FEFF is name data.
          const name = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(nameString.bytes);
          customSectionNames.push(name);
          if (name === "name") {
            const payloadPrefix = /^\s+"/u.exec(form.slice(nameString.end));
            if (payloadPrefix === null)
              throw new WabtAdmissionError("unsupported_name_payload");
            const payload = watString(
              form,
              nameString.end + payloadPrefix[0].length,
            );
            const names = moduleNames(payload.bytes);
            // Framing needs every observed display, even when optional
            // metadata coverage is incomplete in this or an earlier section.
            debugModuleNames.push(
              ...(names.ok ? names.value : names.error.partial),
            );
            if (!names.ok) {
              debugNameMetadata = "uninterpretable";
            } else if (debugNameMetadata !== "uninterpretable") {
              debugNameMetadata = "complete";
            }
          }
        }
      }
      if (--depth < 0) throw new WabtAdmissionError("unbalanced_output");
      if (depth === 0) closed = true;
    } else if (depth === 0 && char !== undefined && !/\s/u.test(char))
      throw new WabtAdmissionError("unexpected_text");
  }
  if (depth !== 0) throw new WabtAdmissionError("incomplete_output");
  return {
    imports,
    exports,
    customSectionNames,
    debugModuleNames,
    debugNameMetadata,
    interface: parseWabtInterface(forms),
  };
};
