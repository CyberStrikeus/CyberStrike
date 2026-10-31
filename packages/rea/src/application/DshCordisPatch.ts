import { isMap, isSeq, type Node, type YAMLMap } from "yaml";
import {
  parseEnvironment,
  parseEnvironmentValues,
  type Environment,
} from "../config/environment.js";
import { ConfigurationError } from "../domain/configurationErrors.js";
import { err, ok, type Result } from "../domain/result.js";
import type { ClientConfigurationDocument } from "./ClientConfigurationDocument.js";
import { CordisExpression, DshCordisYaml } from "./DshCordisYaml.js";
import {
  mergeEnvironmentOverrides,
  snapshotEnvironment,
} from "../process/snapshotEnvironment.js";

export const DSH_ENTRY_ID = "rea-mcp";
export const DSH_CLIENT_PACKAGE = "@deepseek-ai/dsh-mcp-client";
const LAUNCHER_KEYS = new Set(["serverName", "transport", "command", "args"]);
const SELECTOR_KEYS = new Set(["id", "name"]);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof CordisExpression);

interface PatchOperation {
  readonly source: unknown;
  readonly map: YAMLMap<unknown, unknown>;
  readonly ownedRows: readonly number[];
  readonly direct: boolean;
  readonly unknownApplicability: boolean;
}

/** One interpretation of identity, ordered patch applicability and source nodes. */
export class DshCordisDocument {
  readonly #yaml: DshCordisYaml;
  readonly #operations: readonly PatchOperation[];
  readonly #fields = new Map<string, unknown>();
  #entryNode: YAMLMap<unknown, unknown> | undefined;
  readonly #insertions: number;
  #unknownSelector = false;
  #unknownStructure = false;
  readonly #editabilityError: ConfigurationError | undefined;
  readonly config: Record<string, unknown> | undefined;

