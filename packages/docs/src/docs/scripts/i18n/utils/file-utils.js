import * as fs from "node:fs/promises";
import * as fssync from "node:fs";
import { log } from "./logging.js";
/**
 * Reads a file with fallback content if the file doesn't exist
 */
export async function readFileWithFallback(filePath, defaultContent = "") {
    try {
        return await fs.readFile(filePath, "utf-8");
    }
    catch (error) {
        console.warn(`Warning: Could not read ${filePath}. Using default content.`);
        return defaultContent;
    }
}
/**
 * Safely writes content to a file path
 */
export async function writeFile(filePath, content, logOptions, consoleLog = true) {
    try {
        await fs.writeFile(filePath, content, "utf-8");
        log(`Successfully updated ${filePath}`, logOptions);
        if (consoleLog) {
            console.log(`Updated ${filePath}`);
        }
    }
    catch (error) {
        console.error(`Error writing to ${filePath}: ${error.message}`);
    }
}
/**
 * Checks if a file or directory exists
 */
export function pathExists(path) {
    return fssync.existsSync(path);
}
/**
 * Recursively deletes a directory if it exists
 */
export function deleteDirectoryIfExists(dirPath, logOptions) {
    if (!pathExists(dirPath))
        return;
    try {
        fssync.rmSync(dirPath, { recursive: true });
        log(`Deleted directory: ${dirPath}`, logOptions);
    }
    catch (error) {
        console.error(`Error deleting directory ${dirPath}: ${error.message}`);
    }
}
//# sourceMappingURL=file-utils.js.map