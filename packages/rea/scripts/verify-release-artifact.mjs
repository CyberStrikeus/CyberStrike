import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { valid } from "semver";
import {
  installCanaryPackage,
  verifyInstalledCanaryPackage,
} from "./lib/release-package-canary.mjs";
import { completeVerifierRun, createVerifierRun } from "./lib/verifier-run.mjs";

const [tarball, version, ...extra] = process.argv.slice(2);
if (
  tarball === undefined ||
  typeof version !== "string" ||
  valid(version) !== version ||
  extra.length
)
  throw new Error(
    "Usage: node scripts/verify-release-artifact.mjs <qualified-tarball> <version>",
  );
const source = resolve(tarball);
const verifierRun = createVerifierRun();
const workspace = await mkdtemp(join(tmpdir(), "rea-release-rehearsal-"));
const environment = {
  ...process.env,
  npm_config_cache: join(workspace, "npm-cache"),
};
delete environment.HOPPER_TARGET_PATH;
let result;
try {
  const packageRoot = await installCanaryPackage(
    source,
    workspace,
    environment,
  );
  result = await verifyInstalledCanaryPackage(
    packageRoot,
    version,
    workspace,
    environment,
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
}
process.stdout.write(
  `${JSON.stringify({ verifier_run: await completeVerifierRun(verifierRun), package: "rea-agents", version, source, ...result })}\n`,
);
