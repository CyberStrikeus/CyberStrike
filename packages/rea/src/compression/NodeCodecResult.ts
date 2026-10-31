/** Parse Node's info:true codec result, absent from the pinned @types/node overloads. */
export const nodeCodecResult = (
  value: unknown,
): {
  readonly buffer: Buffer;
  readonly consumedBytes: number;
} => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("buffer" in value) ||
    !Buffer.isBuffer(value.buffer) ||
    !("engine" in value) ||
    typeof value.engine !== "object" ||
    value.engine === null ||
    !("bytesWritten" in value.engine) ||
    typeof value.engine.bytesWritten !== "number"
  )
    throw new Error(
      "Built-in decoder omitted its buffer or consumed-input accounting",
    );
  return { buffer: value.buffer, consumedBytes: value.engine.bytesWritten };
};
