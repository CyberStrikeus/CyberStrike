/**
 * Displays a section header with equals sign borders
 */
export function logSection(title) {
    console.log("\n" + "=".repeat(title.length + 2));
    console.log(` ${title}`);
    console.log("=".repeat(title.length + 2) + "\n");
}
/**
 * Conditionally logs a message based on log options
 */
export function log(message, logOptions) {
    if (logOptions.enabled) {
        console.log(message);
    }
}
//# sourceMappingURL=logging.js.map