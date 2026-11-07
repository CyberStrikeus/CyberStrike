import { parseXmlDocument } from "../domain/xmlDocument.js";
import {
  androidAttribute,
  plainAttribute,
  childNodes,
  isManifestElement,
} from "./AndroidManifestXml.js";
import { createAndroidManifestDetailsReader } from "./AndroidManifestComponentDetails.js";
import {
  ANDROID_COMPONENT_KINDS,
  type AndroidComponentKind,
  type ObservedAndroidManifestComponent,
  type ObservedAndroidManifestComponentInventory,
} from "../domain/android/androidManifestComponents.js";

/** Bounds keep a hostile manifest from exhausting the inspection. */
export const ANDROID_MANIFEST_LIMITS = {
  components: 512,
  intentFilters: 32,
  intentValues: 64,
  authorities: 64,
  /** Total bytes of resolved component names, bounding package amplification. */
  resolvedNameBytes: 1024 * 1024,
  authorityBytes: 1024 * 1024,
  /** Total copied permission-value bytes, including inherited defaults. */
  permissionBytes: 1024 * 1024,
  /** Total copied android:process bytes across projected declarations. */
  processBytes: 1024 * 1024,
  /** Copied nested declaration values; complete text remains retained. */
  detailBytes: 1024 * 1024,
} as const;

const PARTIAL_LIMITATION =
  "The decoded manifest text is truncated, so its component inventory is not established; the retained manifest is partial.";

const unavailable = (
  limitation: string,
): ObservedAndroidManifestComponentInventory => ({
  status: "unavailable",
  items: [],
  limitations: [limitation],
});

/** Android application-ID grammar, with the platform package exception. */
const hasSupportedAndroidPackageNameSyntax = (name: string): boolean =>
  name === "android" ||
  (name.length <= 223 &&
    /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u.test(name));

// DEX SimpleName permits digits at the start, '-', supplemental code points,
// and (since format 040) spaces. A decoded manifest does not qualify DEX
// version or class existence; accept the documented character union here.
const dexSimpleNameCharacter =
  /^[A-Za-z0-9$_\- \u00a0-\u1fff\u2000-\u200a\u2010-\u2027\u202f-\ud7ff\ue000-\uffef\u{10000}-\u{10ffff}]$/u;

const hasSupportedDexBinaryClassNameSyntax = (name: string): boolean => {
  let segmentStart = true;
  let first = true;
  for (const character of name) {
    if (first && character === ".") {
      first = false;
      continue;
    }
    first = false;
    if (character === ".") {
      if (segmentStart) return false;
      segmentStart = true;
    } else {
      if (!dexSimpleNameCharacter.test(character)) return false;
      segmentStart = false;
    }
  }
  return !segmentStart;
};

const containsUnresolvedToken = (value: string): boolean =>
  value.includes("@") || value.includes("?") || value.includes("${");

/**
 * Android resolves a component name against the manifest package: a leading
 * dot or a name without any dot is relative to the package, while a dotted
 * name is already fully qualified.
 */
export const resolveAndroidComponentName = (
  packageName: string | null,
  declared: string,
): string => {
  if (declared.startsWith(".")) return `${packageName ?? ""}${declared}`;
  if (!declared.includes(".") && packageName !== null)
    return `${packageName}.${declared}`;
  return declared;
};

const isComponentKind = (tag: string): tag is AndroidComponentKind =>
  (ANDROID_COMPONENT_KINDS as readonly string[]).includes(tag);

const androidTargetSdkLevel = (targetSdk: string | null): number | null => {
  // JADX prints TYPE_INT_HEX as 0x..., while TYPE_INT_DEC stays decimal.
  // Both originate in an Android signed 32-bit resource integer.
  if (targetSdk === null || !/^(?:[0-9]+|0x[0-9a-f]+)$/iu.test(targetSdk))
    return null;
  const level = Number(targetSdk);
  return Number.isInteger(level) && level >= 1 && level <= 0x7fffffff
    ? level
    : null;
};

