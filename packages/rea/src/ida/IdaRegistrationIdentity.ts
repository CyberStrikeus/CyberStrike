import { digestCanonicalValue } from "../domain/canonicalDigest.js";
import type { IdaConfiguration } from "./IdaConfiguration.js";

/** HTTP authentication fields have protocol-defined credential meaning. */
export const isIdaAuthenticationHeader = (name: string): boolean =>
  ["authorization", "proxy-authorization", "cookie"].includes(
    name.toLowerCase(),
  );

const isSensitiveHeader = (config: IdaConfiguration, name: string): boolean =>
  isIdaAuthenticationHeader(name) ||
  (config.sensitive?.headers.some(
    (selected) => selected.toLowerCase() === name.toLowerCase(),
  ) ??
    false);

/** Values explicitly marked by the registration, without name-pattern guesses. */
export const idaExplicitSensitiveValues = (
  config: IdaConfiguration | undefined,
): readonly string[] => {
  if (config === undefined) return [];
  return "headers" in config
    ? Object.entries(config.headers)
        .filter(([name]) =>
          config.sensitive?.headers.some(
            (selected) => selected.toLowerCase() === name.toLowerCase(),
          ),
        )
        .map(([, value]) => value)
    : Object.entries(config.env)
        .filter(([name]) => config.sensitive?.env.includes(name))
        .map(([, value]) => value);
};

/** Credentials select a live connection, but do not identify analysis semantics. */
export const idaRegistrationDigest = (config: IdaConfiguration): string =>
  digestCanonicalValue(
    "headers" in config
      ? {
          ...config,
          headers: Object.fromEntries(
            Object.entries(config.headers).map(([name, value]) => [
              name,
              isSensitiveHeader(config, name) ? null : value,
            ]),
          ),
        }
      : {
          ...config,
          env: Object.fromEntries(
            Object.entries(config.env).map(([name, value]) => [
              name,
              config.sensitive?.env.includes(name) ? null : value,
            ]),
          ),
        },
    "IDA registration analysis identity",
  );
