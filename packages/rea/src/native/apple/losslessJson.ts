/** JSON container type a projection declined to materialize. */
export type JsonContainerType = "array" | "object";

/** A JSON value that keeps integer literals as decimal text. */
export type LosslessJson =
  | { readonly kind: "null" }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "integer"; readonly decimal: string }
  | { readonly kind: "number"; readonly recorded: string }
  | { readonly kind: "array"; readonly items: readonly LosslessJson[] }
  | {
      readonly kind: "object";
      readonly members: Readonly<Record<string, LosslessJson>>;
      /** Names of members the projection did not select, in source order. */
      readonly unlisted: readonly string[];
    }
  /** A container whose type did not match the projection; syntax was checked, content was not kept. */
  | { readonly kind: "omitted"; readonly type: JsonContainerType };

/**
 * Projection that selects which parts of a JSON value are materialized.
 *
 * Values outside the projection are syntax-checked without being retained, so
 * callers can bound allocation by the facts they actually consume. Budget
 * callbacks run before the corresponding item is parsed and may throw.
 */
export type JsonShape =
  | { readonly kind: "any" }
  | { readonly kind: "scalar" }
  | {
      readonly kind: "array";
      readonly items: JsonShape;
      readonly beforeItem?: () => void;
    }
  | {
      readonly kind: "object";
      readonly members: Readonly<Record<string, JsonShape>>;
      /** Shape for members not listed in `members`; absent means they are skipped. */
      readonly rest?: JsonShape;
      readonly beforeRest?: () => void;
      /** When present, names of skipped members are kept; called with the new count first. */
      readonly beforeUnlisted?: (count: number) => void;
    };

/** JSON text could not be parsed as a single complete value. */
export class LosslessJsonFailure extends Error {
  constructor(
    message: string,
    readonly reason: "syntax" | "depth" = "syntax",
    readonly maximum: number | null = null,
  ) {
    super(message);
    this.name = "LosslessJsonFailure";
  }
}

const ANY: JsonShape = { kind: "any" };
const OMITTED_ARRAY: LosslessJson = Object.freeze({
  kind: "omitted",
  type: "array",
});
const OMITTED_OBJECT: LosslessJson = Object.freeze({
  kind: "omitted",
  type: "object",
});
const DEFAULT_MAX_DEPTH = 512;

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const isDigit = (code: number): boolean => code >= 48 && code <= 57;

/** Parse one JSON value, preserving integer literals that exceed IEEE-754 range. */
export const parseLosslessJson = (
  text: string,
  start = 0,
  shape: JsonShape = ANY,
  options: { readonly maxDepth?: number } = {},
): { readonly value: LosslessJson; readonly end: number } => {
  const parser = new Parser(text, start, options.maxDepth ?? DEFAULT_MAX_DEPTH);
  const value = parser.parseValue(shape, 0);
  return { value, end: parser.position };
};

class Parser {
  position: number;

  constructor(
    readonly text: string,
    start: number,
    readonly maxDepth: number,
  ) {
    this.position = start;
  }

  parseValue(shape: JsonShape, depth: number): LosslessJson {
    this.skipWhitespace();
    const ch = this.text[this.position];
    if (ch === "{") {
      if (shape.kind === "object" || shape.kind === "any")
        return this.parseObject(shape, depth + 1);
      this.skipValue(depth);
      return OMITTED_OBJECT;
    }
    if (ch === "[") {
      if (shape.kind === "array" || shape.kind === "any")
        return this.parseArray(shape, depth + 1);
      this.skipValue(depth);
      return OMITTED_ARRAY;
    }
    return this.parseScalar();
  }

  private enter(depth: number): void {
    if (depth > this.maxDepth)
      throw new LosslessJsonFailure(
        `JSON nesting exceeds ${String(this.maxDepth)} levels at offset ${String(this.position)}`,
        "depth",
        this.maxDepth,
      );
  }

  private parseScalar(): LosslessJson {
    const ch = this.text[this.position];
    if (ch === undefined)
      throw new LosslessJsonFailure("Unexpected end of JSON input");
    if (ch === '"') return { kind: "string", value: this.parseString() };
    if (ch === "t")
      return this.literal("true", { kind: "boolean", value: true });
    if (ch === "f")
      return this.literal("false", { kind: "boolean", value: false });
    if (ch === "n") return this.literal("null", { kind: "null" });
    if (ch === "-" || isDigit(ch.charCodeAt(0))) {
      const start = this.position;
      const fractional = this.scanNumber();
      const recorded = this.text.slice(start, this.position);
      return fractional
        ? { kind: "number", recorded }
        : { kind: "integer", decimal: recorded };
    }
    throw new LosslessJsonFailure(
      `Unexpected ${JSON.stringify(ch)} at JSON offset ${String(this.position)}`,
    );
  }

