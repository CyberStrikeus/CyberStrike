import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const attempt = async (failures, phase, action) => {
  try {
    await action();
    return true;
  } catch (cause) {
    failures.push(`${phase}: ${String(cause)}`);
    return false;
  }
};

const writeReceipt = (stream, text) =>
  new Promise((resolve, reject) => {
    const onError = (cause) => reject(cause);
    stream.once("error", onError);
    try {
      stream.write(text, (cause) => {
        if (cause !== null && cause !== undefined) {
          // A Writable emits its error after notifying the write callback.
          reject(cause);
        } else {
          stream.off("error", onError);
          resolve();
        }
      });
    } catch (cause) {
      stream.off("error", onError);
      reject(cause);
    }
  });

/** Preserve task costs through independent cleanup and receipt-output failures. */
export const finalizeRetainedQueryReceipt = async ({
  report,
  client,
  transport,
  account,
  serverLog,
  serverLogFinished,
  output,
  transcript,
  stdout = process.stdout,
}) => {
  report.cleanup_failures = [];
  await Promise.all([
    ...(client === undefined
      ? []
      : [attempt(report.cleanup_failures, "client", () => client.close())]),
    ...(transport === undefined
      ? []
      : [
          attempt(report.cleanup_failures, "transport", () =>
            transport.close(),
          ),
        ]),
  ]);
  if (serverLog !== undefined)
    await attempt(report.cleanup_failures, "server-log", async () => {
      if (!serverLog.writableEnded) serverLog.end();
      await serverLogFinished;
    });
  if (account !== undefined && report.cleanup_failures.length === 0)
    await attempt(report.cleanup_failures, "workspace", () =>
      rm(account, { recursive: true }),
    );
  if (account !== undefined && report.cleanup_failures.length > 0)
    report.retained_workspace = account;

  return publishRetainedQueryReceipt({ report, output, transcript, stdout });
};

/** Share atomic publication and failure accounting with non-MCP phase probes. */
export const publishRetainedQueryReceipt = async ({
  report,
  output,
  transcript,
  stdout = process.stdout,
}) => {
  report.receipt_failures = [];
  if (transcript !== undefined)
    await attempt(report.receipt_failures, "transcript-file", () =>
      writeFile(join(output, "transcript.json"), JSON.stringify(transcript)),
    );
  let publication = 0;
  const saveReport = async () => {
    // Keep failed publications in the owned output directory for inspection.
    // A partial retry must never truncate an already published cost receipt.
    const pending = join(output, `.report-${++publication}.json.pending`);
    await writeFile(pending, JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
    });
    await rename(pending, join(output, "report.json"));
  };
  await attempt(report.receipt_failures, "report-file", saveReport);
  const stdoutWritten = await attempt(report.receipt_failures, "stdout", () =>
    writeReceipt(stdout, JSON.stringify(report) + "\n"),
  );
  // Preserve a broken stdout diagnostic in the file that may already exist.
  if (!stdoutWritten)
    await attempt(report.receipt_failures, "report-file-retry", saveReport);
  return (
    report.cleanup_failures.length === 0 && report.receipt_failures.length === 0
  );
};
