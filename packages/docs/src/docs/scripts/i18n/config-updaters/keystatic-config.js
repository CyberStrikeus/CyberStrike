import { ACTIVE_PATHS } from "../types.js";
import { readFileWithFallback, writeFile } from "../utils/file-utils.js";
import { log } from "../utils/logging.js";
/**
 * Updates the Keystatic configuration file with new locale settings
 */
export async function updateKeystaticConfig(localeConfig, logOptions) {
    try {
        const { defaultLocale, newDefaultLocale, localesToAdd, localesToRemove, editOldDefaultToNewDefault, } = localeConfig;
        // Read the keystatic config file
        let keystaticConfig = await readFileWithFallback(ACTIVE_PATHS.keystaticConfigPath);
        // Find lines with default locale references
        const defaultLocaleLines = keystaticConfig
            .split("\n")
            .filter((line) => line.includes(`("${defaultLocale}")`));
        // Add new locales based on the pattern of default locale lines
        localesToAdd.forEach((locale) => {
            defaultLocaleLines.forEach((collectionLine) => {
                // Create new line with updated locale
                const newLine = collectionLine
                    .replace(`${defaultLocale.toUpperCase()}:`, `${locale.toUpperCase()}:`)
                    .replace(`("${defaultLocale}")`, `("${locale}")`);
                // Replace old line with old + new line
                keystaticConfig = keystaticConfig.replace(collectionLine, `${collectionLine}\n${newLine}`);
            });
        });
        // Remove locales that are no longer needed
        localesToRemove.forEach((locale) => {
            const regex = new RegExp(`.*"${locale}".*\\n?`, "g");
            keystaticConfig = keystaticConfig.replace(regex, "");
        });
        // Handle renaming default locale references if needed
        if (editOldDefaultToNewDefault) {
            keystaticConfig = keystaticConfig.replace(new RegExp(`"${defaultLocale}"`, "g"), `"${newDefaultLocale}"`);
            keystaticConfig = keystaticConfig.replace(new RegExp(`${defaultLocale.toUpperCase()}:`, "g"), `${newDefaultLocale.toUpperCase()}:`);
        }
        // Write the updated keystatic config file
        await writeFile(ACTIVE_PATHS.keystaticConfigPath, keystaticConfig, logOptions);
    }
    catch (error) {
        const errorMessage = error.message;
        console.error(`Error updating keystatic.config.tsx: ${errorMessage}`);
        log(`Failed to update keystatic config: ${errorMessage}`, logOptions);
    }
}
//# sourceMappingURL=keystatic-config.js.map