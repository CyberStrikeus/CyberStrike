#!/usr/bin/env node

import { importVerifierSource } from "./lib/verifier-source-loader.mjs";
const { probeWindowsCapabilities } = await importVerifierSource(
  new URL("./lib/windows-capabilities.mts", import.meta.url).href,
  import.meta.url,
);

const report = await probeWindowsCapabilities();
await new Promise((resolveOutput) =>
  process.stdout.write(`${JSON.stringify(report)}\n`, resolveOutput),
);

// node-pty can retain a Windows helper handle after its probe exits. This
// standalone command has no remaining cleanup after its report is flushed.
process.exit(0);
