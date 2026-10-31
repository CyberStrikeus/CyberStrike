import { expect, it } from "vitest";
import { registryPublicationState } from "../../../.github/actions/publish-mcp/registry-state.mjs";

const server = {
  name: "io.github.fixture/rea",
  version: "6.5.0",
  description: "Released metadata",
};
const record = {
  server,
  _meta: { "io.modelcontextprotocol.registry/official": { status: "active" } },
};
const page = (servers: unknown[], metadata = {}) =>
  Response.json({ servers, metadata });

it("finds an identical existing version after paging past substring matches", async () => {
  const urls: URL[] = [];
  const result = await registryPublicationState(server, async (url: URL) => {
    urls.push(url);
    return urls.length === 1
      ? page([{ server: { ...server, name: `${server.name}-other` } }], {
          nextCursor: "next",
        })
      : page([record]);
  });
  expect(result).toBe("present");
  expect(urls[0]?.searchParams.get("search")).toBe(server.name);
  expect(urls[0]?.searchParams.get("version")).toBe(server.version);
  expect(urls[0]?.searchParams.get("include_deleted")).toBe("true");
  expect(urls[1]?.searchParams.get("cursor")).toBe("next");
});

it("permits publication only after a complete successful lookup finds no exact match", async () => {
  await expect(
    registryPublicationState(server, async () => page([])),
  ).resolves.toBe("absent");
  await expect(
    registryPublicationState(
      server,
      async () => new Response("unavailable", { status: 503 }),
    ),
  ).rejects.toThrow("HTTP 503");
  await expect(
    registryPublicationState(server, async () =>
      Response.json({ metadata: {} }),
    ),
  ).rejects.toThrow("omitted servers");
  await expect(
    registryPublicationState(server, async () =>
      page([], { nextCursor: "same" }),
    ),
  ).rejects.toThrow("non-advancing cursor");
});

it("refuses changed, inactive or ambiguous published metadata", async () => {
  await expect(
    registryPublicationState(server, async () =>
      page([{ ...record, server: { ...server, description: "Different" } }]),
    ),
  ).rejects.toThrow("differs from released metadata");
  await expect(
    registryPublicationState(server, async () =>
      page([
        {
          ...record,
          _meta: {
            "io.modelcontextprotocol.registry/official": { status: "deleted" },
          },
        },
      ]),
    ),
  ).rejects.toThrow("not active");
  await expect(
    registryPublicationState(server, async () => page([record, record])),
  ).rejects.toThrow("ambiguous");
});
