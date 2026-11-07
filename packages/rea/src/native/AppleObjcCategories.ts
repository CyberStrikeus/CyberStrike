import type { ObjcSwiftMetadata } from "../domain/native/objcSwiftMetadata.js";
import type { Section } from "./AppleMachoSelection.js";
import type { ObjcDispatchReaders } from "./AppleObjcDispatchFacets.js";
import { readObjcPropertiesOf } from "./AppleObjcProperties.js";
import { issue, type DecodeIssue } from "./AppleDispatchDecodeFacts.js";
import { BinaryFormatFailure } from "./metadata/BinaryContainer.js";

const CLASS_SYMBOL = /^_OBJC_(?:META)?CLASS_\$_(.+)$/u;

/** External class name from a bound `_OBJC_CLASS_$_Name` symbol. */
export const boundClassName = (
  read: Pick<ObjcDispatchReaders, "bound">,
  field: bigint,
): string | undefined => {
  const bound = read.bound(field);
  return bound === undefined ? undefined : CLASS_SYMBOL.exec(bound.symbol)?.[1];
};

/**
 * Why a category's class reference names no class: it is null, or bound to a
 * symbol other than `_OBJC_CLASS_$_`, such as the `_$s…CN` metadata symbol
 * of a Swift class in another module.
 */
const unnamedClassReference = (
  read: Pick<ObjcDispatchReaders, "bound">,
  field: bigint,
  category: string,
): string => {
  const bound = read.bound(field);
  return bound === undefined
    ? `Category ${category} class reference is null`
    : `Category ${category} class reference is bound to ${bound.symbol}, which is not read as an Objective-C class name`;
};

/**
 * Decode `__objc_catlist` `category_t` records:
 * name, cls, instanceMethods, classMethods, protocols, instanceProperties.
 */
export const decodeObjcCategories = (input: {
  readonly sections: readonly Section[];
  readonly read: ObjcDispatchReaders;
  readonly result: ObjcSwiftMetadata;
  readonly issues: DecodeIssue[];
  readonly admit: () => boolean;
  /** Decode a method list into implementations attributed to the category. */
  readonly methods: (
    list: bigint,
    className: string,
    methodType: "instance" | "class",
    category: string,
    onTruncated?: () => void,
  ) => string[];
  readonly protocols: (list: bigint, onTruncated?: () => void) => string[];
  /** Name of a class defined in this image, from its class_ro_t. */
  readonly localClassName: (address: bigint) => string;
}): number => {
  const { read, result } = input;
  let examined = 0;
  for (const section of input.sections.filter(
    ({ name }) => name === "__objc_catlist",
  )) {
    if (section.size % 8 !== 0)
      throw new BinaryFormatFailure(
        "malformed",
        "Misaligned Objective-C category list",
      );
    for (let index = 0; index < section.size / 8; index++) {
      if (!input.admit()) break;
      examined++;
      const field = section.address + BigInt(index * 8);
      try {
        const category = read.pointer(field);
        const name = read.string(read.pointer(category));
        if (name.length === 0)
          throw new TypeError("Objective-C category has an empty name");
        const external = boundClassName(read, category + 8n);
        const local = read.pointer(category + 8n);
        let className = external ?? null;
        if (external === undefined && local !== 0n)
          try {
            className = input.localClassName(local);
          } catch (cause: unknown) {
            // The category's own name and methods do not depend on its owner;
            // keep them and report the unreadable class reference.
            input.issues.push(
              issue(
                "objc_properties_categories",
                "category_class_unresolved",
                `Category ${name} class reference 0x${local.toString(16)}: ${cause instanceof Error ? cause.message : String(cause)}`,
                `0x${(category + 8n).toString(16)}`,
              ),
            );
          }
        else if (external === undefined)
          input.issues.push(
            issue(
              "objc_properties_categories",
              "category_class_unresolved",
              unnamedClassReference(read, category + 8n, name),
              `0x${(category + 8n).toString(16)}`,
            ),
          );
        const owner = className ?? `(${name})`;
        let budgetTruncated = false;
        const onTruncated = () => {
          budgetTruncated = true;
        };
        const instanceMethods = input.methods(
          read.pointer(category + 16n),
          owner,
          "instance",
          name,
          onTruncated,
        );
        const classMethods = input.methods(
          read.pointer(category + 24n),
          owner,
          "class",
          name,
          onTruncated,
        );
        const protocols = input.protocols(
          read.pointer(category + 32n),
          onTruncated,
        );
        const properties = readObjcPropertiesOf(
          read,
          read.pointer(category + 40n),
          {
            owner: `category ${name}`,
            admit: input.admit,
            issues: input.issues,
            location: `0x${read.pointer(category + 40n).toString(16)}`,
            onTruncated,
          },
        );
        const decodeReasons = [
          ...(className === null ? ["category_class_unresolved"] : []),
          ...(budgetTruncated ? ["max_records_reached"] : []),
        ];
        result.objc_categories.push({
          name,
          class_name: className,
          class_source:
            external !== undefined
              ? "external"
              : className === null
                ? "unresolved"
                : "local",
          instance_methods: instanceMethods,
          class_methods: classMethods,
          protocols,
          properties,
          location: read.location(category),
          decode:
            decodeReasons.length === 0
              ? { status: "decoded", reason: null }
              : { status: "partial", reason: decodeReasons.join("; ") },
          evidence: read.evidence(category, "Objective-C category_t record"),
        });
      } catch (cause: unknown) {
        const message = cause instanceof Error ? cause.message : String(cause);
        input.issues.push(
          issue(
            "objc_properties_categories",
            "category_decode_failed",
            message,
            `0x${field.toString(16)}`,
          ),
        );
      }
    }
  }
  return examined;
};
