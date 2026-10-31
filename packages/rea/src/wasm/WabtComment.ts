import { WabtAdmissionError } from "./WabtAdmissionError.js";

/** Skip a WAT comment without interpreting its punctuation as forms or strings. */
export const watCommentEnd = (
  text: string,
  start: number,
): number | undefined => {
  if (text.startsWith(";;", start)) {
    // WAT admits LF, CR, and CRLF as newlines; neither CR nor LF is
    // comment content, even when a producer uses CR-only output.
    for (let index = start + 2; index < text.length; index++) {
      if (text[index] === "\n") return index + 1;
      if (text[index] === "\r")
        return index + (text[index + 1] === "\n" ? 2 : 1);
    }
    return text.length;
  }
  if (!text.startsWith("(;", start)) return undefined;
  let depth = 1;
  for (let index = start + 2; index < text.length - 1; index++) {
    if (text.startsWith("(;", index)) {
      depth++;
      index++;
    } else if (text.startsWith(";)", index)) {
      if (--depth === 0) return index + 2;
      index++;
    }
  }
  throw new WabtAdmissionError("incomplete_comment");
};
