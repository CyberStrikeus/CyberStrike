import fs from "fs";
function detectPackageManager() {
    const lockFiles = {
        "package-lock.json": "npm",
        "bun.lockb": "bun",
        "yarn.lock": "yarn",
        "pnpm-lock.yaml": "pnpm",
    };
    try {
        const files = fs.readdirSync(process.cwd());
        for (const [lockFile, manager] of Object.entries(lockFiles)) {
            if (files.includes(lockFile)) {
                return manager;
            }
        }
        // Default to npm if no lock file is found
        return "npm";
    }
    catch (error) {
        console.error("Error detecting package manager:", error);
        return "npm";
    }
}
export { detectPackageManager };
//# sourceMappingURL=detect-package-manager.js.map