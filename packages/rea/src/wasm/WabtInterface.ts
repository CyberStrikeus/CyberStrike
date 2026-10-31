import { WabtAdmissionError } from "./WabtAdmissionError.js";
import { AnalysisResourceConstraintError } from "../domain/analysisErrorCore.js";
import { wasmInterfaceEntryRepresentationBytes } from "../domain/wasm/wasmInterface.js";
import { WasmInterfaceBudget } from "./WasmInterfaceBudget.js";
import type {
  WasmInterface,
  WasmInterfaceEntry,
  WasmInterfaceSignature,
  WasmInterfaceValueType,
} from "../domain/wasm/wasmInterface.js";
import { watString, watStringEnd } from "./WabtString.js";
import { watCommentEnd } from "./WabtComment.js";

/** Split direct WAT children only; function instruction bodies are never materialized. */
const parts = (form: string): string[] => {
  const budget = new WasmInterfaceBudget();
  const items: string[] = [];
  let i = 1;
  while (i < form.length - 1) {
    if (/\s/u.test(form[i] ?? "")) {
      i++;
      continue;
    }
    const commentEnd = watCommentEnd(form, i);
    if (commentEnd !== undefined) {
      i = commentEnd;
      continue;
    }
    const start = i;
    if (form[i] === '"') {
      i = watStringEnd(form, i + 1);
    } else if (form[i] === "(") {
      let depth = 1;
      i++;
      while (i < form.length && depth > 0) {
        const commentEnd = watCommentEnd(form, i);
        if (commentEnd !== undefined) i = commentEnd;
        else if (form[i] === '"') i = watStringEnd(form, i + 1);
        else {
          if (form[i] === "(") depth++;
          else if (form[i] === ")") depth--;
          i++;
        }
      }
    } else {
      while (i < form.length && !/[\s()]/u.test(form[i] ?? "")) i++;
      const atom = form.slice(start, i);
      if (items[0] === "func" && items.length > 1 && !atom.startsWith("$"))
        break;
    }
    if (i <= start) throw new WabtAdmissionError("malformed_form");
    budget.reserve(64 + (i - start) * 2);
    items.push(form.slice(start, i));
  }
  return items;
};
const head = (form: string): string | undefined => parts(form)[0];
const admittedValues = new Set([
  "i32",
  "i64",
  "f32",
  "f64",
  "v128",
  "funcref",
  "externref",
]);
const isValueType = (type: string): type is WasmInterfaceValueType =>
  admittedValues.has(type);
const values = (
  form: string,
  category: string,
): WasmInterfaceValueType[] | null => {
  const result: WasmInterfaceValueType[] = [];
  for (const item of parts(form)) {
    if (!item.startsWith("(")) continue;
    const group = parts(item);
    if (group[0] !== category) continue;
    for (const type of group.slice(1).filter((t) => !t.startsWith("$"))) {
      if (!isValueType(type)) return null;
      result.push(type);
    }
  }
  return result;
};
const functionType = (
  form: string,
  kind: "func" | "tag",
): WasmInterfaceSignature | null => {
  const params = values(form, "param");
  const results = values(form, "result");
  return params === null || results === null ? null : { kind, params, results };
};
const name = (text: string | undefined): string => {
  if (text?.startsWith('"') !== true)
    throw new WabtAdmissionError("name_missing");
  return new TextDecoder("utf8", { fatal: true, ignoreBOM: true }).decode(
    watString(text, 1).bytes,
  );
};
const integer = (text: string): string | null => {
  if (!/^(?:\d+|0x[\da-f]+)$/iu.test(text)) return null;
  return BigInt(text).toString();
};

