const REQUIRED_HELP_COMMANDS = [
  "setup",
  "update",
  "inspect-artifact",
  "extract-artifact",
  "import-reference-source",
  "list-browser-targets",
  "inspect-web-page",
  "analyze-javascript-application",
  "compare",
];

const REQUIRED_LLM_TOPICS = [
  "decompile",
  "function",
  "search",
  "inspect",
  "xrefs",
  "trace",
  "capabilities",
  "providers",
  "inspect-artifact",
  "list-browser-targets",
  "inspect-web-page",
  "analyze-javascript-application",
];

/**
 * Derive agent setup support from the doctor node check and automated Hopper
 * installer applicability from the facts their owners parse.
 *
 * Host readiness and installer applicability are different facts: a
 * distribution REA supports can still be absent from the Hopper package's
 * tested list, or run on an architecture the package lacks, so the doctor host
 * check cannot answer the second question. On Linux, Hopper readiness is
 * required only where the automated installer applies; elsewhere setup never
 * provides Hopper. Applicability stays undefined when its owning fact is
 * unavailable, which is distinct from a host known to lack an automated
 * installer.
 */
export function packageSetupSupport(checks, host) {
  const supportedSetupHost =
    checks?.find(({ name }) => name === "node")?.ok === true;
  const hostCheckOk = checks?.find(({ name }) => name === "host")?.ok;
  const hopperSetupSupported = hopperInstallerSupported(host, hostCheckOk);
  const hopperReadinessRequired =
    host.platform !== "win32" &&
    hostCheckOk === true &&
    (host.platform !== "linux" || hopperSetupSupported === true);
  return { supportedSetupHost, hopperReadinessRequired, hopperSetupSupported };
}

/**
 * Whether `rea setup --install-hopper` can install Hopper automatically here.
 * On macOS the doctor host check already is the owner's installer predicate
 * (macOS 12 or later); on Linux it reports REA host support instead, so the
 * distribution's own parsed applicability governs.
 */
function hopperInstallerSupported(host, hostCheckOk) {
  if (host.platform === "win32") return false;
  if (host.platform === "linux")
    return host.linuxDistribution?.hopperSetupSupported;
  return hostCheckOk;
}

/**
 * The distribution facts the Hopper installer owner parses, taken from the
 * built application so the verifier follows the predicate the package ships.
 * Loaded only where a distribution can exist, which also keeps the derivation
 * above testable without a build.
 */
async function readHostLinuxDistribution() {
  if (process.platform !== "linux") return undefined;
  const { readLinuxDistribution } =
    await import("../dist/application/LinuxHopper.js");
  return readLinuxDistribution(process.arch);
}

/** Validate --help, --llms, and doctor output and determine host setup support. */
export async function verifyPackageDiscovery({ commands, cli, environment }) {
  const help = await commands.run(cli, ["--help"], environment);
  const llms = await commands.run(cli, ["--llms"], environment);
  const doctorExecution = await commands.runWithStatus(
    cli,
    ["doctor", "--json"],
    environment,
  );
  const doctor = JSON.parse(doctorExecution.stdout);
  const { supportedSetupHost, hopperReadinessRequired, hopperSetupSupported } =
    packageSetupSupport(doctor.checks, {
      platform: process.platform,
      linuxDistribution: await readHostLinuxDistribution(),
    });
  const hopperReady = doctor.checks?.find(({ name }) => name === "hopper")?.ok;
  const expectedDoctorHealth = doctor.checks?.every(({ ok }) => ok) === true;
  const missingHelp = REQUIRED_HELP_COMMANDS.filter(
    (command) => !help.includes(command),
  );
  const missingLlms = REQUIRED_LLM_TOPICS.filter(
    (topic) => !llms.includes(topic),
  );
  if (
    missingHelp.length !== 0 ||
    missingLlms.length !== 0 ||
    doctor.healthy !== expectedDoctorHealth ||
    doctorExecution.status !== (expectedDoctorHealth ? 0 : 1) ||
    (hopperReadinessRequired && hopperReady !== true)
  )
    throw new Error(
      `packaged CLI discovery or doctor failed: ${JSON.stringify({ helpSetup: help.includes("setup"), llmsDecompile: llms.includes("decompile"), doctor })}`,
    );
  return { supportedSetupHost, hopperSetupSupported };
}
