import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Materialize a source-owned Electron/Webpack/Rspack fixture tree. */
export const writeJavaScriptArtifactFixture = async (
  root: string,
): Promise<void> => {
  const sourceMapDirective = `${String.fromCharCode(47, 47)}# sourceMap${"ping"}URL=renderer.js.map`;
  await Promise.all([
    mkdir(join(root, "renderer", "chunks"), { recursive: true }),
    mkdir(join(root, "native"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(root, "package.json"),
      JSON.stringify(
        {
          name: "rea-javascript-fixture",
          version: "1.0.0",
          main: "main.js",
          renderer: "./renderer/index.html",
        },
        null,
        2,
      ),
    ),
    writeFile(
      join(root, "main.js"),
      `
        const { BrowserWindow } = require("electron");
        const path = require("node:path");
        const window = new BrowserWindow({
          webPreferences: { preload: path.join(__dirname, "preload.js") }
        });
        window.loadFile("./renderer/index.html");
        require("./native/addon.node");
      `,
    ),
    writeFile(
      join(root, "preload.js"),
      `
        import { contextBridge, ipcRenderer } from "electron";
        contextBridge.exposeInMainWorld("fixture", {
          lookup: (id) => ipcRenderer.invoke("fixture:lookup", id)
        });
      `,
    ),
    writeFile(
      join(root, "renderer", "index.html"),
      '<!doctype html><script type="module" src="./renderer.js"></script>',
    ),
    writeFile(
      join(root, "renderer", "renderer.js"),
      `
        import "./chunks/webpack.js";
        import "./chunks/rspack.js";
        const routes = [{ path: "/items/:id" }];
        fetch("https://api.example.test/items?token=fixture-secret");
        localStorage.setItem("theme", "dark");
        indexedDB.open("fixture-db");
        new Worker("./worker.js");
        navigator.serviceWorker.register("./sw.js");
        void routes;
        ${sourceMapDirective}
      `,
    ),
    writeFile(
      join(root, "renderer", "worker.js"),
      "self.onmessage = (event) => postMessage(event.data);\n",
    ),
    writeFile(
      join(root, "renderer", "sw.js"),
      'caches.open("fixture-cache");\n',
    ),
    writeFile(
      join(root, "renderer", "chunks", "webpack.js"),
      `
        globalThis.__rea_bundle_executed = true;
        (globalThis.webpackChunkfixture = globalThis.webpackChunkfixture || []).push([
          [101],
          {
            1: (module, exports, r) => {
              const dependency = r(2);
              exports.lookup = () => dependency;
            },
            2: (module) => { module.exports = { value: 42 }; }
          }
        ]);
        throw new Error("bundle execution must never happen");
      `,
    ),
    writeFile(
      join(root, "renderer", "chunks", "rspack.js"),
      `
        (self.rspackChunkfixture = self.rspackChunkfixture || []).push([
          ["editor"],
          {
            "src/editor.ts": (module, exports, r) => {
              exports.render = () => r("src/model.ts");
            },
            "src/model.ts": (module) => { module.exports = "model"; }
          }
        ]);
      `,
    ),
    writeFile(
      join(root, "renderer", "renderer.js.map"),
      JSON.stringify({
        version: 3,
        file: "renderer.js",
        sourceRoot: "webpack://fixture/",
        sources: ["src/renderer.ts"],
        sourcesContent: [
          'export const route = "/items/:id"; fetch("/api/items");',
        ],
        names: [],
        mappings: "AAAA",
      }),
    ),
    writeFile(
      join(root, "native", "addon.node"),
      Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
    ),
  ]);
};

/** Materialize two source-owned rechunked/minified comparison fixtures. */
export const writeVersionedJavaScriptApplicationFixtures = async (
  root: string,
): Promise<{ readonly left: string; readonly right: string }> => {
  const left = join(root, "version-1");
  const right = join(root, "version-2");
  await Promise.all([
    writeVersionFixture(left, "1.0.0", "left-bundle.js", versionOneBundle()),
    writeVersionFixture(right, "2.0.0", "right-bundle.js", versionTwoBundle()),
  ]);
  return { left, right };
};

const writeVersionFixture = async (
  root: string,
  version: string,
  bundleName: string,
  bundle: string,
): Promise<void> => {
  await mkdir(join(root, "renderer", "chunks"), { recursive: true });
  await Promise.all([
    writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "rea-version-comparison-fixture",
        version,
        main: "./main.js",
        renderer: "./renderer/index.html",
      }),
    ),
    writeFile(
      join(root, "main.js"),
      'const { ipcMain } = require("electron"); ipcMain.handle("feature:open", () => require("./native.node"));\n',
    ),
    writeFile(
      join(root, "renderer", "index.html"),
      `<!doctype html><script src="./chunks/${bundleName}"></script>`,
    ),
    writeFile(join(root, "renderer", "chunks", bundleName), bundle),
    writeFile(
      join(root, "renderer", `${bundleName}.map`),
      JSON.stringify({
        version: 3,
        file: bundleName,
        sources: ["src/feature.ts"],
        sourcesContent: [
          version === "1.0.0"
            ? 'export const feature = "before";'
            : 'export const feature = "after";',
        ],
        names: [],
        mappings: "AAAA",
      }),
    ),
    writeFile(
      join(root, "native.node"),
      Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
    ),
  ]);
};

const versionOneBundle = (): string => `
  (globalThis.webpackChunkfixture = globalThis.webpackChunkfixture || []).push([
    [101],
    {
      "stable-old": (module, exports) => { exports.stable = () => 42; },
      "descriptive-name": (module, exports) => {
        const descriptiveValue = 1;
        exports.changedName = () => descriptiveValue + 2;
      },
      "duplicate-a": (module, exports) => { exports.duplicate = () => 7; },
      "duplicate-b": (module, exports) => { exports.duplicate = () => 7; },
      "removed": (module, exports) => { exports.removed = true; }
    }
  ]);
  ${String.fromCharCode(47, 47)}# sourceMap${"ping"}URL=left-bundle.js.map
`;

const versionTwoBundle = (): string => `
  (globalThis.webpackChunkfixture = globalThis.webpackChunkfixture || []).push([
    [909],
    {
      "stable-new": (module, exports) => { exports.stable = () => 42; },
      "a": (module, exports) => {
        const b = 1;
        exports.changedName = () => b + 2;
      },
      "collision-x": (module, exports) => { exports.duplicate = () => 7; },
      "collision-y": (module, exports) => { exports.duplicate = () => 7; },
      "added": (module, exports) => { exports.added = true; }
    }
  ]);
  ${String.fromCharCode(47, 47)}# sourceMap${"ping"}URL=right-bundle.js.map
`;
