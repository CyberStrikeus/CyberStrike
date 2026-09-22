import readline from "readline";
import { logSection } from "./utils/logging.js";
/**
 * Validates locale format (e.g., 'en' or 'en-US')
 */
const validateLocale = (locale) => {
    const localeRegex = /^[a-z]{2}(-[A-Z]{2})?$/;
    return localeRegex.test(locale);
};
/**
 * Prompts the user for locale preferences and builds configuration
 */
export async function promptForLocales(logOptions) {
    if (logOptions.section) {
        logSection("This script will help configure project i18n settings");
    }
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    // Ask if multiple languages will be used
    const multipleLanguages = await new Promise((resolve) => {
        rl.question("Do you plan to use multiple languages? (y/n): ", (answer) => {
            resolve(answer.toLowerCase() === "y");
        });
    });
    console.log("\nNOTE: locale examples can be seen at: https://github.com/cospired/i18n-iso-languages");
    // Ask for default locale
    const newDefaultLocale = await new Promise((resolve) => {
        const promptLocale = () => {
            rl.question("\nWhat is the default locale for your website? (e.g. en): ", (answer) => {
                const sanitizedAnswer = answer.replace(/\\s+/g, "").toLowerCase();
                if (validateLocale(sanitizedAnswer)) {
                    resolve(sanitizedAnswer);
                }
                else {
                    console.log("\nInvalid locale format. Please use format like 'en' or 'en-US'");
                    promptLocale();
                }
            });
        };
        promptLocale();
    });
    // Ask for additional locales if multiple languages are wanted
    let newLocales = [];
    if (multipleLanguages) {
        newLocales = await new Promise((resolve) => {
            rl.question("\nWhat other locales do you plan to use? (separated by commas): ", (answer) => {
                // Split by comma and trim whitespace
                const sanitizedAnswer = answer.split(",").map((locale) => locale.trim().toLowerCase());
                resolve(sanitizedAnswer);
            });
        });
    }
    // Add default locale to locales array and deduplicate
    newLocales.push(newDefaultLocale);
    const newLocalesSet = new Set(newLocales);
    newLocales = [...newLocalesSet].filter((locale) => locale !== "");
    // Format locales for display
    const newLocalesString = newLocales.map((locale) => `"${locale}"`).join(", ");
    console.log(`\nDefault locale: "${newDefaultLocale}"`);
    console.log(`Locales: [${newLocalesString}]\n`);
    // Confirm the locales with the user
    const localesConfirmed = await new Promise((resolve) => {
        rl.question("Are the above locales correct? (y/n): ", (answer) => {
            resolve(answer.toLowerCase() === "y");
        });
    });
    if (!localesConfirmed) {
        rl.close();
        console.log("\nPlease re-run the script and try again.\n");
        process.exit(0);
    }
    // Close the readline interface
    rl.close();
    // Build and return the locale configuration
    // Note: The current locale will need to be read from config files,
    // which we'll do in the individual updater modules
    return {
        multipleLanguages,
        defaultLocale: "", // Will be populated by astro-config.ts
        newDefaultLocale,
        currentLocales: [], // Will be populated by astro-config.ts
        newLocales,
        localesToAdd: [], // Will be determined by comparison logic in astro-config.ts
        localesToRemove: [], // Will be determined by comparison logic in astro-config.ts
        editOldDefaultToNewDefault: false, // Will be determined in astro-config.ts
    };
}
//# sourceMappingURL=prompts.js.map