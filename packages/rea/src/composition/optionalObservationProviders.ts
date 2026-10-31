import type { AnalysisSettingsReader } from "../domain/analysisSettings.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import type {
  OptionalObservationProviders,
  OptionalProviderLoadFailure,
  OptionalProviderLoadResult,
} from "../application/OptionalObservationProviders.js";
import {
  CDP_BROWSER_PROVIDER_IDENTITY,
  PLAYWRIGHT_BROWSER_SCENARIO_PROVIDER_IDENTITY,
  CDP_ELECTRON_PROVIDER_IDENTITY,
  PLAYWRIGHT_ELECTRON_ACTIVE_PROVIDER_IDENTITY,
} from "../browser/providerIdentities.js";
import { V8_INSPECTOR_PROVIDER_IDENTITY } from "../inspector/providerIdentity.js";
import type { V8InspectorAdmission } from "../inspector/V8InspectorProvider.js";
import type { WebBundleAnalysisAdmission } from "../browser/IsolatedWebBundleAnalyzer.js";
import { err, ok, type Result } from "../domain/result.js";

/** Precisely typed startup factories for the five existing observation ports. */
export type OptionalObservationFactories = {
  readonly [Port in keyof OptionalObservationProviders]-?: () => Promise<
    NonNullable<OptionalObservationProviders[Port]>
  >;
};

/** Bind optional provider construction to one caller-selected process environment. */
export const createOptionalObservationFactories = (
  selectedEnvironment: Readonly<Record<string, string | undefined>>,
  settings?: AnalysisSettingsReader,
): OptionalObservationFactories => {
  const environment = snapshotEnvironment(selectedEnvironment);
  let runtimeAdmission: V8InspectorAdmission | undefined;
  let webBundleAdmission: WebBundleAnalysisAdmission | undefined;
  return {
    browserObservation: async () => {
      const browser = await import("./browserObservation.js");
      const { WebBundleAnalysisAdmission: Admission } =
        await import("../browser/IsolatedWebBundleAnalyzer.js");
      webBundleAdmission ??= new Admission();
      return browser.createBrowserObservationProvider(webBundleAdmission);
    },
    browserScenarioCapture: async () =>
      (await import("./browserScenario.js")).createBrowserScenarioProvider(
        environment,
      ),
    electronObservation: async () =>
      (
        await import("./electronObservation.js")
      ).createElectronObservationProvider(environment, settings),
    electronActiveObservation: async () =>
      (await import("./electronScenario.js")).createElectronScenarioProvider(
        environment,
      ),
    javascriptRuntimeObservation: async () => {
      const runtime = await import("./javascriptRuntimeObservation.js");
      runtimeAdmission ??= new runtime.V8InspectorAdmission();
      return runtime.createJavaScriptRuntimeObservationProvider(
        environment,
        settings,
        runtimeAdmission,
      );
    },
  };
};

const loadPort = async <Port>(
  factory: () => Promise<Port>,
  providerId: string,
): Promise<Result<Port, OptionalProviderLoadFailure>> => {
  try {
    return ok(await factory());
  } catch (cause: unknown) {
    return err({
      providerId,
      reason: cause instanceof Error ? cause.message : String(cause),
    });
  }
};

/** Load each adapter independently, retaining healthy peers and exact failures. */
export const loadOptionalObservationProviders = async (
  factories: OptionalObservationFactories,
): Promise<OptionalProviderLoadResult> => {
  const [browser, scenario, electron, electronActive, runtime] =
    await Promise.all([
      loadPort(factories.browserObservation, CDP_BROWSER_PROVIDER_IDENTITY.id),
      loadPort(
        factories.browserScenarioCapture,
        PLAYWRIGHT_BROWSER_SCENARIO_PROVIDER_IDENTITY.id,
      ),
      loadPort(
        factories.electronObservation,
        CDP_ELECTRON_PROVIDER_IDENTITY.id,
      ),
      loadPort(
        factories.electronActiveObservation,
        PLAYWRIGHT_ELECTRON_ACTIVE_PROVIDER_IDENTITY.id,
      ),
      loadPort(
        factories.javascriptRuntimeObservation,
        V8_INSPECTOR_PROVIDER_IDENTITY.id,
      ),
    ]);
  return {
    ...(browser.ok ? { browserObservation: browser.value } : {}),
    ...(scenario.ok ? { browserScenarioCapture: scenario.value } : {}),
    ...(electron.ok ? { electronObservation: electron.value } : {}),
    ...(electronActive.ok
      ? { electronActiveObservation: electronActive.value }
      : {}),
    ...(runtime.ok ? { javascriptRuntimeObservation: runtime.value } : {}),
    optionalProviderLoadFailures: {
      ...(browser.ok ? {} : { browserObservation: browser.error }),
      ...(scenario.ok ? {} : { browserScenarioCapture: scenario.error }),
      ...(electron.ok ? {} : { electronObservation: electron.error }),
      ...(electronActive.ok
        ? {}
        : { electronActiveObservation: electronActive.error }),
      ...(runtime.ok ? {} : { javascriptRuntimeObservation: runtime.error }),
    },
  };
};
