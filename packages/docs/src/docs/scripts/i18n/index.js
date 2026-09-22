import { promptForLocales } from "./prompts.js";
import { updateAstroConfig } from "./config-updaters/astro-config.js";
import { updateSiteSettings } from "./config-updaters/site-settings.js";
import { updateTranslationData } from "./config-updaters/translation-data.js";
import { updateKeystaticConfig } from "./config-updaters/keystatic-config.js";
import { handleFolderOperations } from "./folder-operations.js";
import { removeHrefTranslations } from "./utils/remove-href-translations.js";
import { removeTextTranslations } from "./utils/remove-text-translations.js";
import { logSection } from "./utils/logging.js";
/**
 * Main function that orchestrates the i18n configuration process
 */
async function configI18n() {
    // Configure extra logging
    const logOptions = { enabled: false, section: true };
    // Step 1: Get locale preferences from user
    const localeConfig = await promptForLocales(logOptions);
    // Step 2: Update the Astro config file and determine locale operations
    const updatedConfig = await updateAstroConfig(localeConfig, logOptions);
    // Step 3: Update configuration files
    await updateSiteSettings(updatedConfig, logOptions);
    await updateTranslationData(updatedConfig, logOptions);
    await updateKeystaticConfig(updatedConfig, logOptions);
    // Step 4: Handle folder operations
    await handleFolderOperations(updatedConfig, logOptions);
    // Step 5: Special case - remove translation features if single language
    if (!updatedConfig.multipleLanguages) {
        await removeHrefTranslations();
        await removeTextTranslations();
    }
    // Step 6: Display completion message
    displayCompletionMessage(updatedConfig.multipleLanguages);
}
/**
 * Displays completion message and next steps
 */
function displayCompletionMessage(multipleLanguages) {
    logSection("Configuration Complete!");
    if (multipleLanguages) {
        // Allow time for user to read output
        setTimeout(() => {
            console.log("Next steps:");
            console.log("1. Update 'localeMap' in src/config/siteSettings.json.ts");
            console.log("2. Update 'languageSwitcherMap' in src/config/siteSettings.json.ts");
            console.log("3. Review your translation files in src/config/[locale]/\n");
        }, 1000);
    }
    // Add a small delay before showing the final message
    setTimeout(() => {
        console.log("Cyberstrike Docs configured successfully! 🔒\n");
    }, 2000);
}
// Run the configuration process
configI18n();
//# sourceMappingURL=index.js.map