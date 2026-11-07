import type { Client } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";

import { verifyGhidraAddressBoundaries } from "../../../../scripts/lib/real-ghidra-address-boundaries.mjs";

const entry = "0x10000";
const originalName = "fixture::entry";

const fixture = (
  options: {
    failAfterWrite?: Error;
    restoration?: "reject" | "wrong-readback";
    initialName?: null;
  } = {},
) => {
  let name: string | null = options.initialName === null ? null : originalName;
  const writes: Record<string, unknown>[] = [];
  const success = (value: unknown) => ({
    content: [],
    structuredContent: { normalized_result: value },
  });
  const error = (operation: string, address: unknown) => ({
    code: "invalid_request",
    category: "invalid_input",
    message: "Address cannot be represented without truncation",
    retryable: false,
    remediation: { action: "Select a representable address" },
    details: {
      operation,
      issues: [
        { address, message: "cannot be represented without truncation" },
      ],
    },
  });
  const client: Pick<Client, "callTool"> = {
    callTool: async ({ name: operation, arguments: args = {} }) => {
      const address = args.address ?? args.procedure;
      if (typeof address === "string" && address.includes("100010000"))
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: error(operation, address) }),
            },
          ],
        };
      switch (operation) {
        case "analyze_function":
          return success({ procedure: { name } });
        case "read_bytes":
          return success({ bytes_hex: "90" });
        case "address_name":
          return success(name);
        case "set_addresses_names": {
          const names = args.names as Record<string, string>;
          writes.push(names);
          const requested = Object.values(names);
          const accepted = new Set(requested).size === 1;
          if (accepted) {
            name = requested[0]!;
            if (options.failAfterWrite !== undefined)
              throw options.failAfterWrite;
          }
          return success(
            Object.fromEntries(
              Object.keys(names).map((key) => [key, accepted]),
            ),
          );
        }
        case "set_address_name":
          writes.push(args);
          if (options.restoration === "reject") return success(false);
          name =
            options.restoration === "wrong-readback"
              ? "unexpected_name"
              : String(args.name);
          return success(true);
        default:
          throw new Error(`Unmodeled operation: ${operation}`);
      }
    },
  };
  const cli = async (command: string, address: string) => {
    const operation =
      command === "read-bytes" ? "read_bytes" : "annotate_native_function";
    throw Object.assign(new Error("Rejected oversized address"), {
      code: 1,
      stdout: JSON.stringify(error(operation, address)),
    });
  };
  return {
    run: () => verifyGhidraAddressBoundaries(client, entry, cli),
    observedName: () => name,
    writes,
  };
};

it("restores the exact observed name before the next verifier consumer", async () => {
  const test = fixture();
  await test.run();
  expect(test.observedName()).toBe(originalName);
});

it("restores an uncertain write and preserves its original failure", async () => {
  const failure = new Error("Reply lost after applying the alias");
  const test = fixture({ failAfterWrite: failure });
  await expect(test.run()).rejects.toBe(failure);
  expect(test.observedName()).toBe(originalName);
});

it.each([
  ["reject", /temporary alias edit must be restored/u],
  ["wrong-readback", /original function-entry name must survive restoration/u],
] as const)(
  "fails closed when restoration has %s",
  async (restoration, diagnostic) => {
    await expect(fixture({ restoration }).run()).rejects.toThrow(diagnostic);
  },
);

it("retains both verification and restoration failures", async () => {
  const failure = new Error("Reply lost after applying the alias");
  await expect(
    fixture({ failAfterWrite: failure, restoration: "reject" }).run(),
  ).rejects.toMatchObject({
    name: "AggregateError",
    errors: [failure, expect.any(Error)],
  });
});

it("does not mutate an entry without a restorable public name", async () => {
  const test = fixture({ initialName: null });
  await expect(test.run()).rejects.toThrow(
    /observed name that can be restored/u,
  );
  expect(test.writes).toEqual([]);
});
