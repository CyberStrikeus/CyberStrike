import { expect, it } from "vitest";

import { createCli } from "./cli.js";

const help = async (command: string): Promise<string> => {
  const cli = createCli({ REA_LOG_LEVEL: "silent" });
  let text = "";
  await cli.serve([command, "--help"], {
    env: {},
    exit: () => undefined,
    stdout: (chunk: string) => {
      text += chunk;
    },
  });
  return text;
};

it("advertises the native deadline flags separately from objdump and rizin", async () => {
  expect(await help("inspect-macho")).toContain("--native-command-timeout-ms");
  expect(await help("observe-native-ui")).toContain("--native-ui-deadline-ms");
  expect(await help("inspect-binary-layout")).toContain(
    "--pwntools-timeout-ms",
  );
  expect(await help("inspect-recorded-crash")).toContain(
    "--pwntools-timeout-ms",
  );
});
