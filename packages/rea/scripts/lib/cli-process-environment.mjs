import { join } from "node:path";

/** Prepare the selected process environment before importing CLI or MCP dependencies. */
export const prepareCliProcessEnvironment = (
  environment,
  platform,
  packageVersion,
) => {
  environment.REA_PACKAGE_VERSION = packageVersion;
  // Windows home lookup throws for an empty USERPROFILE. Dependencies resolve
  // home during import, before REA's own resolver can apply its account fallback.
  if (platform === "win32" && environment.USERPROFILE === "") {
    delete environment.USERPROFILE;
  }

  // Playwright's registry assumes a desktop host while choosing its cache.
  // Termux needs an explicit path before the registry initializes.
  if (
    platform === "android" &&
    environment.PLAYWRIGHT_BROWSERS_PATH === undefined
  ) {
    const cacheRoot =
      environment.XDG_CACHE_HOME ?? join(environment.HOME ?? ".", ".cache");
    environment.PLAYWRIGHT_BROWSERS_PATH = join(cacheRoot, "ms-playwright");
  }
};
