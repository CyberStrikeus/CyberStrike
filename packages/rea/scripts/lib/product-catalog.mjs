import { formatGeneratedFile } from "./format-generated-file.mjs";

import { assertSameNames, digest, loadSources } from "./catalog-core.mjs";
import { createCliInventory } from "./catalog-cli.mjs";
import { providerCatalog, toolFamilyCatalog } from "./catalog-builders.mjs";

/** Project current runtime contracts into deterministic, machine-readable facts. */
export const createProductCatalog = async (root) => {
  const sources = await loadSources(root);
  const cli = createCliInventory(sources.cli.createCli());
  assertSameNames(
    "Primary CLI inventory",
    cli.primary,
    sources.cliCommandNames.CLI_COMMAND_NAMES,
  );
  const tools = toolFamilyCatalog(sources);
  const providers = providerCatalog(sources);
  const metadata = sources.packageMetadata.PACKAGE_METADATA;
  return {
    package: {
      name: metadata.name,
      version: metadata.version,
      sdk: {
        server: metadata.serverSdkVersion,
        client: metadata.clientSdkVersion,
        core: metadata.coreSdkVersion,
      },
      skill_version: metadata.skillVersion,
    },
    tools,
    providers,
    setup_clients: sources.supportedClients.SUPPORTED_CLIENT_DEFINITIONS.map(
      ({ name, displayName, format }) => ({
        id: name,
        display_name: displayName,
        format,
        configuration: format === "unsupported" ? "detect-only" : "managed",
      }),
    ),
    cli: {
      primary_count: cli.primary.length,
      commands: cli.primary,
      aliases: cli.aliases,
    },
    runtime_catalog: {
      counts: sources.catalogIdentity.FULL_CATALOG_IDENTITY.counts,
      digests: {
        // Full runtime schema digests belong to server identity, not this facts projection.
        providers_sha256: digest(providers),
      },
    },
  };
};

/** Stable build-generated representation of the product catalog. */
export const serializeProductCatalog = (catalog) =>
  formatGeneratedFile(
    "docs/public/product-catalog.json",
    JSON.stringify(catalog, null, 2),
  );