  constructor(text: string) {
    this.#yaml = new DshCordisYaml(text);
    const root = this.#yaml.document.contents;
    if (!isSeq(root))
      throw new ConfigurationError("Cordis patches must be a list");
    const operations: PatchOperation[] = [];
    let insertions = 0;
    let malformedStructure = false;
    for (const source of root.items) {
      const map = this.#map(source);
      if (map === undefined) {
        if (this.#yaml.value(source) instanceof CordisExpression)
          this.#unknownStructure = true;
        else malformedStructure = true;
        continue;
      }
      const inserted = this.#yaml.resolve(this.#yaml.field(map, "insert"));
      const targetId = this.#id(map);
      const unknownApplicability = targetId !== undefined;
      const insertedValue = this.#yaml.value(inserted);
      const invalidEntries = isSeq(inserted)
        ? inserted.items.filter((entry) => this.#map(entry) === undefined)
        : [];
      if (
        insertedValue instanceof CordisExpression ||
        invalidEntries.some(
          (entry) => this.#yaml.value(entry) instanceof CordisExpression,
        )
      )
        this.#unknownStructure = true;
      else if (insertedValue != null && !isSeq(inserted))
        malformedStructure = true;
      else if (invalidEntries.length > 0) malformedStructure = true;
      const ownedRows = isSeq(inserted)
        ? inserted.items.flatMap((entry, index) =>
            this.#id(entry) === DSH_ENTRY_ID ? [index] : [],
          )
        : [];
      const direct = !isSeq(inserted) && targetId === DSH_ENTRY_ID;
      operations.push({ source, map, ownedRows, direct, unknownApplicability });
      if (isSeq(inserted)) {
        for (const index of ownedRows) {
          const entry = this.#map(inserted.items[index]);
          if (entry === undefined) continue;
          insertions += 1;
          this.#entryNode = entry;
          this.#fields.clear();
          this.#unknownSelector = false;
          this.#readFields(entry);
        }
      } else if (direct) {
        if (insertions === 0) continue;
        // Cordis uses name as a selector, not a rename operation.
        const selector = this.#yaml.value(this.#yaml.field(map, "name"));
        if (
          selector instanceof CordisExpression ||
          (selector && this.#field("name") instanceof CordisExpression)
        ) {
          this.#unknownSelector = true;
          continue;
        }
        if (selector && selector !== this.#field("name")) continue;
        this.#readFields(map, new Set(["id", "name"]));
      }
    }
    this.#operations = operations;
    this.#insertions = insertions;
    this.#editabilityError = this.#unknownStructure
      ? new ConfigurationError(
          "Expression-backed Cordis patches have unknown structure; use literal patches before setup",
        )
      : malformedStructure
        ? new ConfigurationError(
            "Malformed Cordis patches cannot be edited safely; use mapping entries and insert lists before setup",
          )
        : operations.some(
              (op) => op.unknownApplicability && op.ownedRows.length > 0,
            )
          ? new ConfigurationError(
              "Cordis REA insertion targets a group with unknown activity; use a direct insertion before setup",
            )
          : this.#unknownSelector
            ? new ConfigurationError(
                "Expression-backed Cordis name selectors have unknown applicability; use literal selectors before setup",
                {
                  settings: [
                    {
                      setting: "name",
                      constraint: "Use literal selectors before setup",
                    },
                  ],
                },
              )
            : undefined;
    const config = this.#field("config");
    // Ownership survives malformed config so uninstall can remove the source row.
    this.config = insertions === 0 ? undefined : isRecord(config) ? config : {};
  }

  #map(node: unknown): YAMLMap<unknown, unknown> | undefined {
    const map = this.#yaml.resolve(node);
    return isMap(map) ? map : undefined;
  }
  #id(node: unknown): unknown {
    const id = this.#yaml.value(this.#yaml.field(this.#map(node), "id"));
    if (id instanceof CordisExpression)
      throw new ConfigurationError(
        "Expression-backed Cordis IDs have unknown ownership; use literal IDs before changing registrations",
      );
    return id;
  }
  #field(key: string): unknown {
    return this.#yaml.value(this.#fields.get(key));
  }
  #readFields(
    map: YAMLMap<unknown, unknown>,
    omitted: ReadonlySet<string> = new Set(),
  ): void {
    for (const pair of map.items) {
      const key = this.#yaml.value(pair.key);
      if (typeof key === "string" && !omitted.has(key))
        this.#fields.set(key, pair.value);
    }
  }
  get carriesEntry(): boolean {
    return this.#operations.some((op) => op.direct || op.ownedRows.length > 0);
  }
  get hasUnknownStructure(): boolean {
    return this.#unknownStructure;
  }
  get editabilityError(): ConfigurationError | undefined {
    return this.#editabilityError;
  }
  get ready(): boolean {
    const disabled = this.#field("disabled");
    return (
      this.#insertions === 1 &&
      this.#editabilityError === undefined &&
      this.#field("name") === DSH_CLIENT_PACKAGE &&
      (disabled === undefined || disabled === false)
    );
  }

  /** Validate literals without treating expression source as an environment value. */
  environment(
    overrides: Readonly<Record<string, string>> = {},
    validation: "fragment" | "effective" = "effective",
    platform: NodeJS.Platform = process.platform,
  ): Result<
    {
      readonly values: Readonly<Record<string, string>>;
      readonly configuration: Environment;
      readonly unresolvedSettings: ReadonlySet<string>;
    },
    ConfigurationError
  > {
    const config = this.#field("config");
    if (config instanceof CordisExpression)
      return err(
        new ConfigurationError(
          "Expression-backed Cordis config cannot be safely edited",
          {
            settings: [
              {
                setting: "config",
                constraint:
                  "Use a literal mapping to preserve caller fields during setup",
              },
            ],
          },
        ),
      );
    if (config !== undefined && !isRecord(config))
      return err(
        new ConfigurationError("Cordis REA config must be a mapping", {
          settings: [
            {
              setting: "config",
              constraint: "Use a literal mapping before setup",
            },
          ],
        }),
      );
    const raw = this.config?.env;
    if (raw !== undefined && !isRecord(raw))
      return err(
        new ConfigurationError("Cordis server environment must be a mapping"),
      );
    const literals: Record<string, string> = Object.create(null);
    const unresolvedSettings = new Set<string>();
    for (const [key, value] of Object.entries(
      mergeEnvironmentOverrides<unknown>(raw ?? {}, overrides, platform),
    )) {
      if (value instanceof CordisExpression) {
        unresolvedSettings.add(key);
        continue;
      }
      if (typeof value !== "string")
        return err(
          new ConfigurationError("Invalid Cordis server environment", {
            settings: [
              {
                setting: `env.${key}`,
                constraint:
                  "Environment values must be strings or Cordis expressions",
              },
            ],
          }),
        );
      literals[key] = value;
    }
    const runtimeEnvironment = snapshotEnvironment(literals, platform);
    const unresolved = new Set(
      Object.keys(
        snapshotEnvironment(
          Object.fromEntries([...unresolvedSettings].map((key) => [key, ""])),
          platform,
        ),
      ),
    );
    const validated =
      validation === "fragment"
        ? parseEnvironmentValues(runtimeEnvironment, unresolved)
        : parseEnvironment(runtimeEnvironment, unresolved);
    return validated.ok
      ? ok({
          values: literals,
          configuration: validated.value,
          unresolvedSettings: unresolved,
        })
      : validated;
  }

