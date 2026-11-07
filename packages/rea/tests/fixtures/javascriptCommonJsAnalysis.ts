import { analyzeParsedJavaScriptSemantics } from "../../src/domain/javascript/javascriptSemanticAnalysis.js";
import { analyzeParsedJavaScriptStaticSource } from "../../src/domain/javascript/javascriptStaticAnalysis.js";
import { parseJavaScriptSource } from "../../src/domain/javascript/javascriptSourceParser.js";

// These fixtures model CommonJS TypeScript assets. The filename establishes
// wrapper authority while retaining type syntax and inert module declarations.
const parseCommonJsFixture = (source: string) => {
  const parsed = parseJavaScriptSource(source, "fixture.cts");
  if (parsed === null) throw new Error("CommonJS fixture could not be parsed");
  return parsed;
};

export const analyzeCommonJsStaticFixture = (source: string) =>
  analyzeParsedJavaScriptStaticSource(source, parseCommonJsFixture(source));

export const analyzeCommonJsSemanticFixture = (source: string) =>
  analyzeParsedJavaScriptSemantics(parseCommonJsFixture(source));
