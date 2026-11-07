import { expect, it } from "vitest";
import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it.each([
  'class Database { constructor(name) { this.name = name; } } new Database("hello");',
  'const Database = class {}; new Database("hello");',
  'function Database(name) { return {name}; } new Database("hello");',
  'class Local {} const Database = Local; new Database("hello");',
])("omits a proven local constructor: %s", (source) => {
  expect(analyzeJavaScriptStaticSource(source).storage).toEqual([]);
});

it.each([
  'new Database("shared");',
  'import type Database = require("better-sqlite3"); new Database("shared");',
  'let Database = require("better-sqlite3"); eval("Database = Other"); new Database("shared");',
  'import * as sqlite from "sqlite3"; const alias = sqlite; alias.Database = Other; new sqlite.Database("shared");',
  'import Database from "better-sqlite3"; expose(Database); new Database("shared");',
  'import type TypeDatabase from "better-sqlite3"; const Database = TypeDatabase; new Database("shared");',
  'import * as Database from "better-sqlite3"; new Database("shared");',
  'const Database = require("better-sqlite3").default; new Database("shared");',
  'const sqlite = require("sqlite3").default; new sqlite.Database("shared");',
  'import type Database from "better-sqlite3"; new Database("shared");',
  'import * as sqlite from "sqlite3"; new sqlite.default.default.Database("shared");',
  'function run(Database) { return new Database("shared"); }',
  'import Database from "unknown-library"; new Database("shared");',
  'import Database from "better-sqlite3"; Database = Other; new Database("shared");',
  'import * as sqlite from "sqlite3"; sqlite.Database = Other; new sqlite.Database("shared");',
])("retains uncertain SQLite names as candidates: %s", (source) => {
  expect(analyzeJavaScriptStaticSource(source).storage).toMatchObject([
    { kind: "sqlite", name: "shared", interpretation: "candidate" },
  ]);
});

it.each([
  'import Database from "better-sqlite3"; new Database("known.db");',
  'import Database = require("better-sqlite3"); new Database("known.db");',
  'import sqlite = require("sqlite3"); new sqlite.Database("known.db");',
  'const Database = require("better-sqlite3"); new Database("known.db");',
  'import {Database} from "sqlite3"; new Database("known.db");',
  'import * as sqlite from "sqlite3"; new sqlite.Database("known.db");',
])("retains proven SQLite API origins: %s", (source) => {
  const analysis = analyzeJavaScriptStaticSource(source);
  expect(analysis.storage).toHaveLength(1);
  expect(analysis.storage[0]).toMatchObject({
    kind: "sqlite",
    name: "known.db",
  });
  expect(analysis.storage[0]).not.toHaveProperty("interpretation");
});
