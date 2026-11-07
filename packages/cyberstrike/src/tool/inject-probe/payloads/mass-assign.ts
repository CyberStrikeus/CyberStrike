// Mass Assignment (WSTG-INPV-20) — a curated set of privilege / ownership / entitlement field names an
// app should NEVER let a client set on a write. The probe ADDS one of these to a write body with a
// unique marker value; the server ACCEPTING + echoing it back is a high-signal binding lead. The list
// is deliberately privilege-heavy (not generic fields like "name"/"status") to keep precision — the
// agent then escalates a confirmed binding with the real value (role=admin, isAdmin=true) to prove impact.
export const MASS_ASSIGN_FIELDS: string[] = [
  "role",
  "roles",
  "is_admin",
  "isAdmin",
  "admin",
  "is_staff",
  "is_superuser",
  "superuser",
  "is_active",
  "approved",
  "is_approved",
  "verified",
  "is_verified",
  "email_verified",
  "owner",
  "owner_id",
  "ownerId",
  "user_id",
  "userId",
  "account_id",
  "org_id",
  "organization_id",
  "tenant_id",
  "permissions",
  "perms",
  "scopes",
  "scope",
  "plan",
  "tier",
  "subscription",
  "account_type",
  "credit",
  "credits",
  "balance",
  "is_paid",
  "paid",
]

export const MASS_ASSIGN_NOT_TESTED =
  "mass-assignment: privilege-VALUE escalation (agent sets role=admin / isAdmin=true and confirms impact); nested/dotted body paths beyond top-level; binding via query/path (body only); type-strict boolean fields a string marker can't probe"
