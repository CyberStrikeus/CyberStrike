import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { collectFiles } from "./collect-files.js";
export function formatTranslationText(text) {
    // Convert snake_case or kebab-case to Sentence case and normalize spaces
    return text
        .replace(/[_.-]/g, " ")
        .toLowerCase()
        .replace(/^\w/, (c) => c.toUpperCase())
        .replace(/\s+/g, " ");
}
export async function removeTextTranslations(logging = false) {
    const srcDir = join(process.cwd(), "src");
    const files = [];
    try {
        await collectFiles(files, srcDir);
        if (logging) {
            console.log(`Found ${files.length} files to process`);
        }
        // Process each file
        for (const filepath of files) {
            let content = await readFile(filepath, "utf-8");
            const originalContent = content;
            // Replace {t("translation_key")} with formatted text
            content = content.replace(/{\s*\w+\s*\(["']([\w-]+)["']\)}/g, (match, key) => {
                return formatTranslationText(key);
            });
            // remove any const <const anything = useTranslations(anything);> and <import { useTranslations } from "@js/translationUtils">;
            content = content.replace(/import\s*{\s*useTranslations\s*}\s*from\s*['"]@\/?js\/translationUtils['"]\s*;?\s*/g, "");
            content = content.replace(/const\s+\w+\s*=\s*useTranslations\s*\(\s*[^)]*\s*\)\s*;?\s*/g, "");
            // also remove any import { useTranslations } from "@/docs/js/translationUtils";
            content = content.replace(/import\s*{\s*useTranslations\s*}\s*from\s*['"]@\/docs\/js\/translationUtils['"]\s*;?\s*/g, "");
            // Only write if content changed
            if (content !== originalContent) {
                await writeFile(filepath, content, "utf-8");
                if (logging) {
                    console.log(`Updated ${filepath}`);
                }
            }
        }
        console.log("Removed text translations from all files");
    }
    catch (error) {
        console.error("Error processing files:", error);
        process.exit(1);
    }
}
//# sourceMappingURL=remove-text-translations.js.map