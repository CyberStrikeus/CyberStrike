import { ACTIVE_PATHS } from "../types.js";
import { readFileWithFallback, writeFile } from "../utils/file-utils.js";
/**
 * Updates the site settings configuration file with new locale settings
 */
export async function updateSiteSettings(localeConfig, logOptions) {
    const { defaultLocale, newDefaultLocale, localesToAdd, localesToRemove, editOldDefaultToNewDefault, newLocales, } = localeConfig;
    // Read the site settings file
    let siteSettings = await readFileWithFallback(ACTIVE_PATHS.siteSettingsPath);
    // Format locales for inserting into config
    const newLocalesString = newLocales.map((locale) => `"${locale}"`).join(", ");
    // Update default locale
    siteSettings = siteSettings.replace(`defaultLocale = "${defaultLocale}"`, `defaultLocale = "${newDefaultLocale}"`);
    // Update locales array
    siteSettings = siteSettings.replace(/locales\s*=\s*\[.*?\]/, `locales = [${newLocalesString}]`);
    // Remove locale entries for removed locales
    localesToRemove.forEach((locale) => {
        siteSettings = siteSettings.replace(new RegExp(`${locale}:.*?,`, "g"), "");
    });
    // Handle renaming default locale references if needed
    if (editOldDefaultToNewDefault) {
        siteSettings = siteSettings.replace(new RegExp(`${defaultLocale}:`, "g"), `${newDefaultLocale}:`);
    }
    // Add new locale entries to localeMap and languageSwitcherMap
    localesToAdd.forEach((locale) => {
        siteSettings = siteSettings.replace("localeMap = {", `localeMap = {\n  ${locale}: "${locale}",`);
        siteSettings = siteSettings.replace("languageSwitcherMap = {", `languageSwitcherMap = {\n  ${locale}: "${locale.toUpperCase()}",`);
    });
    // Write the updated site settings
    await writeFile(ACTIVE_PATHS.siteSettingsPath, siteSettings, logOptions);
}
//# sourceMappingURL=site-settings.js.map