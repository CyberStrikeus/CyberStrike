import * as fssync from "node:fs";
import { join } from "path";
import { ACTIVE_PATHS } from "./types.js";
import { log } from "./utils/logging.js";
import { readFileWithFallback, writeFile } from "./utils/file-utils.js";
import { replaceInFiles } from "./utils/replace-in-files.js";
import { copyFolderSync } from "./utils/copy-folder.js";
/**
 * Handles all folder operations related to locale configuration
 */
export async function handleFolderOperations(localeConfig, logOptions) {
    const { defaultLocale, newDefaultLocale, localesToAdd, localesToRemove, editOldDefaultToNewDefault, currentLocales, } = localeConfig;
    // Add new locale folders
    addLocaleFolders(ACTIVE_PATHS.srcConfigFolder, defaultLocale, localesToAdd, logOptions);
    addLocaleFolders(ACTIVE_PATHS.srcContentFolder, defaultLocale, localesToAdd, logOptions);
    // Delete removed locale folders
    removeLocaleFolders(ACTIVE_PATHS.srcConfigFolder, localesToRemove, logOptions);
    removeLocaleFolders(ACTIVE_PATHS.srcContentFolder, localesToRemove, logOptions);
    // Rename default locale folder if needed
    if (editOldDefaultToNewDefault) {
        renameLocaleFolders(ACTIVE_PATHS.srcConfigFolder, defaultLocale, newDefaultLocale, logOptions);
        renameLocaleFolders(ACTIVE_PATHS.srcContentFolder, defaultLocale, newDefaultLocale, logOptions);
    }
    // Update nav data references
    await updateNavDataReferences(defaultLocale, newDefaultLocale, editOldDefaultToNewDefault, logOptions);
    // Handle pages directory
    await handlePagesDirectory({
        defaultLocale,
        newDefaultLocale,
        currentLocales,
        localesToAdd,
        localesToRemove,
        editOldDefaultToNewDefault,
        multipleLanguages: localeConfig.multipleLanguages,
        newLocales: localeConfig.newLocales,
    }, currentLocales, localesToAdd, localesToRemove, logOptions);
}
/**
 * Recursively adds new locale folders by copying from default locale
 */
function addLocaleFolders(folderPath, defaultLocale, localesToAdd, logOptions) {
    if (!fssync.existsSync(folderPath))
        return;
    const files = fssync.readdirSync(folderPath, { withFileTypes: true });
    for (const file of files) {
        const filePath = join(folderPath, file.name);
        if (file.isDirectory()) {
            if (file.name === defaultLocale) {
                // Copy default locale folder to new locale folders
                localesToAdd.forEach((locale) => {
                    const newFolderPath = join(folderPath, locale);
                    copyFolderSync(filePath, newFolderPath);
                    log(`Copied folder ${filePath} to ${newFolderPath}`, logOptions);
                });
            }
            else {
                // Recursively process subdirectories
                addLocaleFolders(filePath, defaultLocale, localesToAdd, logOptions);
            }
        }
    }
}
/**
 * Recursively removes locale folders
 */
function removeLocaleFolders(folderPath, localesToRemove, logOptions) {
    if (!fssync.existsSync(folderPath))
        return;
    const files = fssync.readdirSync(folderPath, { withFileTypes: true });
    for (const file of files) {
        const filePath = join(folderPath, file.name);
        if (file.isDirectory()) {
            if (localesToRemove.includes(file.name)) {
                try {
                    fssync.rmSync(filePath, { recursive: true });
                    log(`Deleted folder: ${filePath}`, logOptions);
                }
                catch (error) {
                    console.error(`Error deleting folder ${filePath}: ${error.message}`);
                }
            }
            else {
                // Recursively process subdirectories
                removeLocaleFolders(filePath, localesToRemove, logOptions);
            }
        }
    }
}
/**
 * Recursively renames locale folders
 */
function renameLocaleFolders(folderPath, oldLocale, newLocale, logOptions) {
    if (!fssync.existsSync(folderPath))
        return;
    const files = fssync.readdirSync(folderPath, { withFileTypes: true });
    for (const file of files) {
        const filePath = join(folderPath, file.name);
        if (file.isDirectory()) {
            if (file.name === oldLocale) {
                const newFolderPath = join(folderPath, newLocale);
                fssync.renameSync(filePath, newFolderPath);
                log(`Renamed folder ${filePath} to ${newFolderPath}`, logOptions);
            }
            else {
                // Recursively process subdirectories
                renameLocaleFolders(filePath, oldLocale, newLocale, logOptions);
            }
        }
    }
}
/**
 * Updates locale references in nav data file
 */
async function updateNavDataReferences(defaultLocale, newDefaultLocale, editOldDefaultToNewDefault, logOptions) {
    if (!editOldDefaultToNewDefault)
        return;
    const navDataPath = join(ACTIVE_PATHS.srcConfigFolder, newDefaultLocale, "navData.json.ts");
    try {
        let navData = await readFileWithFallback(navDataPath);
        navData = navData.replace(new RegExp(`"${defaultLocale}"`, "g"), `"${newDefaultLocale}"`);
        await writeFile(navDataPath, navData, logOptions, false);
    }
    catch (error) {
        console.error(`Error updating nav data references: ${error.message}`);
    }
}
/**
 * Determines which locale folder operations are needed based on the locale configuration
 * @returns Object containing arrays of folders to create and delete
 */