/** Split a provider authorities declaration within its own bound. */
const providerAuthorities = (
  declared: string,
  byteLimit: number,
): {
  authorities: string[];
  truncated: boolean;
  bytes: number;
  malformed: number;
} => {
  const authorities: string[] = [];
  let truncated = false;
  let bytes = 0;
  let malformed = 0;
  let start = 0;
  while (start <= declared.length) {
    const separator = declared.indexOf(";", start);
    const end = separator < 0 ? declared.length : separator;
    const value = declared.slice(start, end);
    const valueBytes = Buffer.byteLength(value);
    if (
      authorities.length >= ANDROID_MANIFEST_LIMITS.authorities ||
      valueBytes > byteLimit - bytes
    ) {
      truncated = true;
      break;
    }
    if (value.length === 0 || value !== value.trim()) malformed += 1;
    authorities.push(value);
    bytes += valueBytes;
    if (separator < 0) break;
    start = separator + 1;
  }
  return { authorities, truncated, bytes, malformed };
};

/**
 * Parse the decoded AndroidManifest XML text into a bounded, deterministic
 * component inventory. The projection is static: it reports declarations and
 * Android's documented export defaults, never merged-manifest or runtime
 * state.
 */
export const parseAndroidManifestComponents = (
  manifestText: string,
  coverage: "complete" | "partial",
  declaredTargetSdk: string | null = null,
  minimumSdk: string | null = null,
): ObservedAndroidManifestComponentInventory => {
  if (coverage === "partial")
    return {
      status: "partial",
      items: [],
      limitations: [PARTIAL_LIMITATION],
    };
  const parsed = parseXmlDocument(manifestText, {
    doctype: "reject",
    lineEndings: "preserve",
  });
  if (!parsed.ok)
    return unavailable(
      `The decoded manifest is not well-formed XML (${parsed.error.reason}), so its component inventory is unavailable.`,
    );
  const root = parsed.value.documentElement;
  if (!isManifestElement(root) || root.nodeName !== "manifest")
    return unavailable(
      "The decoded manifest root is not <manifest>, so its component inventory is unavailable.",
    );
  const rawPackageName = plainAttribute(root, "package");
  const packageName = rawPackageName?.trim() || null;
  const packageHasInvalidWhitespace =
    rawPackageName !== null && rawPackageName !== rawPackageName.trim();
  const packageHasUnresolvedToken =
    packageName !== null && containsUnresolvedToken(packageName);
  const packageHasUnsupportedPackageSyntax =
    packageName !== null &&
    !packageHasUnresolvedToken &&
    !hasSupportedAndroidPackageNameSyntax(packageName);
  const packageNameBytes =
    packageName === null ? 0 : Buffer.byteLength(packageName);
  const limitations: string[] = [];
  const items: ObservedAndroidManifestComponent[] = [];
  let truncated = false;
  let applicationSeen = false;
  let unnamed = 0;
  let providerDefaultsUnknown = 0;
  let nonliteralExported = 0;
  let unresolvedNames = 0;
  let unresolvedPackages = 0;
  let unresolvedTargetActivities = 0;
  let unresolvedTokens = 0;
  let invalidNames = 0;
  let malformedAuthoritySegments = 0;
  let providerPermissionOverridesUnknown = 0;
  let invalidExported = 0;
  let unknownFilteredExportDefaults = 0;
  let capacityTruncated = false;
  let permissionBudgetLimited = false;
  let unresolvedPermissionTokens = 0;
  let nonliteralEnabled = 0;
  let nonliteralGrantUriPermissions = 0;
  let processBudgetLimited = false;
  let nameBudget = ANDROID_MANIFEST_LIMITS.resolvedNameBytes;
  let authorityBudget = ANDROID_MANIFEST_LIMITS.authorityBytes;
  let permissionBudget = ANDROID_MANIFEST_LIMITS.permissionBytes;
  let detailBudgetLimited = false;
  let unsupportedFilterMembers = 0;
  const readDetails = createAndroidManifestDetailsReader(
    manifestText,
    ANDROID_MANIFEST_LIMITS,
  );
  const children = childNodes(root);
  let targetSdkDeclared = false;
  let minimumSdkDeclared = false;
  for (const child of children) {
    if (!isManifestElement(child) || child.nodeName !== "uses-sdk") continue;
    // Match the bridge's declaration owner: the last uses-sdk supplies values.
    targetSdkDeclared = androidAttribute(child, "targetSdkVersion") !== null;
    minimumSdkDeclared = androidAttribute(child, "minSdkVersion") !== null;
  }
  // Empty protocol values can mean omission or an empty declared attribute.
  // XML presence disambiguates them; an explicit unknown never becomes API 1.
  let effectiveTargetSdk = declaredTargetSdk;
  if (effectiveTargetSdk === null && !targetSdkDeclared) {
    effectiveTargetSdk = minimumSdk;
    if (effectiveTargetSdk === null && !minimumSdkDeclared)
      effectiveTargetSdk = "1";
  }
  const targetSdkLevel = androidTargetSdkLevel(effectiveTargetSdk);
  // Parse the effective SDK once even when hundreds of providers share it.
  const providerDefault = targetSdkLevel === null ? null : targetSdkLevel <= 16;
  for (const node of children) {
    if (!isManifestElement(node)) continue;
    const element = node;
    if (element.nodeName !== "application") continue;
    applicationSeen = true;
    const precedingActivityTargetNames = new Set<string>();
    const declaredApplicationPermission = androidAttribute(
      element,
      "permission",
    );
    const applicationPermission =
      declaredApplicationPermission === null ||
      declaredApplicationPermission.length === 0
        ? null
        : declaredApplicationPermission;
    const applicationPermissionHasUnresolvedToken =
      applicationPermission !== null &&
      containsUnresolvedToken(applicationPermission);
    const applicationPermissionBytes =
      applicationPermission === null
        ? null
        : Buffer.byteLength(applicationPermission);
    for (const child of childNodes(element)) {
      if (!isManifestElement(child)) continue;
      const component = child;
      if (!isComponentKind(component.nodeName)) continue;
      // Every declaration counts against the bound, named or not, so an
      // unnamed flood cannot exceed it while still reporting complete.
      if (items.length + unnamed >= ANDROID_MANIFEST_LIMITS.components) {
        truncated = true;
        capacityTruncated = true;
        break;
      }
      const declared = androidAttribute(component, "name");
      if (declared === null) {
        unnamed += 1;
        continue;
      }
      const unresolvedName = containsUnresolvedToken(declared);
      const details = readDetails(component, items.length + unnamed);
      const collected = {
        actions: details.actions,
        categories: details.categories,
        truncated: details.legacyTruncated,
      };
      if (details.partial) truncated = true;
      if (details.detailLimited) detailBudgetLimited = true;
      unsupportedFilterMembers += details.unsupported;
      if (details.processLimited) {
        processBudgetLimited = true;
        capacityTruncated = true;
      }
      if (details.nonliteralEnabled) nonliteralEnabled += 1;
      if (details.nonliteralGrant) nonliteralGrantUriPermissions += 1;
      if (collected.truncated) {
        truncated = true;
        capacityTruncated = true;
      }
      // A huge manifest package would be copied into every resolved name;
      // once the byte budget is spent, later names keep their declared form.
      const invalidDeclaredName =
        declared.length === 0 ||
        (!unresolvedName && !hasSupportedDexBinaryClassNameSyntax(declared));
      const needsPackage = declared.startsWith(".") || !declared.includes(".");
      const packageKnown =
        !invalidDeclaredName &&
        !unresolvedName &&
        (!needsPackage ||
          (packageName !== null &&
            !packageHasInvalidWhitespace &&
            !packageHasUnresolvedToken &&
            !packageHasUnsupportedPackageSyntax));
      const declaredBytes = Buffer.byteLength(declared);
      const resolvedBytes =
        needsPackage && packageKnown
          ? packageNameBytes +
            (declared.startsWith(".") ? 0 : 1) +
            declaredBytes
          : declaredBytes;
      const nameFits = packageKnown && resolvedBytes <= nameBudget;
      const name = nameFits
        ? resolveAndroidComponentName(packageName, declared)
        : declared;
      if (invalidDeclaredName) invalidNames += 1;
      if (!invalidDeclaredName) {
        if (unresolvedName) unresolvedTokens += 1;
        else if (!packageKnown) unresolvedPackages += 1;
        else if (!nameFits) unresolvedNames += 1;
        else nameBudget -= resolvedBytes;
      }
      if (component.nodeName === "activity" && nameFits) {
        precedingActivityTargetNames.add(name);
        precedingActivityTargetNames.add(declared);
        if (
          packageName !== null &&
          !packageHasInvalidWhitespace &&
          !packageHasUnresolvedToken &&
          !packageHasUnsupportedPackageSyntax &&
          name.length > packageName.length &&
          name.startsWith(packageName) &&
          name[packageName.length] === "."
        ) {
          const relativeName = name.slice(packageName.length);
          precedingActivityTargetNames.add(relativeName);
          const bareName = relativeName.slice(1);
          if (!bareName.includes("."))
            precedingActivityTargetNames.add(bareName);
        }
      }
      let authorities: string[] | null = null;
      if (component.nodeName === "provider") {
        if (
          androidAttribute(component, "readPermission") !== null ||
          androidAttribute(component, "writePermission") !== null
        )
          providerPermissionOverridesUnknown += 1;
        const declaredAuthorities = androidAttribute(component, "authorities");
        if (declaredAuthorities !== null) {
          const split = providerAuthorities(
            declaredAuthorities,
            authorityBudget,
          );
          malformedAuthoritySegments += split.malformed;
          if (split.truncated) {
            truncated = true;
            capacityTruncated = true;
          }
          authorityBudget -= split.bytes;
          if (authorityBudget < 0) authorityBudget = 0;
          authorities = split.authorities;
        }
      }
      const declaredPermission = androidAttribute(component, "permission");
      const permissionValue =
        declaredPermission === null
          ? component.nodeName === "activity-alias"
            ? null
            : applicationPermission
          : declaredPermission.length === 0
            ? null
            : declaredPermission;
      const permissionSource =
        permissionValue === null
          ? "none"
          : declaredPermission === null
            ? "application"
            : "component";
      let permission: string | null = permissionValue;
      let effectivePermissionSource:
        | "component"
        | "application"
        | "none"
        | "unknown" = permissionSource;
      if (permissionValue !== null) {
        const permissionHasUnresolvedToken =
          declaredPermission === null
            ? applicationPermissionHasUnresolvedToken
            : containsUnresolvedToken(permissionValue);
        if (permissionHasUnresolvedToken) {
          permission = null;
          effectivePermissionSource = "unknown";
          unresolvedPermissionTokens += 1;
        } else {
          // Inherited application permission is the same string for every
          // component. Measure it once at its owning boundary rather than
          // rescanning a potentially large decoded value per inherited copy.
          const permissionBytes =
            declaredPermission === null
              ? (applicationPermissionBytes ?? 0)
              : Buffer.byteLength(permissionValue);
          if (permissionBytes > permissionBudget) {
            permission = null;
            effectivePermissionSource = "unknown";
            truncated = true;
            capacityTruncated = true;
            permissionBudgetLimited = true;
          } else permissionBudget -= permissionBytes;
        }
      }
      const declaredExported = androidAttribute(component, "exported");
      const targetActivity =
        component.nodeName === "activity-alias"
          ? androidAttribute(component, "targetActivity")
          : null;
      if (component.nodeName === "activity-alias") {
        if (targetActivity === null) {
          unresolvedTargetActivities += 1;
        } else {
          const targetNeedsPackage =
            targetActivity.startsWith(".") || !targetActivity.includes(".");
          const targetUnresolved = containsUnresolvedToken(targetActivity);
          const targetInvalid =
            targetActivity.length === 0 ||
            (!targetUnresolved &&
              !hasSupportedDexBinaryClassNameSyntax(targetActivity));
          const targetPackageKnown =
            packageName !== null &&
            !packageHasInvalidWhitespace &&
            !packageHasUnresolvedToken &&
            !packageHasUnsupportedPackageSyntax;
          const targetResolved =
            !targetInvalid &&
            !targetUnresolved &&
            (!targetNeedsPackage || targetPackageKnown);
          if (
            !targetResolved ||
            !precedingActivityTargetNames.has(targetActivity)
          )
            unresolvedTargetActivities += 1;
        }
      }
      const exportedLiteral =
        declaredExported === "true"
          ? true
          : declaredExported === "false"
            ? false
            : null;
      const exportedNonliteral =
        declaredExported !== null && exportedLiteral === null;
      const explicitExportRequired =
        declaredExported === null &&
        targetSdkLevel !== null &&
        targetSdkLevel >= 31 &&
        details.filterCount > 0 &&
        (component.nodeName === "activity" ||
          component.nodeName === "activity-alias" ||
          component.nodeName === "service" ||
          component.nodeName === "receiver");
      const filteredExportUnknown =
        declaredExported === null &&
        targetSdkLevel === null &&
        details.filterCount > 0 &&
        (component.nodeName === "activity" ||
          component.nodeName === "activity-alias" ||
          component.nodeName === "service" ||
          component.nodeName === "receiver");
      // The default only matters when android:exported is absent.
      if (
        component.nodeName === "provider" &&
        providerDefault === null &&
        declaredExported === null
      )
        providerDefaultsUnknown += 1;
      if (exportedNonliteral) nonliteralExported += 1;
      if (explicitExportRequired) invalidExported += 1;
      if (filteredExportUnknown) unknownFilteredExportDefaults += 1;
      items.push({
        kind: component.nodeName,
        declared_name: declared,
        name,
        exported: exportedLiteral,
        exported_default:
          exportedNonliteral || explicitExportRequired || filteredExportUnknown
            ? null
            : component.nodeName === "provider"
              ? providerDefault
              : details.filterCount > 0,
        permission,
        permission_source: effectivePermissionSource,
        intent_filter_count: details.filterCount,
        actions: collected.actions,
        categories: collected.categories,
        foreground_service_type:
          component.nodeName === "service"
            ? androidAttribute(component, "foregroundServiceType")
            : null,
        authorities,
        target_activity: targetActivity,
        ...details.facts,
      });
    }
  }
  if (!applicationSeen)
    limitations.push(
      "The manifest declares no <application> element, so no components were projected.",
    );
  // Dropped declarations mean the inventory is not the whole manifest.
  if (unnamed > 0) {
    limitations.push(
      `${String(unnamed)} component declaration(s) without android:name are omitted from the inventory.`,
    );
    truncated = true;
  }
  if (invalidNames > 0) {
    limitations.push(
      `${String(invalidNames)} component name value(s) are empty or do not fit DEX binary class-name syntax; the raw declaration is retained without resolving it as an identity.`,
    );
    truncated = true;
  }
  if (packageHasInvalidWhitespace) {
    limitations.push(
      "The manifest package has surrounding whitespace; relative component names were not resolved against it.",
    );
    truncated = true;
  }
  if (packageHasUnsupportedPackageSyntax) {
    limitations.push(
      "The manifest package does not fit the supported Java package-name syntax; package-relative component names were not resolved against it.",
    );
    truncated = true;
  }
  if (providerPermissionOverridesUnknown > 0) {
    limitations.push(
      `${String(providerPermissionOverridesUnknown)} provider(s) declare android:readPermission or android:writePermission; operation-specific permission overrides are retained in the manifest text but are not projected.`,
    );
    truncated = true;
  }
  if (malformedAuthoritySegments > 0) {
    limitations.push(
      `${String(malformedAuthoritySegments)} provider authority segment(s) are empty or have surrounding whitespace; exact segments are retained and their registration is not established.`,
    );
    truncated = true;
  }
  if (providerDefaultsUnknown > 0)
    limitations.push(
      `${String(providerDefaultsUnknown)} provider(s) omit android:exported and the target SDK is unknown, so Android's export default for them is not established.`,
    );
  if (nonliteralExported > 0)
    limitations.push(
      `${String(nonliteralExported)} component declaration(s) set android:exported to a value other than the literals true or false (for example a resource reference), so their effective export state is unknown and the Android default does not apply.`,
    );
  if (nonliteralEnabled > 0)
    limitations.push(
      `${String(nonliteralEnabled)} component declaration(s) set android:enabled to a nonliteral boolean; the declared enabled state is unknown.`,
    );
  if (nonliteralGrantUriPermissions > 0)
    limitations.push(
      `${String(nonliteralGrantUriPermissions)} provider(s) set android:grantUriPermissions to a nonliteral boolean; the declared URI-grant state is unknown.`,
    );
  if (unresolvedPackages > 0) {
    limitations.push(
      `${String(unresolvedPackages)} package-relative component name(s) remain unresolved because the manifest package is absent or contains a resource/placeholder token, or its syntax is unsupported; the declared name is retained.`,
    );
    truncated = true;
  }
  if (unresolvedTargetActivities > 0) {
    limitations.push(
      `${String(unresolvedTargetActivities)} activity-alias targetActivity value(s) are empty, malformed, unresolved against the manifest package, or do not match a preceding activity declaration; each exact declared value is retained.`,
    );
    truncated = true;
  }
  if (unresolvedTokens > 0) {
    limitations.push(
      `${String(unresolvedTokens)} component name(s) contain an unresolved resource or manifest placeholder token; the declared name is retained without claiming a resolved identity.`,
    );
    truncated = true;
  }
  if (permissionBudgetLimited)
    limitations.push(
      `Projected component permission values are capped at ${String(ANDROID_MANIFEST_LIMITS.permissionBytes)} total bytes; omitted copies have permission_source "unknown".`,
    );
  if (detailBudgetLimited)
    limitations.push(
      `Nested component declarations reached the ${String(ANDROID_MANIFEST_LIMITS.intentValues)}-record per-component or ${String(ANDROID_MANIFEST_LIMITS.detailBytes)}-byte shared copy bound; affected declaration coverage is partial. Read the retained manifest at each source location for omitted facts.`,
    );
  if (unsupportedFilterMembers > 0)
    limitations.push(
      `${String(unsupportedFilterMembers)} intent-filter child declaration(s) use unsupported constructs; affected filter coverage is partial and the declarations remain in the retained manifest.`,
    );
  if (processBudgetLimited)
    limitations.push(
      `Projected component process declarations are capped at ${String(ANDROID_MANIFEST_LIMITS.processBytes)} total bytes; omitted values are null.`,
    );
  if (unresolvedPermissionTokens > 0) {
    limitations.push(
      `${String(unresolvedPermissionTokens)} permission value(s) contain unresolved resource or manifest-placeholder tokens; their effective values are unknown.`,
    );
    truncated = true;
  }
  if (invalidExported > 0) {
    limitations.push(
      `${String(invalidExported)} component(s) with intent filters target API 31 or later and omit android:exported; Android requires an explicit value, so the inventory does not infer a default.`,
    );
  }
  if (unknownFilteredExportDefaults > 0)
    limitations.push(
      `${String(unknownFilteredExportDefaults)} filtered component(s) omit android:exported and the target SDK is unknown, so the applicable export rule is not established.`,
    );
  if (unresolvedNames > 0) {
    limitations.push(
      `${String(unresolvedNames)} component name(s) keep their declared form because the resolved-name byte budget (${String(ANDROID_MANIFEST_LIMITS.resolvedNameBytes)}) was exhausted.`,
    );
    truncated = true;
  }
  if (capacityTruncated)
    limitations.push(
      `The component inventory reached a capacity limit: ${String(ANDROID_MANIFEST_LIMITS.components)} declarations, ${String(ANDROID_MANIFEST_LIMITS.intentFilters)} filters or ${String(ANDROID_MANIFEST_LIMITS.intentValues)} values per component, ${String(ANDROID_MANIFEST_LIMITS.authorities)} authorities per provider, ${String(ANDROID_MANIFEST_LIMITS.authorityBytes)} total authority bytes, or ${String(ANDROID_MANIFEST_LIMITS.permissionBytes)} total permission bytes, or ${String(ANDROID_MANIFEST_LIMITS.processBytes)} total process bytes.`,
    );
  return {
    status: truncated ? "partial" : "complete",
    items,
    limitations,
  };
};
