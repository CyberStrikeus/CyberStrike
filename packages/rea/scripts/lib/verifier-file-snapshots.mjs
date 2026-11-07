let implementation;

/** Load the source file owner only when a verifier needs snapshot facts. */
const loadImplementation = () => {
  implementation ??= importVerifierSource(
    new URL("./verifier-file-snapshot-owner.mts", import.meta.url).href,
    import.meta.url,
  );
  return implementation;
};

export async function captureVerifierFileSnapshot(commands, paths) {
  const module = await loadImplementation();
  return module.captureVerifierFileSnapshot(commands, paths);
}

export async function assertVerifierFilesUnchanged(commands, snapshot, label) {
  const module = await loadImplementation();
  return module.assertVerifierFilesUnchanged(commands, snapshot, label);
}
import { importVerifierSource } from "./verifier-source-loader.mjs";
