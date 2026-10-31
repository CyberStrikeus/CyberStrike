/** Keep settled and rejected RPCs in the same receipt before returning control. */
export const createRetainedQueryCaller =
  (client, record) => async (name, input, phase) => {
    const start = performance.now();
    let reply;
    try {
      reply = await client.callTool(
        { name, arguments: input },
        { timeout: 300000 },
      );
    } catch (cause) {
      const failure =
        cause instanceof Error
          ? { name: cause.name, message: cause.message }
          : { name: typeof cause, message: String(cause) };
      const receipt = {
        name,
        input,
        phase,
        elapsed_ms: performance.now() - start,
        reply_bytes: null,
        is_error: true,
        failure,
      };
      try {
        await record(receipt, { name, input, phase, failure });
      } catch (recordingFailure) {
        throw new AggregateError(
          [cause, recordingFailure],
          "MCP call and receipt recording both failed",
        );
      }
      throw cause;
    }
    const receipt = {
      name,
      input,
      phase,
      elapsed_ms: performance.now() - start,
      reply_bytes: Buffer.byteLength(JSON.stringify(reply)),
      is_error: reply.isError === true,
    };
    // A receipt-write failure is distinct from a rejected MCP call.
    await record(receipt, { name, input, phase, reply });
    return reply;
  };
