import type {
  ManagedArtifactInspection,
  ManagedParseIssue,
} from "../domain/managed/managedArtifact.js";
import {
  METADATA_TABLE_NAMES,
  type ManagedMetadataLayout,
  type MetadataTableLayout,
} from "./ManagedMetadataLayout.js";
import {
  readAssembly,
  readAssemblyReference,
  readCustomAttribute,
  readModule,
  readResource,
  managedMetadataTypeNames,
  type ManagedMetadataTypeNameLookup,
} from "./ManagedMetadataInventoryRows.js";
import { metadataToken } from "./ManagedMetadataHeaps.js";
import type { TypeMemberListFacts } from "./ManagedTypeMemberLists.js";
import {
  appendManagedParseIssues,
  readManagedValue,
  uniqueManagedParseIssues,
} from "./ManagedReaderFailure.js";
import type { ManagedPeLayout } from "./ManagedPeReader.js";

type ModuleIdentity = NonNullable<ManagedArtifactInspection["module"]>;
type AssemblyIdentity = NonNullable<ManagedArtifactInspection["assembly"]>;
type AssemblyReference = ManagedArtifactInspection["references"][number];
type ManagedResource = ManagedArtifactInspection["resources"][number];
type CustomAttribute = ManagedArtifactInspection["attributes"][number];
export interface ManagedResourceDirectory {
  readonly offset: number;
  readonly size: number;
}

/** Map optional embedded resources without discarding admitted CLI metadata. */
export const readManagedResourceDirectory = (
  pe: ManagedPeLayout,
  issues: ManagedParseIssue[],
): ManagedResourceDirectory | null => {
  const resources = pe.cli?.resources;
  if (resources === undefined || (resources.rva === 0 && resources.size === 0))
    return null;
  return (
    readManagedValue(
      () => ({
        offset: pe.rvaToOffset(resources.rva, resources.size, "cli.resources"),
        size: resources.size,
      }),
      issues,
    ) ?? null
  );
};

export interface ManagedMetadataInventory {
  readonly module: ModuleIdentity | null;
  readonly assembly: AssemblyIdentity | null;
  readonly targetFrameworks: readonly string[];
  readonly referenceNames: readonly string[];
  readonly references: readonly AssemblyReference[];
  readonly resources: readonly ManagedResource[];
  readonly attributes: readonly CustomAttribute[];
  readonly issues: readonly ManagedParseIssue[];
}

const readRows = <Item>(
  descriptor: MetadataTableLayout | undefined,
  read: (row: number) => Item | undefined,
): readonly Item[] => {
  const total = descriptor?.rowCount ?? 0;
  const items: Item[] = [];
  for (let index = 0; index < total; index += 1) {
    const item = read(index + 1);
    if (item !== undefined) items.push(item);
  }
  return items;
};

const heapExtent = (layout: ManagedMetadataLayout): number =>
  Math.max(layout.strings.size, layout.blob?.size ?? 0);

const validateIdentityTableCounts = (
  layout: ManagedMetadataLayout,
  issues: ManagedParseIssue[],
): void => {
  const moduleRows = layout.table(0)?.rowCount ?? 0;
  if (moduleRows !== 1)
    issues.push({
      code: "invalid-row",
      scope: "metadata.Module",
      offset: layout.table(0)?.offset ?? null,
      detail: `Module table must contain exactly one row; found ${String(moduleRows)}`,
    });

  const assemblyRows = layout.table(32)?.rowCount ?? 0;
  if (assemblyRows > 1)
    issues.push({
      code: "invalid-row",
      scope: "metadata.Assembly",
      offset: layout.table(32)?.offset ?? null,
      detail: `Assembly table can contain at most one row; found ${String(assemblyRows)}`,
    });
};

