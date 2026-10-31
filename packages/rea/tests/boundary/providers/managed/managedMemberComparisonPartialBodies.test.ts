import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { compareManagedMembers } from "../../../../src/domain/managed/managedMemberComparison.js";
import { inspectManagedMembersBytes } from "../../../../src/dotnet/ManagedMemberInspector.js";
import {
  buildManagedPeFixture,
  managedPeFixtureTarget,
} from "../../../../src/dotnet/ManagedPe.fixture.js";

const inspect = (bytes: Buffer, path: string) => {
  const target = managedPeFixtureTarget(bytes, path);
  const result = inspectManagedMembersBytes(bytes, target);
  return { result, evidenceId: `ev_${hash(Buffer.from(path))}` };
};

const hash = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

describe("managed member partial body comparison", () => {
  it.each(["max_stack", "init_locals"] as const)(
    "keeps an unavailable %s header fact unknown",
    (field) => {
      const left = inspect(buildManagedPeFixture(), "/tmp/header-known.dll");
      const right = {
        ...left,
        result: {
          ...left.result,
          methods: left.result.methods.map((method) => ({
            ...method,
            body: { ...method.body, [field]: null },
          })),
        },
      };
      expect(compareManagedMembers(left, right).methods[0]).toMatchObject({
        status: "unknown",
        dimensions: ["body-coverage"],
      });
    },
  );

  it("retains known header differences beside incomplete CIL", () => {
    const left = inspect(buildManagedPeFixture(), "/tmp/header-partial.dll");
    const right = {
      ...left,
      result: {
        ...left.result,
        methods: left.result.methods.map((method) => ({
          ...method,
          body: { ...method.body, status: "partial" as const, max_stack: 16 },
        })),
      },
    };
    expect(compareManagedMembers(left, right).methods[0]).toMatchObject({
      status: "changed",
      dimensions: ["metadata", "body-coverage"],
      limitations: expect.arrayContaining([expect.stringContaining("unknown")]),
    });
  });

  it("keeps unavailable body facets unknown and a raw-only signature difference unchanged", () => {
    const left = inspect(buildManagedPeFixture(), "/tmp/left-body-partial.dll");
    const right = inspect(
      buildManagedPeFixture(),
      "/tmp/right-body-partial.dll",
    );
    const leftMethod = left.result.methods[0];
    const rightMethod = right.result.methods[0];
    expect(leftMethod).toBeDefined();
    expect(rightMethod).toBeDefined();
    if (leftMethod === undefined || rightMethod === undefined) return;
    const leftResult = {
      ...left.result,
      methods: [
        {
          ...leftMethod,
          body: {
            ...leftMethod.body,
            status: "partial" as const,
            normalized_il_sha256: null,
          },
        },
      ],
    };
    const rightResult = {
      ...right.result,
      methods: [
        {
          ...rightMethod,
          body: {
            ...rightMethod.body,
            status: "partial" as const,
            normalized_il_sha256: null,
            opcode_counts: { nop: 1 },
          },
        },
      ],
    };
    const partial = compareManagedMembers(
      { evidenceId: left.evidenceId, result: leftResult },
      { evidenceId: right.evidenceId, result: rightResult },
    );
    expect(partial.methods[0]).toMatchObject({
      status: "unknown",
      dimensions: ["body-coverage"],
    });

    const rightSignatureChanged = {
      ...right.result,
      methods: [
        {
          ...rightMethod,
          signature: {
            ...rightMethod.signature,
            raw_sha256: "f".repeat(64),
          },
        },
      ],
    };
    const signatureChanged = compareManagedMembers(
      { evidenceId: left.evidenceId, result: left.result },
      {
        evidenceId: right.evidenceId,
        result: rightSignatureChanged,
      },
    );
    // Raw bytes that resolve to the same types, as when a rebuild moves a
    // referenced type to another metadata row, are not a signature change.
    expect(signatureChanged.methods[0]).toMatchObject({
      status: "unchanged",
      dimensions: [],
    });

    const bothAbsent = compareManagedMembers(
      {
        evidenceId: left.evidenceId,
        result: {
          ...left.result,
          methods: [
            {
              ...leftMethod,
              body: { ...leftMethod.body, status: "absent" as const },
            },
          ],
        },
      },
      {
        evidenceId: right.evidenceId,
        result: {
          ...right.result,
          methods: [
            {
              ...rightMethod,
              body: { ...rightMethod.body, status: "absent" as const },
            },
          ],
        },
      },
    );
    expect(bothAbsent.methods[0]).toMatchObject({
      status: "unchanged",
      dimensions: [],
    });
  });
});

describe("managed locals signature comparison", () => {
  it("compares observed presence but not build-local tokens", () => {
    const inspectWithLocals = (token: number, path: string) => {
      const body = Buffer.alloc(13);
      body.writeUInt16LE(0x3003, 0);
      body.writeUInt16LE(8, 2);
      body.writeUInt32LE(1, 4);
      body.writeUInt32LE(token, 8);
      body[12] = 0x2a;
      const standaloneSignatures = Array.from(
        { length: token & 0x00ff_ffff },
        () => Buffer.from([0x07, 0x01, 0x08]),
      );
      return inspect(
        buildManagedPeFixture({ ilBody: body, standaloneSignatures }),
        path,
      );
    };
    const absent = inspectWithLocals(0, "/tmp/locals-absent.dll");
    const presentOne = inspectWithLocals(0x11000001, "/tmp/locals-one.dll");
    const presentTwo = inspectWithLocals(0x11000002, "/tmp/locals-two.dll");
    expect(presentOne.result.methods[0]?.body.status).toBe("present");
    expect(presentTwo.result.methods[0]?.body.status).toBe("present");
    expect(compareManagedMembers(absent, presentOne).methods[0]).toMatchObject({
      status: "changed",
      dimensions: ["metadata"],
    });
    expect(
      compareManagedMembers(presentOne, presentTwo).methods[0],
    ).toMatchObject({
      status: "unchanged",
      dimensions: [],
    });
  });
});
