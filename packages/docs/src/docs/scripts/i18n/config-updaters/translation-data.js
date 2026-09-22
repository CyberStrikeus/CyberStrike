import { ACTIVE_PATHS } from "../types.js";
import { readFileWithFallback, writeFile } from "../utils/file-utils.js";
/**
 * Updates the translation data file with new locale settings
 */
export async function updateTranslationData(localeConfig, logOptions) {
    const { defaultLocale, newDefaultLocale, localesToAdd, localesToRemove, editOldDefaultToNewDefault, } = localeConfig;
    // Read the translation data file
    let translationData = await readFileWithFallback(ACTIVE_PATHS.translationDataPath);
    // Uppercase the first letter of the locales for use in variable names
    const defaultLocaleUppercase = defaultLocale.charAt(0).toUpperCase() + defaultLocale.slice(1);
    const newDefaultLocaleUppercase = newDefaultLocale.charAt(0).toUpperCase() + newDefaultLocale.slice(1);
    // Find all data items (siteData, navData, etc.)
    const dataItems = [];
    const dataLocaleRegex = new RegExp(`(\\w+Data)${defaultLocaleUppercase}`, "g");
    let match;
    while ((match = dataLocaleRegex.exec(translationData)) !== null) {
        dataItems.push(match[1]); // Store just the base name (e.g., "siteData")
    }
    // Remove duplicates
    const uniqueDataItems = [...new Set(dataItems)];
    // Extract text translations for the default locale
    const textTranslationsRegex = /export const textTranslations = ({(?:{[^{}]*}|[^{}])*})/;
    const textTranslationsMatch = translationData.match(textTranslationsRegex);
    if (!textTranslationsMatch) {
        throw new Error("Could not find textTranslations object in translationData.json.ts");
    }
    const textTranslationsObjectValue = textTranslationsMatch[1];
    const defaultTextTranslationRegex = new RegExp(`${defaultLocale}: {[^}]*}`, "g");
    const defaultTextTranslationMatch = textTranslationsObjectValue.match(defaultTextTranslationRegex);
    if (!defaultTextTranslationMatch) {
        throw new Error("Could not find defaultLocale object in textTranslations object");
    }
    const defaultTextTranslationValue = defaultTextTranslationMatch[0];
    // Extract route translations for the default locale
    const routeTranslationsRegex = /export const routeTranslations = ({(?:{[^{}]*}|[^{}])*})/;
    const routeTranslationsMatch = translationData.match(routeTranslationsRegex);
    if (!routeTranslationsMatch) {
        throw new Error("Could not find routeTranslations object in translationData.json.ts");
    }
    const routeTranslationsObjectValue = routeTranslationsMatch[1];
    const defaultRouteTranslationRegex = new RegExp(`${defaultLocale}: {[^}]*}`, "g");
    const defaultRouteTranslationMatch = routeTranslationsObjectValue.match(defaultRouteTranslationRegex);
    if (!defaultRouteTranslationMatch) {
        throw new Error("Could not find defaultLocale object in routeTranslations object");
    }
    const defaultRouteTranslationValue = defaultRouteTranslationMatch[0];
    // Update translation data based on edit strategy
    if (editOldDefaultToNewDefault) {
        // Replace all references to old default locale with new default locale
        translationData = translationData.replace(new RegExp(`${defaultLocale}:`, "g"), `${newDefaultLocale}:`);
        translationData = translationData.replace(new RegExp(`/${defaultLocale}/`, "g"), `/${newDefaultLocale}/`);
        translationData = translationData.replace(new RegExp(`Data${defaultLocaleUppercase}`, "g"), `Data${newDefaultLocaleUppercase}`);
    }
    // Remove locales that are no longer needed
    localesToRemove.forEach((locale) => {
        // Remove locale objects from translations
        translationData = translationData.replace(new RegExp(`${locale}: {[^}]*},`, "g"), "");
        // Remove import statements for removed locales
        translationData = translationData.replace(new RegExp(`.*/${locale}/.*\\n?`, "g"), "");
    });
    // Add new locales
    localesToAdd.forEach((locale) => {
        // First uppercase the first letter of the locale
        const localeUppercase = locale.charAt(0).toUpperCase() + locale.slice(1);
        // Add imports for the new locale
        const importIndex = translationData.indexOf("import");
        uniqueDataItems.forEach((dataItem) => {
            const importString = `import ${dataItem}${localeUppercase} from "./${locale}/${dataItem}.json";\n`;
            translationData =
                translationData.slice(0, importIndex) + importString + translationData.slice(importIndex);
        });
        // Add the new locale to data translations
        translationData = translationData.replace("export const dataTranslations = {", `export const dataTranslations = {\n  ${locale}: {}`);
        // Add data items for the new locale
        let dataTranslationsLocaleString = "";
        uniqueDataItems.forEach((dataItem) => {
            dataTranslationsLocaleString += `\n    ${dataItem}: ${dataItem}${localeUppercase},`;
        });
        translationData = translationData.replace(new RegExp(`${locale}: {}`, "g"), `${locale}: {${dataTranslationsLocaleString}\n  },`);
        // Add text translations for the new locale
        const localeTextTranslation = defaultTextTranslationValue.replace(new RegExp(`${defaultLocale}: {`, "g"), `${locale}: {`);
        translationData = translationData.replace("export const textTranslations = {", `export const textTranslations = {\n  ${localeTextTranslation},`);
        // Add route translations for the new locale
        const localeRouteTranslation = defaultRouteTranslationValue.replace(new RegExp(`${defaultLocale}: {`, "g"), `${locale}: {`);
        translationData = translationData.replace("export const routeTranslations = {", `export const routeTranslations = {\n  ${localeRouteTranslation},`);
    });
    // --- BEGIN localizedCollections update logic ---
    // Find and update localizedCollections object
    const localizedCollectionsRegex = /export const localizedCollections = (\{[\s\S]*?\}) as const;/m;
    const localizedCollectionsMatch = translationData.match(localizedCollectionsRegex);
    if (localizedCollectionsMatch) {
        let localizedCollectionsText = localizedCollectionsMatch[1];
        // Parse the collections (very simple JS object parser for this structure)
        localizedCollectionsText = localizedCollectionsText.replace(/(\w+): \{([^}]*)\}/g, (full, collection, localesBlock) => {
            // Build a map of locale to value for this collection
            const localeEntries = Array.from(localesBlock.matchAll(/(\w+):\s*"([^"]*)"/g))
                .map((match) => Array.isArray(match) && typeof match[1] === "string" && typeof match[2] === "string"
                ? [match[1], match[2]]
                : undefined)
                .filter((entry) => !!entry);
            const localeMap = new Map(localeEntries);
            // Store the last value before removals
            let fallbackValue = "";
            if (localeEntries.length > 0) {
                fallbackValue = localeEntries[0][1];
            }
            // Remove locales
            localesToRemove.forEach((locale) => localeMap.delete(locale));
            // After removals, get a value from any remaining locale (if any)
            const remainingLocales = Array.from(localeMap.values());
            const copyFromValue = remainingLocales[0] ?? fallbackValue;
            // Add new locales (copy from any remaining or fallback value)
            localesToAdd.forEach((locale) => {
                if (!localeMap.has(locale)) {
                    localeMap.set(locale, copyFromValue);
                }
            });
            // Rename locale keys if needed
            if (editOldDefaultToNewDefault &&
                localeMap.has(defaultLocale) &&
                !localeMap.has(newDefaultLocale)) {
                const value = localeMap.get(defaultLocale) ?? copyFromValue;
                localeMap.delete(defaultLocale);
                localeMap.set(newDefaultLocale, value);
            }
            // Rebuild locales block
            const newLocalesBlock = Array.from(localeMap.entries())
                .map(([k, v]) => `\n\t\t${k}: "${v}"`)
                .join(",") + "\n\t";
            return `${collection}: {${newLocalesBlock}}`;
        });
        // Replace the old localizedCollections object in translationData
        translationData = translationData.replace(localizedCollectionsRegex, `export const localizedCollections = ${localizedCollectionsText} as const;`);
    }
    // --- END localizedCollections update logic ---
    // --- BEGIN localeMap/languageSwitcherMap update logic ---
    // Helper to update a map object in the file
    function updateLocaleMapObject(translationData, mapName, localeSet, valueFn) {
        const mapRegex = new RegExp(`export const ${mapName} = ({[\\s\\S]*?}) as const;`, "m");
        const match = translationData.match(mapRegex);
        if (!match)
            return translationData;
        const mapText = match[1];
        const entryRegex = /(\w+):\s*"([^"]*)"/g;
        const prevEntries = new Map();
        let entryMatch;
        while ((entryMatch = entryRegex.exec(mapText))) {
            prevEntries.set(entryMatch[1], entryMatch[2]);
        }
        // Build new map entries
        const newEntries = Array.from(localeSet).map((locale) => {
            const prevValue = prevEntries.get(locale);
            return `  ${locale}: "${valueFn(locale, prevValue)}"`;
        });
        const newMapText = `{
${newEntries.join(",\n")}
}`;
        return translationData.replace(mapRegex, `export const ${mapName} = ${newMapText} as const;`);
    }
    // Determine the current set of locales after add/remove/rename
    const currentLocales = new Set();
    // Start from all locales present at this point
    uniqueDataItems.forEach(() => { }); // no-op, just to show context
    // Gather all locales present in dataTranslations (robust way)
    const dataTranslationsRegex = /export const dataTranslations = \{([\s\S]*?)\}/m;
    const dataTranslationsMatch = translationData.match(dataTranslationsRegex);
    if (dataTranslationsMatch) {
        const dtBlock = dataTranslationsMatch[1];
        const dtLocaleRegex = /(\w+): \{/g;
        let m;
        while ((m = dtLocaleRegex.exec(dtBlock))) {
            currentLocales.add(m[1]);
        }
    }
    // Update localeMap
    translationData = updateLocaleMapObject(translationData, "localeMap", currentLocales, (locale, prevValue) => (prevValue !== undefined ? prevValue : locale));
    // Update languageSwitcherMap
    translationData = updateLocaleMapObject(translationData, "languageSwitcherMap", currentLocales, (locale, prevValue) => (prevValue !== undefined ? prevValue : locale.toUpperCase()));
    // --- END localeMap/languageSwitcherMap update logic ---
    // Write the updated translation data
    await writeFile(ACTIVE_PATHS.translationDataPath, translationData, logOptions);
}
//# sourceMappingURL=translation-data.js.map