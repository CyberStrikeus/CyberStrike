import { ACTIVE_PATHS } from "../types.js";
import { readFileWithFallback, writeFile } from "../utils/file-utils.js";
import { log } from "../utils/logging.js";
import { promises as fsPromises } from "fs";
/**
 * Updates the Astro configuration file with new locale settings
 * Also determines which locales need to be added/removed and whether to edit the default locale
 */
export async function updateAstroConfig(localeConfig, logOptions) {
    // Read the Astro config file
    let astroConfig;
    try {
        astroConfig = await fsPromises.readFile(ACTIVE_PATHS.astroConfigPath, "utf8");
    }
    catch (error) {
        astroConfig = await readFileWithFallback(ACTIVE_PATHS.astroConfigPath);
    }
    // Extract current defaultLocale from the file
    const defaultLocaleMatch = astroConfig.match(/defaultLocale: "(.*?)"/);
    if (!defaultLocaleMatch) {
        throw new Error("Could not find defaultLocale in astro.config.mjs");
    }
    const defaultLocale = defaultLocaleMatch[1];
    // Extract current locales from the file
    const currLocalesMatch = astroConfig.match(/locales: \[(.*?)\]/);
    if (!currLocalesMatch) {
        throw new Error("Could not find locales array in astro.config.mjs");
    }
    const currLocales = currLocalesMatch[1];
    const currentLocales = currLocales.split(",").map((locale) => locale.replace(/"/g, "").trim());
    // Complete the locale configuration with extracted data
    const updatedLocaleConfig = {
        ...localeConfig,
        defaultLocale,
        currentLocales,
        localesToAdd: [],
        localesToRemove: [],
        editOldDefaultToNewDefault: false,
    };
    // Determine locale operations (add/remove/edit)
    determineLocaleOperations(updatedLocaleConfig);
    if (logOptions.enabled) {
        log(`Locale operations determined: 
		- Locales to add: ${updatedLocaleConfig.localesToAdd.join(", ")}
		- Locales to remove: ${updatedLocaleConfig.localesToRemove.join(", ")}
		- Default locale change: ${updatedLocaleConfig.defaultLocale} -> ${updatedLocaleConfig.newDefaultLocale}
		- Edit old default to new default: ${updatedLocaleConfig.editOldDefaultToNewDefault}`, logOptions);
    }
    // Create new locales string for the Astro config
    const newLocalesString = updatedLocaleConfig.newLocales.map((locale) => `"${locale}"`).join(", ");
    // Update the Astro config with new locale settings
    astroConfig = astroConfig.replace(`defaultLocale: "${defaultLocale}"`, `defaultLocale: "${updatedLocaleConfig.newDefaultLocale}"`);
    astroConfig = astroConfig.replace(`locales: [${currLocales}]`, `locales: [${newLocalesString}]`);
    // Write the updated Astro config
    await writeFile(ACTIVE_PATHS.astroConfigPath, astroConfig, logOptions);
    return updatedLocaleConfig;
}
/**
 * Determines which locales need to be added/removed and whether to edit the default locale
 */
function determineLocaleOperations(localeConfig) {
    const { defaultLocale, newDefaultLocale, currentLocales, newLocales } = localeConfig;
    // If newDefaultLocale already exists in currentLocales
    if (currentLocales.includes(newDefaultLocale)) {
        localeConfig.editOldDefaultToNewDefault = false;
        // Add new locales that don't exist in currentLocales
        localeConfig.localesToAdd = newLocales.filter((locale) => !currentLocales.includes(locale));
        // Remove old locales that don't exist in newLocales
        localeConfig.localesToRemove = currentLocales.filter((locale) => !newLocales.includes(locale));
    }
    else {
        // If newDefaultLocale doesn't exist in currentLocales
        if (newLocales.includes(defaultLocale)) {
            // oldDefaultLocale exists in newLocales
            // don't edit old to new default, just add as new locale
            localeConfig.editOldDefaultToNewDefault = false;
            // Add new locales that don't exist in currentLocales
            localeConfig.localesToAdd = newLocales.filter((locale) => !currentLocales.includes(locale));
            // Remove old locales that don't exist in newLocales
            localeConfig.localesToRemove = currentLocales.filter((locale) => !newLocales.includes(locale));
        }
        else {
            // oldDefaultLocale doesn't exist in newLocales
            // edit old to new default
            localeConfig.editOldDefaultToNewDefault = true;
            // Add new locales that don't exist in currentLocales, except for newDefaultLocale
            localeConfig.localesToAdd = newLocales.filter((locale) => !currentLocales.includes(locale) && locale !== newDefaultLocale);
            // Remove old locales that don't exist in newLocales, except for defaultLocale
            localeConfig.localesToRemove = currentLocales.filter((locale) => !newLocales.includes(locale) && locale !== defaultLocale);
        }
    }
}
//# sourceMappingURL=astro-config.js.map