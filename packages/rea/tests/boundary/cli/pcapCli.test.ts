import { expect, it } from "vitest";

import { expectConfigurationRefusal, serveCli } from "./cliServeHarness.js";

it.each(["inspect-pcap-client", "inspect-pcap-capture"])(
  "%s advertises a schema through the public CLI",
  async (command) => {
    const result = await serveCli([command, "--schema", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toBeTruthy();
  },
);

it.each([
  ["inspect-pcap-client"],
  ["inspect-pcap-capture", "/nonexistent/capture.pcap"],
])("%s names the missing Wireshark tool to configure", async (...argv) => {
  const result = await serveCli([...argv, "--json"], {
    REA_TSHARK_COMMAND: "/nonexistent/tshark",
    REA_CAPINFOS_COMMAND: "/nonexistent/capinfos",
  });
  expectConfigurationRefusal(
    result,
    "The selected tshark executable /nonexistent/tshark could not be found",
  );
  expectConfigurationRefusal(result, "through absolute REA_TSHARK_COMMAND");
});

it("names a relative tool selection as configuration to fix", async () => {
  const result = await serveCli(["inspect-pcap-client", "--json"], {
    REA_TSHARK_COMMAND: "tshark",
  });
  expectConfigurationRefusal(
    result,
    "REA_TSHARK_COMMAND must be an absolute path to the tshark binary",
  );
});