/** Module identity is independent of assembly references, attributes and resources. */
export const readManagedModuleIdentity = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
): Pick<ManagedMetadataInventory, "module" | "issues"> => {
  const issues: ManagedParseIssue[] = [];
  validateIdentityTableCounts(layout, issues);
  const module =
    readManagedValue(
      () => readModule(bytes, layout, heapExtent(layout)),
      issues,
    ) ?? null;
  return { module, issues };
};

const readReferences = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  issues: ManagedParseIssue[],
): {
  readonly references: readonly AssemblyReference[];
  readonly referenceNames: readonly string[];
} => {
  const references = readRows(layout.table(35), (row) =>
    readManagedValue(
      () => readAssemblyReference(bytes, layout, row, heapExtent(layout)),
      issues,
    ),
  );
  return {
    references,
    referenceNames: [...new Set(references.map(({ name }) => name))].sort(),
  };
};

const readResources = ({
  bytes,
  layout,
  resourceDirectory,
  issues,
}: {
  readonly bytes: Buffer;
  readonly layout: ManagedMetadataLayout;
  readonly resourceDirectory: ManagedResourceDirectory | null;
  readonly issues: ManagedParseIssue[];
}): readonly ManagedResource[] =>
  readRows(layout.table(40), (row) =>
    readManagedValue(
      () =>
        readResource({
          bytes,
          layout,
          row,
          directory: resourceDirectory,
          issues,
        }),
      issues,
    ),
  );

const readAttributes = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  issues: ManagedParseIssue[],
  memberLists: TypeMemberListFacts,
  typeNames: ManagedMetadataTypeNameLookup,
): {
  readonly attributes: readonly CustomAttribute[];
  readonly targetFrameworks: readonly string[];
} => {
  const attributes = readRows(layout.table(12), (row) =>
    readManagedValue(
      () =>
        readCustomAttribute(
          bytes,
          layout,
          row,
          heapExtent(layout),
          issues,
          memberLists,
          typeNames,
        ),
      issues,
    ),
  );
  const targetFrameworks = new Set<string>();
  for (const attribute of attributes) {
    if (
      attribute.parent_token === metadataToken(32, 1) &&
      attribute.type_name ===
        "System.Runtime.Versioning.TargetFrameworkAttribute" &&
      attribute.decoded_fixed_string !== null
    )
      targetFrameworks.add(attribute.decoded_fixed_string);
  }
  return { attributes, targetFrameworks: [...targetFrameworks].sort() };
};

/** Inventory identity tables without CLR reflection or execution. */
export const readManagedMetadataInventory = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  resourceDirectory: ManagedResourceDirectory | null,
  memberLists: TypeMemberListFacts,
  identity: Pick<
    ManagedMetadataInventory,
    "module" | "issues"
  > = readManagedModuleIdentity(bytes, layout),
  typeNames?: ManagedMetadataTypeNameLookup,
): ManagedMetadataInventory => {
  const issues: ManagedParseIssue[] = [...memberLists.issues];
  appendManagedParseIssues(issues, identity.issues);
  const { module } = identity;
  const assembly =
    readManagedValue(
      () => readAssembly(bytes, layout, heapExtent(layout)),
      issues,
    ) ?? null;
  const { references, referenceNames } = readReferences(bytes, layout, issues);
  const resources = readResources({
    bytes,
    layout,
    resourceDirectory,
    issues,
  });
  const { attributes, targetFrameworks } = readAttributes(
    bytes,
    layout,
    issues,
    memberLists,
    typeNames ?? managedMetadataTypeNames(bytes, layout, issues),
  );
  return {
    module,
    assembly,
    targetFrameworks,
    referenceNames,
    references,
    resources,
    attributes,
    issues: uniqueManagedParseIssues(issues),
  };
};

/** Stable table-name/count projection for caller-visible coverage. */
export const managedTableRowCounts = (
  layout: ManagedMetadataLayout,
): Readonly<Record<string, number>> =>
  Object.fromEntries(
    [...layout.tables.values()].map(({ index, rowCount }) => [
      METADATA_TABLE_NAMES[index] ?? `Table${String(index)}`,
      rowCount,
    ]),
  );
