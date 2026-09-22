import fs from "fs";
import path from "path";
/**
 * * recursively copy a folder and its contents to another folder
 * @param from: string folder path to copy from
 * @param to: string folder path to copy to
 */
export function copyFolderSync(from, to) {
    fs.mkdirSync(to);
    fs.readdirSync(from).forEach((element) => {
        if (fs.lstatSync(path.join(from, element)).isFile()) {
            fs.copyFileSync(path.join(from, element), path.join(to, element));
        }
        else {
            copyFolderSync(path.join(from, element), path.join(to, element));
        }
    });
}
//# sourceMappingURL=copy-folder.js.map