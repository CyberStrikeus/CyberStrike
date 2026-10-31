import type {
  WebModuleArtifactPort,
  WebModuleArtifacts,
} from "../../application/WebModulePorts.js";
import type { WebScriptArtifactPort } from "../../application/WebScriptArtifactPort.js";
import type { ExecutionOptions } from "../../application/AnalysisProvider.js";
import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { jsonObjectSchema } from "../../domain/jsonValue.js";
import { err, ok } from "../../domain/result.js";
import { WebArtifactCleanup } from "../WebArtifactCleanup.js";
import type { WebModuleTraceInput } from "../../domain/webModuleTrace.js";
import { LocalWebScriptArtifacts } from "../assets/LocalWebScriptArtifacts.js";
import {
  WebArtifactAcquisition,
  webArtifactReadError,
} from "../assets/WebArtifactReads.js";

/** Add an explicitly selected import map to a verified captured-script source. */
export class LocalWebModuleArtifacts implements WebModuleArtifactPort {
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
      new LocalWebScriptArtifacts("trace_web_module_imports", resources);
    this.#cleanup = new WebArtifactCleanup(
      "web-module-artifacts",
      resources,
      this.scripts,
    );
  }

  async close(): Promise<void> {
    return this.#cleanup.close();
  }

  /** Read selected source and optional map without website requests. */
  async load(input: WebModuleTraceInput, options?: ExecutionOptions) {
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
              operation: "trace_web_module_imports",
              field:
                input.import_map === undefined
                  ? ["manifest_path"]
                  : ["import_map", "path"],
              targetPath: input.import_map?.path ?? input.manifest_path,
              callerSelected: input.import_map !== undefined,
            },
            options?.signal,
          ),
        ),
      );
    }
  }

  async #load(
    input: WebModuleTraceInput,
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
    if (input.import_map === undefined)
      return ok({ ...loaded.value, importMap: null });
    const selected = input.import_map;
    const data = await acquisition.readJson(
      "import-map",
      selected.path,
      4 * 1024 * 1024,
      options?.signal,
      this.#resources,
    );
    const importMap: WebModuleArtifacts["importMap"] = {
      file: {
        path: selected.path,
        sha256: data.sha256,
        bytes: data.bytes.length,
      },
      baseUrl: selected.base_url,
      value: jsonObjectSchema.parse(data.value),
    };
    return ok({ ...loaded.value, importMap });
  }
}