export function determinePagesDirectoryOperations(defaultLocale, newDefaultLocale, editOldDefaultToNewDefault, currentLocales, localesToAdd, localesToRemove) {
    // 1. Initialize our folder operation lists
    const foldersToCreate = [];
    const foldersToDelete = [];
    // 2. Handle locales to add
    for (const locale of localesToAdd) {
        // Skip the new default locale - it doesn't get a folder
        if (locale !== newDefaultLocale) {
            foldersToCreate.push(locale);
        }
    }
    // 3. Handle locales to remove
    for (const locale of localesToRemove) {
        // Always remove locales that are marked for removal
        foldersToDelete.push(locale);
    }
    // 4. Special case: handle the old default locale when default is changing
    if (defaultLocale !== newDefaultLocale) {
        if (editOldDefaultToNewDefault) {
            // When using "editOldDefaultToNewDefault", the old default locale doesn't need a folder
            // unless it's explicitly added to localesToAdd (which is handled in step 2)
        }
        else if (!localesToRemove.includes(defaultLocale)) {
            // Old default locale needs a folder only if it's not being removed
            // and we're not using editOldDefaultToNewDefault
            foldersToCreate.push(defaultLocale);
        }
    }
    // 5. Special case: handle locale that becomes the new default
    if (currentLocales.includes(newDefaultLocale) && newDefaultLocale !== defaultLocale) {
        // If a current locale becomes the new default, remove its folder
        foldersToDelete.push(newDefaultLocale);
    }
    return { foldersToCreate, foldersToDelete };
}
/**
 * Handles operations on the pages directory
 */
async function handlePagesDirectory(localeConfig, currentLocales, localesToAdd, localesToRemove, logOptions) {
    const srcPagesFolder = ACTIVE_PATHS.srcPagesFolder;
    // Extract the default locale from localeConfig
    const defaultLocale = localeConfig.defaultLocale;
    const newDefaultLocale = localeConfig.newDefaultLocale;
    const editOldDefaultToNewDefault = localeConfig.editOldDefaultToNewDefault;
    // Log input parameters if logging is enabled
    if (logOptions.enabled) {
        log(`Pages directory operations input:`, logOptions);
        log(`  - Locales to add: ${localesToAdd.join(", ") || "none"}`, logOptions);
        log(`  - Locales to remove: ${localesToRemove.join(", ") || "none"}`, logOptions);
        log(`  - Default locale change: ${defaultLocale} → ${newDefaultLocale}`, logOptions);
        log(`  - Edit old default to new: ${editOldDefaultToNewDefault}`, logOptions);
        log(`  - Current locales: ${currentLocales.join(", ") || "none"}`, logOptions);
    }
    // PLANNING PHASE: Determine which folders to add and remove
    const { foldersToCreate, foldersToDelete } = determinePagesDirectoryOperations(defaultLocale, newDefaultLocale, editOldDefaultToNewDefault, currentLocales, localesToAdd, localesToRemove);
    // Log the planned operations if logging is enabled
    if (logOptions.enabled) {
        log(`Pages directory operations planned:`, logOptions);
        log(`  - Folders to create: ${foldersToCreate.join(", ") || "none"}`, logOptions);
        log(`  - Folders to delete: ${foldersToDelete.join(", ") || "none"}`, logOptions);
    }
    // EXECUTION PHASE: Apply the folder operations
    // Find a template folder to use as a source for new locales
    let templateFolder = "";
    let templateLocale = "";
    // Find an existing non-default locale folder to use as a template
    for (const locale of currentLocales) {
        if (locale !== defaultLocale) {
            const localeFolder = join(srcPagesFolder, locale);
            if (fssync.existsSync(localeFolder)) {
                templateFolder = localeFolder;
                templateLocale = locale;
                break;
            }
        }
    }
    // If we found a template folder, create the new locale folders
    if (templateFolder && foldersToCreate.length > 0) {
        for (const locale of foldersToCreate) {
            const newLocaleFolder = join(srcPagesFolder, locale);
            // Only create if it doesn't already exist
            if (!fssync.existsSync(newLocaleFolder)) {
                copyFolderSync(templateFolder, newLocaleFolder);
                log(`Created folder for locale: ${newLocaleFolder} (copied from ${templateFolder})`, logOptions);
                // Update locale references
                replaceInFiles(newLocaleFolder, `['"]${templateLocale}['"]`, `"${locale}"`, logOptions.enabled);
            }
            else {
                log(`Folder for locale already exists: ${newLocaleFolder}`, logOptions);
            }
        }
    }
    else if (foldersToCreate.length > 0) {
        log(`Warning: Could not find a template locale folder in ${srcPagesFolder}. No new locale folders created.`, { ...logOptions, enabled: true });
    }
    // Delete folders that need to be removed
    for (const locale of foldersToDelete) {
        const localeFolder = join(srcPagesFolder, locale);
        if (fssync.existsSync(localeFolder)) {
            try {
                fssync.rmSync(localeFolder, { recursive: true });
                log(`Deleted folder for locale: ${localeFolder}`, logOptions);
            }
            catch (error) {
                console.error(`Error deleting folder ${localeFolder}: ${error.message}`);
            }
        }
    }
    console.log("Updated the src/pages/[locale] folders");
}
//# sourceMappingURL=folder-operations.js.map