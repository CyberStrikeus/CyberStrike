/**
 * Default configuration paths for regular website projects
 */
export const DEFAULT_PATHS = {
    astroConfigPath: "astro.config.mjs",
    siteSettingsPath: "src/config/siteSettings.json.ts",
    translationDataPath: "src/config/translationData.json.ts",
    keystaticConfigPath: "keystatic.config.tsx",
    srcConfigFolder: "src/config",
    srcContentFolder: "src/data",
    srcPagesFolder: "src/pages",
};
/**
 * Default configuration paths for docs projects
 */
export const DOCS_PATHS = {
    astroConfigPath: "astro.config.mjs",
    siteSettingsPath: "src/docs/config/siteSettings.json.ts",
    translationDataPath: "src/docs/config/translationData.json.ts",
    keystaticConfigPath: "keystatic.config.ts", // May not be used in docs
    srcConfigFolder: "src/docs/config",
    srcContentFolder: "src/docs/data",
    srcPagesFolder: "src/pages",
};
// Current active configuration paths
export let ACTIVE_PATHS = { ...DEFAULT_PATHS };
/**
 * Sets the active configuration paths
 * @param paths Custom configuration paths or a preset name
 */
export function setConfigPaths(paths) {
    if (paths === "default") {
        ACTIVE_PATHS = { ...DEFAULT_PATHS };
    }
    else if (paths === "docs") {
        ACTIVE_PATHS = { ...DOCS_PATHS };
    }
    else {
        ACTIVE_PATHS = { ...paths };
    }
    return ACTIVE_PATHS;
}
//# sourceMappingURL=types.js.map