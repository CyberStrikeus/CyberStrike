-- protocol-operation: model GraphQL/JSON-RPC operations as first-class endpoints.
--
-- Body/header-dispatched protocols carry the real operation in the body, not the
-- URL. op_key_hash is a per-operation dedup key (values stripped) used in place of
-- body_hash for these protocols so same-operation/different-values calls collapse
-- while distinct operations stay distinct. REST rows leave all three columns null.
ALTER TABLE request ADD COLUMN protocol TEXT;
--> statement-breakpoint
ALTER TABLE request ADD COLUMN operation TEXT;
--> statement-breakpoint
ALTER TABLE request ADD COLUMN op_key_hash TEXT;
