import { readdir } from "fs/promises";
import { resolve, extname } from "path";
const ALLOWED_EXTENSIONS = [".astro", ".mdx", ".md", ".tsx", ".ts", ".js", ".mjs", ".cjs"];
// Collect files with specific extensions
async function collectFiles(files, dir) {
    const dirents = await readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
        const res = resolve(dir, dirent.name);
        if (dirent.isDirectory() && dirent.name !== "js") {
            await collectFiles(files, res);
        }
        else if (dirent.isFile() &&
            ALLOWED_EXTENSIONS.includes(extname(res))) {
            files.push(res);
        }
    }
}
export { collectFiles };
//# sourceMappingURL=collect-files.js.map