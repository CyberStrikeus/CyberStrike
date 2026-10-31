import { connectRecordedCrash } from "./public.mjs";
import assert from "node:assert/strict";

const session = await connectRecordedCrash({
  entrypoint: process.argv[2],
  environment: process.env,
});
try {
  const report = await session.inspect("mcp", process.argv[3], {
    debuggerContext: true,
  });
  const historicalPid = Number(process.argv[4]);
  assert.ok(
    report.threads.some((thread) => thread.historical_pid === historicalPid),
    "MCP must decode the selected historical-PID control before its trace qualifies",
  );
} finally {
  await session.close();
}
