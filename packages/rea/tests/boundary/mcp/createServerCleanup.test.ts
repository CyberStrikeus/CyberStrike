import { afterEach, expect, it, vi } from "vitest";
import { BinarySession } from "../../../src/application/binary/BinarySession.js";
import { AnalysisProviderRegistry } from "../../../src/application/binary/AnalysisProviderRegistry.js";
import { SessionProviderRouter } from "../../../src/application/binary/SessionProviderRouter.js";
import { InvestigationRecords } from "../../../src/application/investigation/InvestigationRecords.js";
import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { EvidenceMcpServer } from "../../../src/server/EvidenceMcpServer.js";
import { createServer } from "../../../src/server/createServer.js";

afterEach(() => vi.restoreAllMocks());

it("preserves both shutdown failures and retries provider cleanup after onclose", async () => {
  const transportFailure = new Error("transport cleanup failed");
  const providerFailure = new Error("browser cleanup failed");
  const transportClose = vi
    .spyOn(EvidenceMcpServer.prototype, "close")
    .mockImplementation(async function (this: EvidenceMcpServer) {
      this.server.onclose?.();
      throw transportFailure;
    });
  const browser = new CdpBrowserProvider();
  const providerClose = vi
    .spyOn(browser, "close")
    .mockRejectedValueOnce(providerFailure)
    .mockResolvedValue(undefined);
  const session = new BinarySession(
    SessionProviderRouter.selectable(new AnalysisProviderRegistry([]), []),
    new InvestigationRecords(),
  );
  const server = createServer(
    { kind: "session", session },
    {
      browserObservation: browser,
    },
  );
  const failure: unknown = await server
    .close()
    .catch((cause: unknown) => cause);
  expect(failure).toBeInstanceOf(AggregateError);
  const causes = (cause: unknown): unknown[] =>
    cause instanceof AggregateError ? cause.errors.flatMap(causes) : [cause];
  expect(causes(failure)).toEqual([transportFailure, providerFailure]);
  expect(providerClose).toHaveBeenCalledTimes(1);
  transportClose.mockResolvedValue(undefined);
  await expect(server.close()).resolves.toBeUndefined();
  expect(providerClose).toHaveBeenCalledTimes(2);
  transportClose.mockRestore();
  await session.close();
});
