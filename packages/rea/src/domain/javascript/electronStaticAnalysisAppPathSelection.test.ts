import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

const prefix = "const {app,BrowserWindow}=require('electron');";
const cases = [
  {
    name: "assigned native setter callee",
    body: "let change;(change=app.setAppPath)('/changed');",
    possible: true,
    calls: [1],
  },
  {
    name: "assigned local setter callee",
    body: "let change;(change=()=>{})('/changed');",
    possible: false,
    calls: [0],
  },
  {
    name: "assigned native app receiver",
    body: "let runtime;(runtime=app).setAppPath('/changed');",
    possible: true,
    calls: [1],
  },
  {
    name: "assigned local app receiver",
    body: "let runtime;(runtime={setAppPath(){}}).setAppPath('/changed');",
    possible: false,
    calls: [0],
  },
  {
    name: "logical-or assigned app receiver",
    body: "let runtime=flag?{setAppPath(){}}:null;(runtime||=app).setAppPath('/changed');",
    possible: true,
    calls: [1, 0],
  },
  {
    name: "logical-and assigned app receiver",
    body: "let runtime=flag?app:null;(runtime&&=app)?.setAppPath('/changed');",
    possible: true,
    calls: [0, 1],
  },
  {
    name: "nullish assigned app receiver",
    body: "let runtime=flag?{setAppPath(){}}:null;(runtime??=app).setAppPath('/changed');",
    possible: true,
    calls: [1, 0],
  },
  {
    name: "definite local setter replacement",
    body: "app.setAppPath=()=>{};app.setAppPath('/changed');",
    possible: false,
    calls: [0],
  },
  {
    name: "unchanged native setter",
    body: "app.setAppPath('/changed');",
    possible: true,
    calls: [1],
  },
  {
    name: "conditional setter replacement",
    body: "if(flag)app.setAppPath=()=>{};app.setAppPath('/changed');",
    possible: true,
    calls: [1, 0],
  },
  {
    name: "setter captured before replacement",
    body: "const change=app.setAppPath;app.setAppPath=()=>{};change('/changed');",
    possible: true,
    calls: [1],
  },
  {
    name: "setter captured after replacement",
    body: "app.setAppPath=()=>{};const change=app.setAppPath;change('/changed');",
    possible: false,
    calls: [0],
  },
  {
    name: "setter invoked before replacement",
    body: "app.setAppPath('/changed');app.setAppPath=()=>{};",
    possible: true,
    calls: [1],
  },
];

it.each(cases)(
  "selects the app-path callable for $name",
  ({ body, possible, calls }) => {
    const source = `${prefix}${body}new BrowserWindow().loadFile('index.html');`;
    for (const [index, expected] of calls.entries()) {
      let changed = 0;
      const rendered: string[] = [];
      // Record JavaScript member/capture behavior without executing Electron.
      runInNewContext(source, {
        flag: index === 1,
        require: () => ({
          app: {
            setAppPath() {
              changed += 1;
            },
          },
          BrowserWindow: class {
            loadFile(file: string) {
              rendered.push(file);
            }
          },
        }),
      });
      expect(changed).toBe(expected);
      expect(rendered).toEqual(["index.html"]);
    }
    const analysis = analyzeJavaScriptStaticSource(source);
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.electron.app_path_changes ?? []).toEqual(
      possible
        ? [
            expect.objectContaining({
              module_key: null,
              location: expect.any(Object),
            }),
          ]
        : [],
    );
  },
);
