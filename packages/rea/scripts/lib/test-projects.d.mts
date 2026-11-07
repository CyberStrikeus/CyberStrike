export interface TestProjectDefinition {
  readonly name: string;
  readonly group: "source" | "built";
  readonly isolate?: boolean;
  readonly include: readonly string[];
  readonly exclude?: readonly string[];
}

export const SOURCE_TEST_PROJECTS: readonly TestProjectDefinition[];
export const BUILT_TEST_PROJECTS: readonly TestProjectDefinition[];
export function projectForTest(testPath: string): TestProjectDefinition;
