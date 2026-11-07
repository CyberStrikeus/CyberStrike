import type { ServerResponse } from "node:http";

import { createDeferred } from "./binarySession.js";
import { startFakeCdpBrowser } from "./fakeCdpBrowser.js";

/** Two allowed maps and one excluded map, with the second HTTP response held open. */
export const startSourceMapCancellationBrowser = async () => {
  const mapText = JSON.stringify({
    version: 3,
    names: [],
    sources: ["src/original.js"],
    sourcesContent: ["export const value = 1;"],
    mappings: "AAAA",
  });
  const scriptText = "export const observed = true;";
  const completedMapPath = createDeferred<string>();
  const secondRequest = createDeferred<string>();
  let firstPath: string | undefined;
  let heldResponse: ServerResponse | undefined;
  const browser = await startFakeCdpBrowser({
    sourceMapReply(url, response) {
      if (url !== "/first.js.map" && url !== "/second.js.map") return false;
      if (firstPath === undefined) {
        firstPath = url;
        response.end(mapText);
        completedMapPath.resolve(url);
        return true;
      }
      heldResponse = response;
      secondRequest.resolve(url);
      return true;
    },
    commandResult: ({ method }) =>
      method === "Debugger.getScriptSource"
        ? { scriptSource: scriptText }
        : undefined,
    commandEvents(command, origin) {
      if (command.method !== "Debugger.enable") return undefined;
      const script = (id: string, sourceMapURL: string) => ({
        method: "Debugger.scriptParsed",
        ...(command.sessionId === undefined
          ? {}
          : { sessionId: command.sessionId }),
        params: {
          scriptId: id,
          url: `${origin}/${id}.js`,
          hash: id,
          length: Buffer.byteLength(scriptText),
          isModule: true,
          executionContextId: 1,
          scriptLanguage: "JavaScript",
          sourceMapURL,
        },
      });
      return [
        script("first", "/first.js.map"),
        script("second", "/second.js.map"),
        script("excluded", "https://outside.example.test/other.js.map"),
      ];
    },
  });
  const releasePendingResponse = (): void => {
    heldResponse?.destroy();
  };
  return {
    browser,
    mapText,
    completedMapPath: completedMapPath.promise,
    secondRequest: secondRequest.promise,
    releasePendingResponse,
    async close() {
      releasePendingResponse();
      await browser.close();
    },
  };
};
