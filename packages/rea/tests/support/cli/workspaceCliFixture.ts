import { cliTest } from "./cliFixture.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
  type TestWorkspace,
} from "../workspace/workspaceFixture.js";

/** CLI fixture with an optional test-scoped filesystem workspace. */
export const workspaceCliTest = cliTest.extend<{ workspace: TestWorkspace }>({
  // oxlint-disable-next-line no-empty-pattern -- Vitest parses fixture dependencies from object destructuring.
  workspace: async ({}, use) => {
    const workspace = await createTestWorkspace();
    try {
      await use(workspace);
    } finally {
      await removeTestWorkspace(workspace.root);
    }
  },
});
