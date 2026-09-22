import fs from "fs";
import { join } from "path";
/**
 * * search through files in passed folder (including subdirectories) and replace text
 * @param path: string folder path to search through
 * @param regex: regex string to match
 * @param replacement: replacement text to replace each regex match with
 */
export function replaceInFiles(path, regex, replacement, logging = false) {
    const entries = fs.readdirSync(path, { withFileTypes: true });
    for (const entry of entries) {
        const filePath = join(path, entry.name);
        if (entry.isDirectory()) {
            // Recursively process subdirectories
            replaceInFiles(filePath, regex, replacement);
        }
        else {
            try {
                // Read file content
                const content = fs.readFileSync(filePath, "utf-8");
                // Create regex object from string
                const searchRegex = new RegExp(regex, "g");
                // Replace matches
                const updatedContent = content.replace(searchRegex, replacement);
                // Only write if content changed
                if (content !== updatedContent) {
                    fs.writeFileSync(filePath, updatedContent, "utf-8");
                    if (logging) {
                        console.log(`Updated ${filePath}`);
                    }
                }
            }
            catch (error) {
                console.error(`Error processing file ${filePath}:`, error);
            }
        }
    }
}
//# sourceMappingURL=replace-in-files.js.map