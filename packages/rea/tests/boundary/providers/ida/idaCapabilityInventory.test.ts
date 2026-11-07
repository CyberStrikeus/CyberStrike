import { IDA_COMPATIBILITY_PROFILES } from "../../../../src/ida/IdaConfiguration.js";
import { expect, it } from "vitest";
import { buildCapabilityInventory } from "../../../../src/application/CapabilityInventory.js";
import { providerCapabilitySets } from "../../../../src/application/binary/BinarySessionStatus.js";
import { idaCapabilities } from "../../../../src/ida/IdaProviderCapabilities.js";

const enabledPolicy: Parameters<typeof buildCapabilityInventory>[1] = {
  processCaptureEnabled: true,
  browserObservationEnabled: true,
  browserScenarioEnabled: true,
  electronObservationEnabled: true,
  v8InspectorObservationEnabled: true,
};

it.each([false, true])(
  "retains selected provider UI/process/network effects in direct and composed discovery (UI=%s)",
  (showUi) => {
    const input = {
      open: true,
      kind: "executable",
      capabilities: providerCapabilitySets(
        idaCapabilities(
          IDA_COMPATIBILITY_PROFILES[showUi ? "legacy" : "modern"],
          false,
        ),
      ),
    };
    const entries = buildCapabilityInventory(input, enabledPolicy);
    for (const name of [
      "procedure_pseudo_code",
      "analyze_function",
      "batch_decompile",
    ]) {
      expect(entries.find((entry) => entry.name === name)).toMatchObject({
        effects: {
          changesUiState: showUi,
          accessesNetwork: true,
          launchesProcess: !showUi,
        },
        annotations: { open_world: true },
      });
    }
  },
);
