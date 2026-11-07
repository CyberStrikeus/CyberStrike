import { expect, it, vi } from "vitest";
import {
  openRegularFile,
  RegularFileChangedError,
} from "../../filesystem/RegularFile.js";
import { PyInstallerArtifactReader } from "../PyInstallerArtifactReader.js";

vi.mock("../../filesystem/RegularFile.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../filesystem/RegularFile.js")>();
  return { ...actual, openRegularFile: vi.fn(actual.openRegularFile) };
});

it("classifies a source replacement during admission as an integrity failure", async () => {
  const path = "/selected/app";
  const changed = new RegularFileChangedError(path);
  vi.mocked(openRegularFile).mockRejectedValueOnce(changed);
  const reader = new PyInstallerArtifactReader(path);
  try {
    await expect(reader.prepareContainer("0".repeat(64))).rejects.toMatchObject(
      {
        reason: "integrity",
        message: `PyInstaller source changed during admission: ${path}`,
      },
    );
    expect(openRegularFile).toHaveBeenCalledWith(path, {
      symlinks: "reject",
      signal: expect.any(AbortSignal),
    });
  } finally {
    await reader.close();
  }
});
