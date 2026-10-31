export const MCP_CONNECTION_LOST =
  "Retry the tool call once only when it is safe to repeat or known not to have started. If it may already have changed the target, or it fails again, tell the user REA lost its MCP client connection and ask them to restart the MCP client.";
export const MCP_VALIDATION_FAILED =
  "MCP message validation failed. Check the protocol fields before retrying a message that is safe to repeat. Continue using the connection while it remains responsive.";
export const MCP_TRANSPORT_ERROR =
  "MCP reported an error with unknown connection state. Check whether the client is still connected before following connection-loss recovery.";
export const MCP_CONNECTION_START_FAILED =
  "Retry once. If it fails again, tell the user REA could not start its MCP connection and ask them to restart the MCP client, then run `rea doctor`.";
export const MCP_SHUTDOWN_FAILED =
  "REA could not close cleanly. End the REA process before starting it again.";
export const SERVER_START_FAILED =
  "Do not repeat this startup. Tell the user REA could not start and ask them to restart the MCP client, then run `rea doctor`.";
export const MCP_HTTP_LISTEN_FAILED =
  "REA could not listen for MCP HTTP connections on the selected host and port. Choose another --port or stop the process using it.";
