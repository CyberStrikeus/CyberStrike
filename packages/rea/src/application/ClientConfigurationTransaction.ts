import { resolve } from "node:path";

const activeTransactions = new Map<string, Promise<void>>();

/**
 * Serialize the full read/merge/publish operation for one resolved
 * configuration path.
 */
export const withClientConfigurationTransaction = async <Value>(
  path: string,
  operation: () => Promise<Value>,
): Promise<Value> => {
  const key = resolve(path);
  const previous = activeTransactions.get(key);
  let release!: () => void;
  const current = new Promise<void>((complete) => {
    release = complete;
  });
  activeTransactions.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (activeTransactions.get(key) === current) activeTransactions.delete(key);
  }
};
