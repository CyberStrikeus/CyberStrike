/** Largest accepted session message, including the encoded command result. */
export const MAX_CLI_SESSION_FRAME_BYTES = 64 * 1024 * 1024;

/** Length-prefixed JSON frame shared by the session parent and worker. */
export const encodeCliSessionFrame = (value) => {
  const body = Buffer.from(JSON.stringify(value));
  if (body.length > MAX_CLI_SESSION_FRAME_BYTES) {
    throw new Error(
      `CLI session frame is ${body.length} bytes; the limit is ${MAX_CLI_SESSION_FRAME_BYTES}`,
    );
  }
  const frame = Buffer.allocUnsafe(4 + body.length);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  return frame;
};

const frameLimitError = (length) =>
  new Error(
    `CLI session frame is ${length} bytes; the limit is ${MAX_CLI_SESSION_FRAME_BYTES}`,
  );

/** Read a big-endian length from the start of a chunk list without joining it. */
const readFrameLength = (chunks) => {
  const first = chunks[0];
  if (first.length >= 4) return first.readUInt32BE(0);
  const header = Buffer.allocUnsafe(4);
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.length, 4 - offset);
    chunk.copy(header, offset, 0, take);
    offset += take;
    if (offset === 4) break;
  }
  return header.readUInt32BE(0);
};

/**
 * Parse complete frames from a byte stream. An oversized or malformed frame
 * fails the reader instead of resynchronizing on a later length. Incomplete
 * chunks stay separate until one whole frame is buffered, then that frame is
 * joined once.
 */
export const createCliSessionFrameReader = (onFrame) => {
  /** @type {Buffer[]} */
  const chunks = [];
  let buffered = 0;
  return (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(bytes);
    buffered += bytes.length;
    if (buffered < 4) return;
    const length = readFrameLength(chunks);
    if (length > MAX_CLI_SESSION_FRAME_BYTES) throw frameLimitError(length);
    if (buffered < 4 + length) return;
    const pending = Buffer.concat(chunks);
    let offset = 0;
    try {
      while (offset + 4 <= pending.length) {
        const frameLength = pending.readUInt32BE(offset);
        if (frameLength > MAX_CLI_SESSION_FRAME_BYTES) {
          throw frameLimitError(frameLength);
        }
        const frameEnd = offset + 4 + frameLength;
        if (frameEnd > pending.length) break;
        const body = pending.toString("utf8", offset + 4, frameEnd);
        offset = frameEnd;
        onFrame(JSON.parse(body));
      }
    } finally {
      const rest = pending.subarray(offset);
      chunks.length = 0;
      buffered = rest.length;
      if (rest.length > 0) chunks.push(Buffer.from(rest));
    }
  };
};
