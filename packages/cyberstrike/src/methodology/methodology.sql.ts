import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"
import { Timestamps } from "../storage/schema.sql"

// ============================================================================
// Methodology Engine Tables — Intelligence, Coverage, Chain Detection
// CyberStrike methodology engine — SQLite/Drizzle persistence
// ============================================================================

/**
 * Intelligence entries discovered during testing.
 * Stores endpoints, subdomains, technologies, credentials, parameters, etc.
 * Central knowledge base — agents log everything here, coverage is computed from this.
 */
export const IntelEntryTable = sqliteTable(
  "intel_entry",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    type: text().notNull(), // endpoint, subdomain, technology, credential, parameter, vulnerability_hint, configuration, api_schema, authentication_flow, business_rule, sensitive_data, infrastructure
    severity: text(), // critical, high, medium, low, info
    title: text().notNull(),
    detail: text(),
    source: text(), // agent name that discovered this
    asset: text().notNull(), // target domain/IP
    confidence_level: text(), // confirmed, high, medium, low
    tags: text({ mode: "json" }).$type<string[]>(),
    chain_potential: text(),
    related_entries: text({ mode: "json" }).$type<string[]>(),
    status: text().notNull(), // new, investigating, tested, exploited, reported
    position: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("intel_entry_session_idx").on(table.session_id),
    index("intel_entry_type_idx").on(table.type),
    index("intel_entry_asset_idx").on(table.asset),
    index("intel_entry_compound_idx").on(table.session_id, table.asset, table.type),
  ],
)

/**
 * VRT (Vulnerability Rating Taxonomy) checklist items.
 * Auto-generated per intel entry based on entry type.
 * Tracks what has been tested and what remains.
 */
export const VrtCheckTable = sqliteTable(
  "vrt_check",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    intel_entry_id: text()
      .notNull()
      .references(() => IntelEntryTable.id, { onDelete: "cascade" }),
    vrt_category: text().notNull(),
    vrt_path: text(),
    status: text().notNull(), // pending, tested_vulnerable, tested_not_vulnerable, not_applicable
    technique: text(),
    tested_by: text(), // agent name
    tested_at: integer(),
    evidence: text({ mode: "json" }).$type<{
      requestSent?: string
      responseCode?: number
      responseSummary?: string
      reasoning?: string
      requestCount?: number
      findingRef?: string
    }>(),
    ...Timestamps,
  },
  (table) => [
    index("vrt_check_entry_idx").on(table.intel_entry_id),
    index("vrt_check_session_idx").on(table.session_id),
    index("vrt_check_status_idx").on(table.session_id, table.status),
  ],
)

/**
 * 13-phase methodology progression tracking.
 * Phase status is primarily computed from intel entry tags, but this table
 * caches the computed state and stores explicit completion evidence.
 */
export const MethodologyPhaseTable = sqliteTable(
  "methodology_phase",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    phase_id: text().notNull(), // scope_analysis, passive_recon, active_recon, technology_profiling, authentication_testing, session_management, authorization_testing, input_validation, business_logic, data_protection, api_security, infrastructure, reporting
    status: text().notNull(), // not_started, in_progress, completed, blocked
    completion_evidence: text(),
    deliverable_count: integer().notNull().default(0),
    block_reason: text(),
    started_at: integer(),
    completed_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("methodology_phase_session_idx").on(table.session_id),
    index("methodology_phase_lookup_idx").on(table.session_id, table.phase_id),
  ],
)

/**
 * Detected vulnerability chain candidates.
 * When multiple low-severity findings combine into a high-impact chain,
 * they are recorded here for targeted testing.
 */
export const ChainCandidateTable = sqliteTable(
  "chain_candidate",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    pattern: text().notNull(), // auth_bypass_chain, privilege_escalation_chain, ssrf_to_rce_chain, xss_to_account_takeover, sqli_to_data_exfil, csrf_to_state_change, idor_to_data_leak, open_redirect_to_phishing
    entry_ids: text({ mode: "json" }).$type<string[]>(),
    entry_titles: text({ mode: "json" }).$type<string[]>(),
    assets: text({ mode: "json" }).$type<string[]>(),
    expected_impact: text(),
    severity: text(),
    testing_plan: text(),
    status: text().notNull(), // detected, testing, confirmed, disproven
    confidence: real().notNull().default(0.5),
    detected_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("chain_candidate_session_idx").on(table.session_id),
    index("chain_candidate_status_idx").on(table.session_id, table.status),
  ],
)

/**
 * Agent performance tracking (Liyakat scoring).
 * Tracks missions, findings, coverage contribution, and evidence quality per agent.
 * Used for agent selection and performance-based prompt augmentation.
 */
export const AgentPerformanceTable = sqliteTable(
  "agent_performance",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    agent_name: text().notNull(),
    missions_completed: integer().notNull().default(0),
    findings_reported: integer().notNull().default(0),
    chains_contributed: integer().notNull().default(0),
    turns_used: integer().notNull().default(0),
    success_rate: real().notNull().default(0),
    coverage_contributed: integer().notNull().default(0),
    rejection_count: integer().notNull().default(0),
    average_evidence_quality: real().notNull().default(0),
    performance_score: real().notNull().default(0),
    morale: integer().notNull().default(70),
    motivation: text(),
    ...Timestamps,
  },
  (table) => [
    index("agent_performance_session_idx").on(table.session_id),
    index("agent_performance_agent_idx").on(table.session_id, table.agent_name),
  ],
)

/**
 * Methodology and evidence quality violations.
 * Generated when agents skip phases, submit insufficient evidence,
 * inflate severity, or violate scope.
 */
export const ValidationViolationTable = sqliteTable(
  "validation_violation",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    gate: text().notNull(), // methodology_ordering, evidence_quality, triager_check, per_asset_coverage, owasp_coverage, methodology_progress, iterative_depth
    severity: text().notNull(), // blocking, warning
    message: text().notNull(),
    affected_entry_id: text(),
    affected_asset: text(),
    field: text(),
    expected_value: text(),
    actual_value: text(),
    resolved: integer().notNull().default(0), // boolean: 0 = unresolved, 1 = resolved
    ...Timestamps,
  },
  (table) => [
    index("validation_violation_session_idx").on(table.session_id),
    index("validation_violation_severity_idx").on(table.session_id, table.severity),
  ],
)
