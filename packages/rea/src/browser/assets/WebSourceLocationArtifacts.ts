import type { WebSourceLocationArtifactPort } from "../../application/WebSourceLocationPorts.js";
import type { WebScriptArtifactPort } from "../../application/WebScriptArtifactPort.js";
import type { ExecutionOptions } from "../../application/AnalysisProvider.js";
import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import {
  WEB_SOURCE_MAP_LIMITS,
  type WebSourceLocationInput,
} from "../../domain/webSourceLocation.js";
import { err, ok } from "../../domain/result.js";
import { WebArtifactCleanup } from "../WebArtifactCleanup.js";
import { LocalWebScriptArtifacts } from "./LocalWebScriptArtifacts.js";
import {
  decodeWebArtifact,
  WebArtifactAcquisition,
  webArtifactReadError,
} from "./WebArtifactReads.js";

/** Read one verified capture source and the caller-selected map, without fetching. */
export class LocalWebSourceLocationArtifacts implements WebSourceLocationArtifactPort {
  readonly scripts: WebScriptArtifactPort;
  readonly #resources: ArtifactResourceScope;
  readonly #cleanup: WebArtifactCleanup;

  constructor(
    scripts?: WebScriptArtifactPort,
    resources = scripts instanceof LocalWebScriptArtifacts
      ? scripts.resources
      : new ArtifactResourceScope(),
  ) {
    this.#resources = resources;
    this.scripts =
      scripts ??
      new LocalWebScriptArtifacts("trace_web_source_location", resources);
    this.#cleanup = new WebArtifactCleanup(
      "web-source-location-artifacts",
      resources,
      this.scripts,
    );
  }

  async close(): Promise<void> {
    return this.#cleanup.close();
  }

  /** Preserve actual map identity separately from the selected deployment URL. */
  async load(input: WebSourceLocationInput, options?: ExecutionOptions) {
    const acquisition = new WebArtifactAcquisition();
    try {
      return await this.#resources.run(() =>
        this.#load(input, acquisition, options),
      );
    } catch (cause: unknown) {
      return err(
        acquisition.retain(
          webArtifactReadError(
            cause,
            {
              operation: "trace_web_source_location",
              field: ["source_map", "path"],
              targetPath: input.source_map.path,
              callerSelected: true,
            },
            options?.signal,
          ),
        ),
      );
    }
  }

  async #load(
    input: WebSourceLocationInput,
    acquisition: WebArtifactAcquisition,
    options?: ExecutionOptions,
  ) {
    const loaded = await this.scripts.load(input, options);
    if (!loaded.ok) return loaded;
    acquisition.record(
      "manifest",
      loaded.value.manifestFile,
      "manifest-validated",
    );
    acquisition.record("source", loaded.value.sourceFile, "source-verified");
    const data = await acquisition.read(
      "source-map",
      input.source_map.path,
      WEB_SOURCE_MAP_LIMITS.mapBytes,
      options?.signal,
      this.#resources,
    );
    return ok({
      ...loaded.value,
      sourceMap: {
        file: {
          path: input.source_map.path,
          sha256: data.sha256,
          bytes: data.bytes.length,
        },
        url: input.source_map.url,
        text: decodeWebArtifact(data.bytes),
      },
    });
  }
}