/** Resolve index spaces at the producer, not from retained raw WAT in consumers. */
const decodeWabtInterface = (
  forms: readonly string[],
  result: WasmInterface,
): WasmInterface => {
  const budget = new WasmInterfaceBudget();
  const types: (WasmInterfaceSignature | null)[] = [];
  const typeNames = new Map<string, number | null>();
  const definitionNames = new Map<string, Map<string, number | null>>();
  const indexLabel = (
    labels: Map<string, number | null>,
    label: string,
    index: number,
    space: string,
  ) => {
    const issue = `Ambiguous WABT identifiers in the ${space} index space; named references have unknown identity`;
    if (labels.has(label) && !result.issues.includes(issue))
      result.issues.push(issue);
    labels.set(label, labels.has(label) ? null : index);
  };
  const definitions = new Map<
    string,
    { signature: WasmInterfaceSignature | null }[]
  >();
  const typeSpaceUnknown = forms.some((f) => head(f) === "rec");
  for (const form of forms) {
    const p = parts(form);
    if (p[0] !== "type") continue;
    if (p[1]?.startsWith("$") === true)
      indexLabel(typeNames, p[1], types.length, "type");
    const body = p.find((item) => item.startsWith("("));
    budget.reserve(256 + (body?.length ?? 0) * 6);
    types.push(
      body !== undefined && head(body) === "func" && !typeSpaceUnknown
        ? functionType(body, "func")
        : null,
    );
  }
  const signature = (form: string): WasmInterfaceSignature | null => {
    const p = parts(form);
    const kind = p[0];
    if (kind === "func" || kind === "tag") {
      // Interpret group heads through the same comment/whitespace framing as
      // their values; raw prefixes can mistake an explicit type for no type.
      const use = p.find((t) => t.startsWith("(") && head(t) === "type");
      if (use === undefined) return functionType(form, kind);
      const reference = parts(use)[1];
      const index =
        reference === undefined
          ? undefined
          : reference.startsWith("$")
            ? typeNames.get(reference)
            : Number(reference);
      const type = index == null || typeSpaceUnknown ? undefined : types[index];
      return type?.kind === "func" ? { ...type, kind } : null;
    }
    if (kind === "memory" || kind === "table") {
      const groups = p.slice(1).filter((t) => t.startsWith("("));
      let pageSize = "65536";
      for (const group of groups) {
        const declaration = parts(group);
        if (
          kind !== "memory" ||
          declaration[0] !== "pagesize" ||
          declaration.length !== 2
        )
          return null;
        const parsedPageSize = integer(declaration[1] ?? "");
        if (parsedPageSize === null) return null;
        pageSize = parsedPageSize;
      }
      const tokens = p
        .slice(1)
        .filter((t) => !t.startsWith("$") && !t.startsWith("("));
      const address_type = tokens[0] === "i64" ? "i64" : "i32";
      if (tokens[0] === "i64" || tokens[0] === "i32") tokens.shift();
      const minimum = integer(tokens.shift() ?? "");
      const possibleMaximum =
        tokens[0] === undefined ? null : integer(tokens[0]);
      if (possibleMaximum !== null) tokens.shift();
      const shared = tokens[0] === "shared";
      if (shared) tokens.shift();
      if (minimum === null) return null;
      if (kind === "memory")
        return tokens.length === 0
          ? {
              kind,
              page_size: pageSize,
              address_type,
              minimum,
              maximum: possibleMaximum,
              shared,
            }
          : null;
      const element = tokens.shift();
      return tokens.length === 0 &&
        element !== undefined &&
        (element === "funcref" || element === "externref")
        ? {
            kind,
            address_type,
            minimum,
            maximum: possibleMaximum,
            shared,
            element,
          }
        : null;
    }
    if (kind === "global") {
      const declaration = p[1]?.startsWith("$") === true ? p[2] : p[1];
      const group =
        declaration?.startsWith("(") === true ? parts(declaration) : undefined;
      const mutable = group?.[0] === "mut";
      const value_type = mutable ? group?.[1] : declaration;
      return value_type !== undefined && isValueType(value_type)
        ? { kind, value_type, mutable }
        : null;
    }
    return null;
  };
  const addDefinition = (
    form: string,
  ): {
    index: number;
    kind: WasmInterfaceEntry["kind"];
    signature: WasmInterfaceSignature | null;
  } => {
    const p = parts(form);
    const rawKind = p[0] ?? "unknown";
    const kind = ["func", "table", "memory", "global", "tag"].includes(rawKind)
      ? (rawKind as WasmInterfaceEntry["kind"])
      : "unknown";
    const space = definitions.get(kind) ?? [];
    const item = { signature: signature(form) };
    const label = p[1]?.startsWith("$") === true ? p[1] : undefined;
    budget.reserve(256);
    const index = space.length;
    space.push(item);
    definitions.set(kind, space);
    if (label !== undefined) {
      const labels =
        definitionNames.get(kind) ?? new Map<string, number | null>();
      indexLabel(labels, label, index, kind);
      definitionNames.set(kind, labels);
    }
    return { index, kind, signature: item.signature };
  };
  for (const form of forms) {
    const p = parts(form);
    if (p[0] !== "import") continue;
    const body = p[3];
    if (body === undefined) throw new WabtAdmissionError("incomplete_import");
    const observed = addDefinition(body);
    const entry: WasmInterfaceEntry = {
      direction: "import",
      module: name(p[1]),
      name: name(p[2]),
      ...observed,
      wat_form: form,
      issue:
        observed.signature === null
          ? "Import type is outside admitted core signature semantics"
          : null,
    };
    budget.reserve(wasmInterfaceEntryRepresentationBytes(entry));
    result.entries.push(entry);
  }
  for (const form of forms) {
    const kind = head(form);
    if (
      kind !== undefined &&
      ["func", "table", "memory", "global", "tag"].includes(kind)
    )
      addDefinition(form);
  }
  for (const form of forms) {
    const p = parts(form);
    if (p[0] !== "export") continue;
    const body = p[2];
    if (body === undefined) throw new WabtAdmissionError("incomplete_export");
    const descriptor = parts(body);
    const rawKind = descriptor[0] ?? "unknown";
    const kind = ["func", "table", "memory", "global", "tag"].includes(rawKind)
      ? (rawKind as WasmInterfaceEntry["kind"])
      : "unknown";
    const reference = descriptor[1];
    const space = definitions.get(kind) ?? [];
    const index =
      reference === undefined
        ? -1
        : reference.startsWith("$")
          ? (definitionNames.get(kind)?.get(reference) ?? -1)
          : Number(reference);
    const observed =
      Number.isSafeInteger(index) && index >= 0 ? space[index] : undefined;
    const entry: WasmInterfaceEntry = {
      direction: "export",
      module: null,
      name: name(p[1]),
      kind,
      index: observed === undefined ? null : index,
      signature: observed?.signature ?? null,
      wat_form: form,
      issue:
        observed?.signature == null
          ? "Export type/index is outside admitted core signature semantics"
          : null,
    };
    budget.reserve(wasmInterfaceEntryRepresentationBytes(entry));
    result.entries.push(entry);
  }
  // Unsupported signatures leave inventory completeness intact. A missing
  // signature is unknown per entry, not proof that a name is absent.
  return result;
};

/** New typed coverage may be incomplete without discarding existing decoded WAT Evidence. */
export const parseWabtInterface = (forms: readonly string[]): WasmInterface => {
  const result: WasmInterface = { state: "complete", entries: [], issues: [] };
  try {
    return decodeWabtInterface(forms, result);
  } catch (cause: unknown) {
    if (!(cause instanceof AnalysisResourceConstraintError)) throw cause;
    result.state = "partial";
    result.issues.push(cause.message);
    return result;
  }
};
