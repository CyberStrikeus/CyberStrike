import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { launchAnalysisSetting } from "../config/analysisSettings.js";
import { AsyncLocalStorage } from "node:async_hooks";
import type { z } from "zod";
import type {
  AnalysisSettingId,
  AnalysisSettingsSnapshot,
  AnalysisSettingValues,
} from "../domain/analysisSettings.js";
import {
  analysisSettingDefinition,
  analysisSettingIds,
} from "../domain/analysisSettingDefinitions.js";
import {
  inspectAnalysisSettingsInputSchema,
  updateAnalysisSettingsInputSchema,
} from "../contracts/analysisSettingsContracts.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { err, ok } from "../domain/result.js";

/** One runtime's admitted overrides and operation snapshots; never writes configuration. */
export class AnalysisSettings {
  readonly #accepted = new AsyncLocalStorage<AnalysisSettingsSnapshot>();
  #current: AnalysisSettingsSnapshot = Object.freeze({
    revision: 0,
    overrides: Object.freeze({}),
  });
  readonly #launch: ReadonlyMap<
    AnalysisSettingId,
    ReturnType<typeof launchAnalysisSetting>
  >;
  constructor(environment: Readonly<Record<string, string | undefined>>) {
    this.#launch = new Map(
      analysisSettingIds.map((id) => [
        id,
        launchAnalysisSetting(id, environment),
      ]),
    );
  }
  /** Provider readers inherit exactly the snapshot accepted by their enclosing operation. */
  readonly read = (): AnalysisSettingsSnapshot =>
    this.#accepted.getStore() ?? this.#current;
  run<Value>(operation: () => Value): Value {
    return this.#accepted.run(this.#current, operation);
  }
  inspect(input: z.infer<typeof inspectAnalysisSettingsInputSchema> = {}) {
    return {
      revision: this.#current.revision,
      scope: "rea-runtime" as const,
      active_values: { status: "not_observed" as const },
      settings: analysisSettingIds
        .filter((id) => {
          const definition = analysisSettingDefinition(id);
          return (
            (input.settings === undefined || input.settings.includes(id)) &&
            (input.provider === undefined ||
              input.provider === definition.provider ||
              definition.relatedProviders?.includes(input.provider) === true) &&
            (input.operation === undefined ||
              definition.operations.includes(input.operation))
          );
        })
        .map((id) => this.#describe(id)),
    };
  }
  update(raw: unknown) {
    const input = updateAnalysisSettingsInputSchema.safeParse(raw);
    if (!input.success)
      return err(
        analysisInputErrorFromIssues(
          "update_analysis_settings",
          input.error.issues,
          raw,
        ),
      );
    if (
      input.data.expected_revision !== undefined &&
      input.data.expected_revision !== this.#current.revision
    )
      return err(
        new AnalysisInputError(
          "update_analysis_settings",
          {
            userMessage: `Settings revision conflict: expected ${input.data.expected_revision}, current ${this.#current.revision}. Inspect settings before retrying.`,
          },
          [
            {
              path: ["expected_revision"],
              reason: "invalid_value",
              expected: this.#current.revision,
            },
          ],
        ),
      );
    const ids = input.data.changes.map((change) => change.setting);
    if (new Set(ids).size !== ids.length)
      return err(
        new AnalysisInputError(
          "update_analysis_settings",
          {
            userMessage:
              "Each setting may occur only once in an atomic update.",
          },
          [{ path: ["changes"], reason: "invalid_value" }],
        ),
      );
    const next: Partial<Record<AnalysisSettingId, number | null>> = {
      ...this.#current.overrides,
    };
    const previous = new Map(ids.map((id) => [id, this.#describe(id).value]));
    for (const change of input.data.changes) {
      if (change.action === "reset") delete next[change.setting];
      else next[change.setting] = change.value;
    }
    const changed = ids.some((id) => next[id] !== this.#current.overrides[id]);
    if (changed)
      this.#current = Object.freeze({
        revision: this.#current.revision + 1,
        overrides: Object.freeze(next) as Readonly<
          Partial<AnalysisSettingValues>
        >,
      });
    return ok({
      ...this.inspect({ settings: ids }),
      changed,
      changes: ids.map((setting) => {
        const oldValue = previous.get(setting);
        const newValue = this.#describe(setting).value;
        return {
          setting,
          ...(oldValue === undefined ? {} : { old_value: oldValue }),
          ...(newValue === undefined ? {} : { new_value: newValue }),
        };
      }),
      active_work_changed: false as const,
      rea_restart_required: false as const,
    });
  }
  #describe(setting: AnalysisSettingId) {
    const definition = analysisSettingDefinition(setting);
    const launch = this.#launch.get(setting)!;
    const override = this.#current.overrides[setting];
    const launchValue = launch.ok ? launch.value.value : undefined;
    const value = override === undefined ? launchValue : override;
    const launchSource = launch.ok ? launch.value.source : ("invalid" as const);
    return {
      setting,
      ...(value === undefined ? {} : { value }),
      ...(launch.ok
        ? { launch_value: launch.value.value }
        : { configuration_error: projectAnalysisError(launch.error) }),
      default_value: definition.defaultValue,
      source: override === undefined ? launchSource : ("runtime" as const),
      unit: definition.unit,
      minimum: definition.minimum,
      maximum: definition.maximum,
      applies_at: definition.appliesAt,
      provider: definition.provider,
      operations: [...definition.operations],
      ...(definition.environment === undefined
        ? {}
        : { environment: definition.environment }),
      ...(definition.parameter === undefined
        ? {}
        : { parameter: definition.parameter }),
      agent_editable: true as const,
    };
  }
}
