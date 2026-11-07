import { SqliteDatabaseService } from "../application/sqlite/SqliteDatabaseService.js";
import { SqliteDatabaseProvider } from "../sqlite/SqliteDatabaseProvider.js";

/** Compose local snapshot inspection without opening a native analysis provider. */
export const createSqliteDatabaseService = (
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): SqliteDatabaseService =>
  new SqliteDatabaseService(new SqliteDatabaseProvider(environment));
