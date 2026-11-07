import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { collectFiles } from "./collect-files.js";
async function removeHrefTranslations(logging = false) {
    const srcDir = join(process.cwd(), "src");
    const files = [];
    try {
        await collectFiles(files, srcDir);
        if (logging) {
            console.log(`Found ${files.length} files to process`);
        }
        // Process each file
        for (const filepath of files) {
            try {
                let content = await readFile(filepath, "utf-8");
                const originalContent = content;
                // Remove the import statement if it exists while preserving newlines
                content = content.replace(/import\s*{\s*getRelativeLocaleUrl\s*}\s*from\s*["']astro:i18n["']\s*;?\s*/g, "\n");
                // replace cases that look like getRelativeLocaleUrl(currLocale) with "/"
                content = content.replace(/getRelativeLocaleUrl\s*\(\s*\w+\s*\)/g, '"/"');
                // Replace getRelativeLocaleUrl with direct paths, handling both variables and literals
                content = content.replace(/getRelativeLocaleUrl\s*\(\s*\w+\s*,\s*((?:`[^`]*`|'[^']*'|"[^"]*"|[^,)]+))(?:\s*,\s*[^)]+)?\s*\)/g, (match, path) => {
                    // If path is a string literal or template literal, trim it, otherwise return the variable as is
                    return path.trim().match(/^[`'"]|^\$/) ? path.trim() : path.trim();
                });
                // do the same for getLocalizedRoute
                content = content.replace(/import\s*{\s*getLocalizedRoute\s*}\s*from\s*["']@?\/?js\/translationUtils["']\s*;?\s*/g, "\n");
                content = content.replace(/getLocalizedRoute\s*\(\s*\w+\s*,\s*((?:`[^`]*`|'[^']*'|"[^"]*"|[^,)]+))(?:\s*,\s*[^)]+)?\s*\)/g, (match, path) => {
                    // If path is a string literal or template literal, trim it, otherwise return the variable as is
                    return path.trim().match(/^[`'"]|^\$/) ? path.trim() : path.trim();
                });
                // Clean up any extra newlines
                content = content.replace(/\n{3,}/g, "\n\n").trim();
                // Only write if content changed
                if (content !== originalContent) {
                    await writeFile(filepath, content, "utf-8");
                    if (logging) {
                        console.log(`Updated ${filepath}`);
                    }
                }
            }
            catch (fileError) {
                console.error(`Error processing file ${filepath}:`, fileError);
                // Continue with other files
            }
        }
        if (logging) {
            console.log("Removed href translations from all files");
        }
    }
    catch (error) {
        console.error("Error processing files:", error);
        throw error; // Re-throw to allow proper error handling by caller
    }
}
export { removeHrefTranslations };
//# sourceMappingURL=remove-href-translations.js.map