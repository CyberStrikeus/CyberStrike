import { expect, it } from "vitest";

import { createProcessCaptureJournal } from "./ProcessCaptureJournal.js";

it("records capture events in monotonic observation order", () => {
  const journal = createProcessCaptureJournal();
  journal.recordEvent("filesystem_checkpoints", 0);
  journal.recordEvent("lifecycle", 0);
  journal.recordEvent("frames", 0);
  journal.recordEvent("filesystem_checkpoints", 1);

  expect(journal.entries).toEqual([
    { capture_order: 0, collection: "filesystem_checkpoints", index: 0 },
    { capture_order: 1, collection: "lifecycle", index: 0 },
    { capture_order: 2, collection: "frames", index: 0 },
    { capture_order: 3, collection: "filesystem_checkpoints", index: 1 },
  ]);
});