  private parseObject(
    shape: Extract<JsonShape, { kind: "object" | "any" }>,
    depth: number,
  ): LosslessJson {
    this.enter(depth);
    this.position += 1;
    const members: Record<string, LosslessJson> = Object.create(null) as Record<
      string,
      LosslessJson
    >;
    const unlisted: string[] = [];
    const unlistedSeen = new Set<string>();
    this.skipWhitespace();
    if (this.text[this.position] === "}") {
      this.position += 1;
      return { kind: "object", members, unlisted };
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.position] !== '"')
        throw new LosslessJsonFailure(
          `Expected a JSON object key at offset ${String(this.position)}`,
        );
      const key = this.parseString();
      this.skipWhitespace();
      this.expect(":");
      const listed = shape.kind === "any" || Object.hasOwn(shape.members, key);
      const memberShape =
        shape.kind === "any" ? ANY : listed ? shape.members[key] : shape.rest;
      if (memberShape === undefined) {
        if (shape.kind === "object" && shape.beforeUnlisted !== undefined) {
          if (unlistedSeen.has(key))
            throw new LosslessJsonFailure(
              `Duplicate JSON object key ${JSON.stringify(key)}`,
            );
          shape.beforeUnlisted(unlisted.length + 1);
          unlistedSeen.add(key);
          unlisted.push(key);
        }
        this.skipValue(depth);
      } else {
        if (Object.hasOwn(members, key))
          throw new LosslessJsonFailure(
            `Duplicate JSON object key ${JSON.stringify(key)}`,
          );
        if (!listed && shape.kind === "object") shape.beforeRest?.();
        members[key] = this.parseValue(memberShape, depth);
      }
      this.skipWhitespace();
      const next = this.text[this.position];
      if (next === "}") {
        this.position += 1;
        return { kind: "object", members, unlisted };
      }
      if (next !== ",")
        throw new LosslessJsonFailure(
          `Expected ',' or '}' in JSON object at offset ${String(this.position)}`,
        );
      this.position += 1;
    }
  }

  private parseArray(
    shape: Extract<JsonShape, { kind: "array" | "any" }>,
    depth: number,
  ): LosslessJson {
    this.enter(depth);
    this.position += 1;
    const items: LosslessJson[] = [];
    const itemShape = shape.kind === "any" ? ANY : shape.items;
    const beforeItem = shape.kind === "array" ? shape.beforeItem : undefined;
    this.skipWhitespace();
    if (this.text[this.position] === "]") {
      this.position += 1;
      return { kind: "array", items };
    }
    for (;;) {
      beforeItem?.();
      items.push(this.parseValue(itemShape, depth));
      this.skipWhitespace();
      const next = this.text[this.position];
      if (next === "]") {
        this.position += 1;
        return { kind: "array", items };
      }
      if (next !== ",")
        throw new LosslessJsonFailure(
          `Expected ',' or ']' in JSON array at offset ${String(this.position)}`,
        );
      this.position += 1;
    }
  }

  /** Validate one value's syntax without retaining it. */
  private skipValue(depth: number): void {
    this.skipWhitespace();
    const ch = this.text[this.position];
    if (ch === "{") {
      this.enter(depth + 1);
      this.position += 1;
      this.skipWhitespace();
      if (this.text[this.position] === "}") {
        this.position += 1;
        return;
      }
      for (;;) {
        this.skipWhitespace();
        if (this.text[this.position] !== '"')
          throw new LosslessJsonFailure(
            `Expected a JSON object key at offset ${String(this.position)}`,
          );
        this.parseString();
        this.skipWhitespace();
        this.expect(":");
        this.skipValue(depth + 1);
        this.skipWhitespace();
        const next = this.text[this.position];
        if (next === "}") {
          this.position += 1;
          return;
        }
        if (next !== ",")
          throw new LosslessJsonFailure(
            `Expected ',' or '}' in JSON object at offset ${String(this.position)}`,
          );
        this.position += 1;
      }
    }
    if (ch === "[") {
      this.enter(depth + 1);
      this.position += 1;
      this.skipWhitespace();
      if (this.text[this.position] === "]") {
        this.position += 1;
        return;
      }
      for (;;) {
        this.skipValue(depth + 1);
        this.skipWhitespace();
        const next = this.text[this.position];
        if (next === "]") {
          this.position += 1;
          return;
        }
        if (next !== ",")
          throw new LosslessJsonFailure(
            `Expected ',' or ']' in JSON array at offset ${String(this.position)}`,
          );
        this.position += 1;
      }
    }
    if (ch === '"') {
      this.parseString();
      return;
    }
    if (ch === "-" || (ch !== undefined && isDigit(ch.charCodeAt(0)))) {
      this.scanNumber();
      return;
    }
    this.parseScalar();
  }

  /** Validate once, then let V8 decode escapes without a per-escape fragment array. */
  private parseString(): string {
    const start = this.position;
    const escaped = this.skipString();
    const decoded: unknown = escaped
      ? // A decoded JSON string cannot contain more code units than its literal.
        // The input's byte allowance bounds this allocation, including dense escapes.
        JSON.parse(this.text.slice(start, this.position))
      : this.text.slice(start + 1, this.position - 1);
    if (typeof decoded !== "string")
      throw new LosslessJsonFailure("Expected a JSON string");
    return this.requirePairedSurrogates(decoded);
  }

  /**
   * JSON admits \uXXXX escapes for unpaired surrogates, but the decoded text is
   * not valid Unicode. Evidence carrying one would report malformed text as
   * complete, so the parser refuses the string like any other malformed input.
   * A high surrogate followed by its low surrogate escape stays valid text.
   */
  private requirePairedSurrogates(value: string): string {
    for (let index = 0; index < value.length; index += 1) {
      const unit = value.charCodeAt(index);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = index + 1 < value.length ? value.charCodeAt(index + 1) : 0;
        if (next < 0xdc00 || next > 0xdfff)
          throw new LosslessJsonFailure(
            "JSON string contains an unpaired surrogate",
          );
        index += 1;
        continue;
      }
      if (unit >= 0xdc00 && unit <= 0xdfff)
        throw new LosslessJsonFailure(
          "JSON string contains an unpaired surrogate",
        );
    }
    return value;
  }

  private skipString(): boolean {
    const text = this.text;
    let escaped = false;
    this.position += 1;
    while (this.position < text.length) {
      const code = text.charCodeAt(this.position);
      if (code === QUOTE) {
        this.position += 1;
        return escaped;
      }
      if (code === BACKSLASH) {
        escaped = true;
        this.position += 1;
        this.escape();
        continue;
      }
      if (code < 0x20)
        throw new LosslessJsonFailure(
          "Unescaped control character in JSON string",
        );
      this.position += 1;
    }
    throw new LosslessJsonFailure("Unterminated JSON string");
  }

  private escape(): string {
    const ch = this.text[this.position];
    this.position += 1;
    switch (ch) {
      case '"':
      case "\\":
      case "/":
        return ch;
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "u": {
        const hex = this.text.slice(this.position, this.position + 4);
        if (!/^[0-9a-fA-F]{4}$/u.test(hex))
          throw new LosslessJsonFailure("Invalid JSON Unicode escape");
        this.position += 4;
        return String.fromCharCode(Number.parseInt(hex, 16));
      }
      default:
        throw new LosslessJsonFailure("Invalid JSON string escape");
    }
  }

  /** Advance over one number; returns whether it has a fraction or exponent. */
  private scanNumber(): boolean {
    if (this.text[this.position] === "-") this.position += 1;
    if (this.text[this.position] === "0") this.position += 1;
    else {
      if (!isDigit(this.text.charCodeAt(this.position)))
        throw new LosslessJsonFailure("Invalid JSON number");
      while (isDigit(this.text.charCodeAt(this.position))) this.position += 1;
    }
    let fractional = false;
    if (this.text[this.position] === ".") {
      fractional = true;
      this.position += 1;
      if (!isDigit(this.text.charCodeAt(this.position)))
        throw new LosslessJsonFailure("Invalid JSON number fraction");
      while (isDigit(this.text.charCodeAt(this.position))) this.position += 1;
    }
    if (this.text[this.position] === "e" || this.text[this.position] === "E") {
      fractional = true;
      this.position += 1;
      if (this.text[this.position] === "+" || this.text[this.position] === "-")
        this.position += 1;
      if (!isDigit(this.text.charCodeAt(this.position)))
        throw new LosslessJsonFailure("Invalid JSON number exponent");
      while (isDigit(this.text.charCodeAt(this.position))) this.position += 1;
    }
    return fractional;
  }

  private literal<T extends LosslessJson>(token: string, value: T): T {
    if (!this.text.startsWith(token, this.position))
      throw new LosslessJsonFailure(`Expected ${token} in JSON`);
    this.position += token.length;
    return value;
  }

  private expect(token: string): void {
    if (!this.text.startsWith(token, this.position))
      throw new LosslessJsonFailure(
        `Expected ${JSON.stringify(token)} at JSON offset ${String(this.position)}`,
      );
    this.position += token.length;
  }

  private skipWhitespace(): void {
    while (this.position < this.text.length) {
      const ch = this.text[this.position];
      if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") return;
      this.position += 1;
    }
  }
}
