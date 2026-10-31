/** Search phase and image kind affected by one embedded dyld setting. */
export interface DyldSearchOverride {
  readonly phase: "override" | "fallback";
  readonly scope: "library" | "framework" | "prefix" | "all";
  readonly variable: string;
  readonly value: string;
}

/** Retain recognized image-selection settings separately from diagnostic observations. */
export const embeddedDyldOverrides = (
  environment: readonly string[],
  platforms: readonly number[],
): DyldSearchOverride[] => {
  const overrides: DyldSearchOverride[] = [];
  for (const setting of environment) {
    const delimiter = setting.indexOf("=");
    if (delimiter <= 0) continue;
    const variable = setting.slice(0, delimiter);
    const value = setting.slice(delimiter + 1);
    const effect = overrideEffect(variable, value);
    if (effect === undefined) continue;
    // ROOT_PATH is accepted only for simulator processes. Missing or unknown
    // platform metadata cannot establish that dyld ignores it.
    if (
      variable === "DYLD_ROOT_PATH" &&
      platforms.length > 0 &&
      platforms.every((platform) => platform >= 1 && platform <= 12) &&
      !platforms.some((platform) => [7, 8, 9, 12].includes(platform))
    )
      continue;
    overrides.push({ variable, value, ...effect });
  }
  return overrides;
};

const overrideEffect = (
  variable: string,
  value: string,
): Pick<DyldSearchOverride, "phase" | "scope"> | undefined => {
  switch (variable) {
    // Empty directory components still produce /leaf candidates in dyld.
    // In particular, an empty fallback value is not a no-op.
    case "DYLD_LIBRARY_PATH":
      return { phase: "override", scope: "library" };
    case "DYLD_FRAMEWORK_PATH":
      return { phase: "override", scope: "framework" };
    case "DYLD_FALLBACK_LIBRARY_PATH":
      return { phase: "fallback", scope: "library" };
    case "DYLD_FALLBACK_FRAMEWORK_PATH":
      return { phase: "fallback", scope: "framework" };
    // Versioned paths map discovered images to their reported install names,
    // so the directory's kind does not establish the replaced image's kind.
    case "DYLD_VERSIONED_LIBRARY_PATH":
    case "DYLD_VERSIONED_FRAMEWORK_PATH":
    case "DYLD_IMAGE_SUFFIX":
      // Versioned paths scan directories; suffixes create path variants.
      // Empty directories cannot be scanned and empty suffixes repeat a path.
      return /[^:]/u.test(value)
        ? { phase: "override", scope: "all" }
        : undefined;
    case "DYLD_INSERT_LIBRARIES":
      return value === "" ? undefined : { phase: "override", scope: "all" };
    case "DYLD_ROOT_PATH":
    case "DYLD_OVERLAY_PATH":
      return value === "" ? undefined : { phase: "override", scope: "prefix" };
    default:
      return undefined;
  }
};

const isFrameworkInstallName = (
  name: string,
  overrides: readonly DyldSearchOverride[],
): boolean => {
  const separator = name.lastIndexOf(".framework/");
  if (separator < 0) return false;
  const framework = name.slice(0, separator).split("/").at(-1);
  const leaf = name.slice(name.lastIndexOf("/") + 1);
  return (
    leaf === framework ||
    overrides.some(
      ({ variable, value }) =>
        variable === "DYLD_IMAGE_SUFFIX" && leaf === `${framework}${value}`,
    )
  );
};

/** Select only settings that can affect this dependency at its reached search phase. */
export const hasApplicableDyldOverrides = (
  overrides: readonly DyldSearchOverride[],
  installName: string,
  ordinarySearchFoundImage: boolean,
): boolean => {
  const kind = isFrameworkInstallName(installName, overrides)
    ? "framework"
    : "library";
  return overrides.some(
    ({ phase, scope }) =>
      (phase === "override" || !ordinarySearchFoundImage) &&
      (scope === "all" ||
        scope === kind ||
        (scope === "prefix" && !installName.startsWith("@"))),
  );
};
