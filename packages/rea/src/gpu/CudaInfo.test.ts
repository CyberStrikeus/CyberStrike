import { expect, it } from "vitest";
import { readCudaInfo, readCudaParameters } from "./CudaInfo.js";
it("retains conflicting parameter-area declarations as an unknown aggregate", () => {
  const read = readCudaParameters(Buffer.from("03190c0003191000", "hex"), true);
  expect(read.parameter_bytes).toBeNull();
  expect(read.parameter_count).toBeNull();
  expect(read.limitations.join(" ")).toContain("12, 16");
});
it("retains observed argument ranges while reporting inconsistent area declarations", () => {
  const read = readCudaParameters(
    Buffer.from("0319040004170c00000000000000000000f02100", "hex"),
    true,
  );
  expect(read).toMatchObject({
    parameter_count: 1,
    parameter_bytes: 4,
    parameters: [{ offset: 0, size: 8 }],
  });
  expect(read.limitations.join(" ")).toContain("disagree");
});
it("decodes V2 kernel parameter sizes without the legacy packed-size shift", () => {
  const read = readCudaParameters(
    Buffer.from("0319204e04450c000000000000000000204e0000", "hex"),
    true,
  );
  expect(read).toMatchObject({
    parameter_count: 1,
    parameter_bytes: 20000,
    parameters: [{ ordinal: 0, offset: 0, size: 20000 }],
    limitations: [],
  });
});
it("marks malformed V2 parameter payloads incomplete", () => {
  const read = readCudaParameters(
    Buffer.from("0319204e044508000000000000000000", "hex"),
    true,
  );
  expect(read.parameter_count).toBeNull();
  expect(read.parameter_bytes).toBe(20000);
  expect(read.limitations.join(" ")).toContain("unsupported indices/sizes");
});
it("bounds dense numeric record streams without retaining a record array", () => {
  const bytes = Buffer.alloc(4 * 262145);
  for (let offset = 0; offset < bytes.length; offset += 4) bytes[offset] = 1;
  expect(() => {
    for (const record of readCudaInfo(bytes, true)) {
      if (record.format !== 1) throw new Error("unexpected source format");
    }
  }).toThrow(/aggregate record\/symbol visits/u);
});
