/** Accept a Frida host address, optionally with a TCP port, without URL credentials or paths. */
export const isValidFridaRemoteAddress = (address: string): boolean => {
  if (address.length === 0 || address.length > 2048) return false;
  if (/[?@#\s\u0000-\u001f\u007f/]/u.test(address)) return false;
  if (address.endsWith(":")) return false;
  try {
    const parsed = new URL(`tcp://${address}`);
    const port = parsed.port === "" ? undefined : Number(parsed.port);
    return (
      parsed.hostname.length > 0 &&
      (port === undefined || (port > 0 && port <= 65_535)) &&
      parsed.username.length === 0 &&
      parsed.password.length === 0 &&
      (parsed.pathname === "" || parsed.pathname === "/") &&
      parsed.search.length === 0 &&
      parsed.hash.length === 0
    );
  } catch {
    return false;
  }
};
