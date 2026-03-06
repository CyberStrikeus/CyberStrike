import { defineConfig } from "drizzle-kit"
import path from "path"
import os from "os"

const dataDir =
  process.env.XDG_DATA_HOME ||
  (process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support")
    : path.join(os.homedir(), ".local", "share"))

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/**/*.sql.ts",
  out: "./migration",
  dbCredentials: {
    url: path.join(dataDir, "cyberstrike", "cyberstrike.db"),
  },
})
