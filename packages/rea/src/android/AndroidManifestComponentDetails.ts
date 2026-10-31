import type { Element } from "@xmldom/xmldom";
import type { z } from "zod";
import type {
  AndroidManifestComponent,
  androidIntentDataSchema,
  androidIntentFilterSchema,
  androidComponentMetadataSchema,
} from "../domain/android/androidManifestComponents.js";
import {
  androidAttribute,
  createManifestLocationReader,
  isAndroidAttribute,
  isManifestElement,
} from "./AndroidManifestXml.js";

type Filter = z.output<typeof androidIntentFilterSchema>;
type Data = z.output<typeof androidIntentDataSchema>;
type Metadata = z.output<typeof androidComponentMetadataSchema>;

const projectedDataAttributes = new Set([
  "scheme",
  "host",
  "port",
  "path",
  "pathPrefix",
  "pathPattern",
  "pathAdvancedPattern",
  "pathSuffix",
  "mimeType",
]);

const literalBoolean = (value: string | null): boolean | null =>
  value === "true" ? true : value === "false" ? false : null;

/** One decoded-manifest lifetime owns nested declarations and cumulative copy budgets. */
export const createAndroidManifestDetailsReader = (
  source: string,
  limits: {
    readonly intentFilters: number;
    readonly intentValues: number;
    readonly processBytes: number;
    readonly detailBytes: number;
  },
) => {
  const locationOf = createManifestLocationReader(source);
  let processRemaining = limits.processBytes;
  let detailsRemaining = limits.detailBytes;
  return (component: Element, declarationIndex: number) => {
    let partial = false;
    let detailLimited = false;
    let processLimited = false;
    let unsupported = 0;
    let remainingRecords = limits.intentValues;
    const take = (value: string | null): string | null => {
      if (value === null) return null;
      const bytes = Buffer.byteLength(value);
      if (bytes > detailsRemaining) {
        partial = true;
        detailLimited = true;
        return null;
      }
      detailsRemaining -= bytes;
      return value;
    };
    const admit = (): boolean => {
      if (remainingRecords === 0) {
        partial = true;
        detailLimited = true;
        return false;
      }
      remainingRecords -= 1;
      return true;
    };
    const enabledDeclaration = androidAttribute(component, "enabled");
    const enabled = literalBoolean(enabledDeclaration);
    const grantDeclaration =
      component.nodeName === "provider"
        ? androidAttribute(component, "grantUriPermissions")
        : null;
    const grant = literalBoolean(grantDeclaration);
    const declaredProcess = androidAttribute(component, "process");
    let process: string | null = null;
    if (declaredProcess !== null) {
      const bytes = Buffer.byteLength(declaredProcess);
      if (bytes > processRemaining) {
        partial = true;
        processLimited = true;
      } else {
        process = declaredProcess;
        processRemaining -= bytes;
      }
    }
    const filters: Filter[] = [];
    const metadata: Metadata[] = [];
    const actions: string[] = [];
    const categories: string[] = [];
    const actionNames = new Set<string>();
    const categoryNames = new Set<string>();
    let legacyValuesRemaining = limits.intentValues;
    let legacyTruncated = false;
    let filterCount = 0;
    for (let index = 0; index < component.childNodes.length; index += 1) {
      const child = component.childNodes.item(index);
      if (!isManifestElement(child)) continue;
      if (child.nodeName === "meta-data") {
        if (admit())
          metadata.push({
            name: take(androidAttribute(child, "name")),
            location: locationOf(child),
          });
        continue;
      }
      if (child.nodeName !== "intent-filter") continue;
      const filterIndex = filterCount++;
      if (filterIndex >= limits.intentFilters) {
        partial = true;
        legacyTruncated = true;
        continue;
      }
      const filterActions: string[] = [];
      const filterCategories: string[] = [];
      const data: Data[] = [];
      let filterPartial = false;
      const priority = take(androidAttribute(child, "priority"));
      for (let at = 0; at < child.childNodes.length; at += 1) {
        const member = child.childNodes.item(at);
        if (!isManifestElement(member)) continue;
        if (member.nodeName === "action" || member.nodeName === "category") {
          const value = androidAttribute(member, "name");
          if (value === null) continue;
          const names =
            member.nodeName === "action" ? actionNames : categoryNames;
          if (!names.has(value)) {
            if (legacyValuesRemaining === 0) legacyTruncated = true;
            else {
              legacyValuesRemaining -= 1;
              names.add(value);
              (member.nodeName === "action" ? actions : categories).push(value);
            }
          }
          if (!admit()) {
            filterPartial = true;
            continue;
          }
          const copied = take(value);
          if (copied === null) {
            filterPartial = true;
            continue;
          }
          (member.nodeName === "action"
            ? filterActions
            : filterCategories
          ).push(copied);
        } else if (member.nodeName === "data") {
          if (!admit()) {
            filterPartial = true;
            continue;
          }
          for (
            let attributeIndex = 0;
            attributeIndex < member.attributes.length;
            attributeIndex += 1
          ) {
            const attribute = member.attributes.item(attributeIndex);
            if (
              attribute !== null &&
              isAndroidAttribute(attribute) &&
              (attribute.localName === null ||
                !projectedDataAttributes.has(attribute.localName))
            ) {
              // A retained data declaration can have unprojected matching constraints.
              unsupported += 1;
              filterPartial = true;
              partial = true;
              break;
            }
          }
          data.push({
            location: locationOf(member),
            scheme: take(androidAttribute(member, "scheme")),
            host: take(androidAttribute(member, "host")),
            port: take(androidAttribute(member, "port")),
            path: take(androidAttribute(member, "path")),
            path_prefix: take(androidAttribute(member, "pathPrefix")),
            path_pattern: take(androidAttribute(member, "pathPattern")),
            path_advanced_pattern: take(
              androidAttribute(member, "pathAdvancedPattern"),
            ),
            path_suffix: take(androidAttribute(member, "pathSuffix")),
            mime_type: take(androidAttribute(member, "mimeType")),
          });
        } else {
          // Newer platform filter constructs remain source-accessible, never an empty match claim.
          unsupported += 1;
          filterPartial = true;
          partial = true;
        }
      }
      filters.push({
        source_index: filterIndex,
        location: locationOf(child),
        priority,
        actions: filterActions,
        categories: filterCategories,
        data,
        coverage: filterPartial || detailLimited ? "partial" : "complete",
      });
    }
    const enabledRaw = take(enabledDeclaration);
    const grantRaw = take(grantDeclaration);
    const facts = {
      declaration_index: declarationIndex,
      location: locationOf(component),
      declaration_coverage: partial ? "partial" : "complete",
      enabled,
      enabled_declaration: enabledRaw,
      process,
      grant_uri_permissions: grant,
      grant_uri_permissions_declaration: grantRaw,
      intent_filters: filters,
      meta_data: metadata,
    } satisfies Pick<
      AndroidManifestComponent,
      | "declaration_index"
      | "location"
      | "declaration_coverage"
      | "enabled"
      | "enabled_declaration"
      | "process"
      | "grant_uri_permissions"
      | "grant_uri_permissions_declaration"
      | "intent_filters"
      | "meta_data"
    >;
    return {
      facts,
      actions,
      categories,
      filterCount,
      legacyTruncated,
      partial,
      detailLimited,
      processLimited,
      unsupported,
      nonliteralEnabled: enabledDeclaration !== null && enabled === null,
      nonliteralGrant: grantDeclaration !== null && grant === null,
    };
  };
};
