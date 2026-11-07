-- Retire the CS signal fabric (#15). Vortex is now the single signal producer: the web_signal and
-- web_canary stores (created by 20260905000000_web-signal-fabric) are no longer read or written by any
-- code, and signal.sql.ts was deleted from the Drizzle schema. Drop the now-orphan tables. DROP TABLE
-- removes their indexes with them in SQLite; IF EXISTS keeps this idempotent across re-applied runs.
DROP TABLE IF EXISTS web_signal;
--> statement-breakpoint
DROP TABLE IF EXISTS web_canary;