  desired(
    command: readonly string[],
    overrides: Readonly<Record<string, string>>,
  ): Result<Record<string, unknown>, ConfigurationError> {
    if (this.#editabilityError !== undefined)
      return err(this.#editabilityError);
    const environment = this.environment(overrides);
    if (!environment.ok) return environment;
    const env = mergeEnvironmentOverrides<unknown>(
      isRecord(this.config?.env) ? this.config.env : {},
      overrides,
    );
    const desired = { ...this.config, ...dshClientRegistrationEntry(command) };
    delete desired.env;
    if (Object.keys(env).length > 0) desired.env = env;
    return ok(desired);
  }

  /** Plan every replacement from source snapshots before changing an output tree. */
  serialize(desired?: Record<string, unknown>): string {
    if (
      this.#editabilityError !== undefined &&
      (this.#unknownStructure || desired !== undefined)
    )
      throw this.#editabilityError;
    const root = this.#yaml.document.contents;
    if (!isSeq(root))
      throw new ConfigurationError("Cordis patches must be a list");
    const replacements = new Map<unknown, unknown>();
    const invalidated = new Set(
      this.#operations.flatMap((op) =>
        op.direct || op.ownedRows.length > 0
          ? this.#yaml.anchors(op.source)
          : [],
      ),
    );
    let carried = false;
    for (const op of this.#operations) {
      if (op.direct) {
        replacements.set(op.source, undefined);
        continue;
      }
      if (op.ownedRows.length === 0) continue;
      const copy = this.#yaml.detach(op.map, invalidated);
      if (!isMap(copy))
        throw new ConfigurationError("Cordis operation is not a mapping");
      const inserted = this.#yaml.detach(
        this.#yaml.resolve(this.#yaml.field(op.map, "insert")),
        invalidated,
      );
      if (!isSeq(inserted))
        throw new ConfigurationError("Cordis insertion is not a list");
      copy.set("insert", inserted);
      const owned = new Set(op.ownedRows);
      inserted.items = inserted.items.flatMap((entry, index) => {
        if (!owned.has(index)) return [entry];
        if (carried || desired === undefined) return [];
        carried = true;
        return [this.#entry(desired, invalidated)] as typeof inserted.items;
      });
      if (inserted.items.length === 0) copy.delete("insert");
      // An emptied operation keeps caller fields unless it would patch REA's row.
      const kept =
        inserted.items.length > 0 ||
        (this.#id(op.map) !== DSH_ENTRY_ID &&
          copy.items.some(
            (pair) => !SELECTOR_KEYS.has(this.#yaml.value(pair.key) as string),
          ));
      replacements.set(op.source, kept ? copy : undefined);
    }
    const output = this.#yaml.document.clone();
    const outputRoot = output.contents;
    if (!isSeq(outputRoot))
      throw new ConfigurationError("Cordis patches must be a list");
    outputRoot.items = root.items.flatMap((source) => {
      const copy = replacements.has(source)
        ? replacements.get(source)
        : this.#yaml.copy(source, invalidated);
      return copy === undefined ? [] : [copy];
    }) as typeof outputRoot.items;
    if (!carried && desired !== undefined)
      outputRoot.items.push(
        output.createNode({
          insert: [
            { id: DSH_ENTRY_ID, name: DSH_CLIENT_PACKAGE, config: desired },
          ],
        }) as never,
      );
    return output.toString({ lineWidth: 0 });
  }

  #entry(
    desired: Record<string, unknown>,
    invalidated: ReadonlySet<Node>,
  ): YAMLMap<unknown, unknown> {
    const entry = this.#yaml.detach(this.#entryNode, invalidated);
    if (!isMap(entry))
      throw new ConfigurationError("Cordis entry is not a mapping");
    this.#yaml.setValue(entry, "id", DSH_ENTRY_ID);
    this.#yaml.setValue(entry, "name", DSH_CLIENT_PACKAGE);
    entry.delete("disabled");
    for (const [key, value] of this.#fields) {
      if (["id", "name", "config", "disabled"].includes(key)) continue;
      entry.set(key, this.#yaml.detach(value, invalidated));
    }
    const sourceConfig = this.#map(this.#fields.get("config"));
    const config =
      sourceConfig === undefined
        ? this.#yaml.document.createNode({})
        : this.#yaml.detach(sourceConfig, invalidated);
    if (!isMap(config))
      throw new ConfigurationError(
        "Cordis registration config is not a mapping",
      );
    // Caller nodes keep their tags and spelling; only literal launcher values change.
    for (const key of LAUNCHER_KEYS)
      this.#yaml.setValue(config, key, desired[key]);
    const env = this.#map(this.#yaml.field(sourceConfig, "env"));
    const desiredEnv = desired.env;
    if (isRecord(desiredEnv)) {
      const nextEnv =
        env === undefined
          ? this.#yaml.document.createNode({})
          : this.#yaml.detach(env, invalidated);
      if (!isMap(nextEnv))
        throw new ConfigurationError("Cordis environment is not a mapping");
      for (const pair of [...nextEnv.items]) {
        const key = this.#yaml.key(pair.key);
        if (Object.hasOwn(desiredEnv, key)) {
          this.#yaml.renameKey(nextEnv, pair, key);
          continue;
        }
        const alias =
          process.platform === "win32"
            ? Object.keys(desiredEnv).find(
                (name) => name.toUpperCase() === key.toUpperCase(),
              )
            : undefined;
        if (alias === undefined) nextEnv.delete(pair.key);
        else this.#yaml.renameKey(nextEnv, pair, alias);
      }
      for (const [key, value] of Object.entries(desiredEnv)) {
        this.#yaml.setValue(nextEnv, key, value);
      }
      config.set("env", nextEnv);
    } else config.delete("env");
    entry.set("config", config);
    return entry;
  }
}

class DshCordisEdit {
  constructor(
    readonly source: DshCordisDocument,
    readonly desired?: Record<string, unknown>,
  ) {}
}
export const dshDocument = (
  document: Record<string, unknown>,
): DshCordisDocument => {
  if (!(document.cordis instanceof DshCordisDocument))
    throw new ConfigurationError("Missing Cordis document owner");
  return document.cordis;
};
export const parseDshCordisDocument = (
  text: string,
): ClientConfigurationDocument => {
  const source = new DshCordisDocument(text);
  return {
    document: { cordis: source },
    servers: source.config === undefined ? {} : { rea: source.config },
    serversPath: [],
    dialect: "dsh",
    environmentKey: "env",
    legacyServers: {},
  };
};
export const editDshDocument = (
  parsed: ClientConfigurationDocument,
  desired?: Record<string, unknown>,
): Record<string, unknown> => ({
  cordis: new DshCordisEdit(dshDocument(parsed.document), desired),
});
export const serializeDshDocument = (
  document: Record<string, unknown>,
): string => {
  if (!(document.cordis instanceof DshCordisEdit))
    throw new ConfigurationError("Missing Cordis edit plan");
  return document.cordis.source.serialize(document.cordis.desired);
};
export const dshClientRegistrationEntry = (
  command: readonly string[],
  environment: Readonly<Record<string, string>> = {},
): Record<string, unknown> => {
  const [executable = "rea", ...args] = command;
  return {
    serverName: "rea",
    transport: "stdio",
    command: executable,
    args,
    ...(Object.keys(environment).length === 0
      ? {}
      : { env: { ...environment } }),
  };
};
