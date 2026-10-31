let implementation;

/** Load the development owner as one source graph, only when commands are needed. */
export async function createPackageVerifierCommands(options) {
  implementation ??= importVerifierSource(
    new URL("./package-command-owner.mts", import.meta.url).href,
    import.meta.url,
  );
  const module = await implementation;
  return module.createPackageVerifierCommands(options);
}
import { importVerifierSource } from "./verifier-source-loader.mjs";
