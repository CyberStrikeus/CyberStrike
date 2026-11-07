# TUI vs Desktop Gap Analysis

> Generated: 2026-09-30
> Purpose: Systematic comparison of CyberStrike TUI (`packages/cyberstrike/src/cli/cmd/tui/`) vs Desktop UI (`packages/app/`) to identify feature gaps, parity issues, and bugs.

---

## Methodology

Source files analyzed:
- **TUI session:** `tui/routes/session/index.tsx` (2382 lines) — commands, navigation, tool rendering
- **TUI sidebar:** `tui/routes/session/sidebar.tsx` (1077 lines) — all sidebar sections
- **Desktop session:** `app/src/pages/session.tsx` (2425 lines) — main page
- **Desktop sidebar:** `app/src/pages/session/cyberstrike-sidebar.tsx` (1211 lines) — tabbed sidebar
- **Desktop panels:** `app/src/pages/session/cyberstrike-panels.tsx` (884 lines) — panel components
- **Desktop commands:** `app/src/pages/session/use-session-commands.tsx` (967 lines) — slash commands
- **Shared message-part:** `session-ui/src/components/message-part.tsx` — tool rendering incl. Task
- **Desktop timeline:** `app/src/pages/session/timeline/message-timeline.tsx` — message rendering
- **Desktop permission tree:** `app/src/pages/session/composer/session-request-tree.ts` — recursive walk

---

## Executive Summary

Desktop and TUI are closer to parity than expected. Many items suspected as gaps are actually implemented:

- **Sub-session click-to-enter:** WORKS — `message-part.tsx:1978-2017` renders Task tool parts with `navigateToSession` callback, wired via `directory-layout.tsx:67`
- **Permission aggregation:** WORKS — `session-request-tree.ts` does recursive BFS across all child sessions
- **Question aggregation:** WORKS — `session-prompt-dock.tsx` renders questions from child sessions
- **Sidebar data coverage:** Nearly complete — both have the same data accessors and sections

The real gaps are in navigation UX, command aliases, and session lifecycle visibility.

---

## CRITICAL — Functional Gaps Affecting Security Testing

### C1. Sub-session Sibling Cycling (NO DESKTOP EQUIVALENT)

| | TUI | Desktop |
|---|---|---|
| **Cycle siblings** | `moveChild()` at index.tsx:307-318, keybind `session_child_cycle` at :1051-1062 | **MISSING** — no `moveChild` equivalent |
| **Go to parent** | keybind `session_parent` at :1073-1089 | `navigateParent()` at message-timeline.tsx:887-893 — back button in header |
| **Click Task block** | `onClick={() => navigate(...)` at index.tsx:2074-2138 | `data.navigateToSession(id)` in message-part.tsx:2006-2009 — **works** |
| **Sidebar hidden for children** | `if (session()?.parentID) return false` at :163 | Not enforced — sidebar shows same for parent/child |

**Impact:** When 70 sub-sessions spawn, TUI user can Tab/Shift-Tab through them instantly. Desktop user must click each Task block individually in the parent's message timeline — no way to cycle forward/back between siblings without scrolling to find each one.

**Fix:** Add sibling cycling keyboard shortcut + next/prev buttons in the child session header bar.

### C2. Session Completion Status Visibility

| | TUI | Desktop |
|---|---|---|
| **Session working indicator** | Real-time status in TUI chrome — cursor changes, status line shows active/idle | Spinner on the composer only while actively streaming |
| **Sub-session progress** | Visible in sidebar "Context & LLM" section per child | Only in sidebar "Agent Activity" section (collapsed by default) |
| **"Is it done?"** | Clear — TUI prompt returns to input mode when all children complete | **Ambiguous** — no global "all sub-sessions complete" indicator |

**Impact:** User reported "bitti mi bitmedi mi haberim yok" (can't tell if session finished). With 70 sub-sessions, it's impossible to know if work is still in progress or everything has silently completed/failed.

**Fix:** Add a session tree status summary: "12/70 agents active, 58 complete, 0 failed" — visible at all times in the header or sidebar.

### C3. Zero-Vulnerability Root Cause (BACKEND, NOT UI)

This is NOT a TUI vs Desktop gap — it's a backend issue affecting both:

| Signal | Evidence |
|---|---|
| **0 messages in sub-sessions** | 70 children spawned, all with 0 messages — agents never executed |
| **Permission denied** | Backend log: `triage_vulnerability` action=deny |
| **Permission aggregation code is correct** | `session-request-tree.ts` walks full tree correctly |

**Root cause hypothesis:** Backend permission rules deny `triage_vulnerability` for the session. Needs investigation in the backend permission resolver, not the UI.

**Action:** Open issue on CyberStrike-Enterprise, investigate server-side permission handling for `triage_vulnerability`.

---

## HIGH — Missing Features & Polish

### H1. Slash Command Aliases

TUI provides convenience aliases that desktop lacks:

| TUI Command | Desktop Equivalent | Gap |
|---|---|---|
| `/vuln`, `/vulns` | `/vulnerabilities` only | Missing aliases |
| `/web` | No equivalent | Opens web data view (pages/endpoints/roles) |
| `/endpoints` | No equivalent | Opens endpoints view directly |
| `/roles` | No equivalent | Opens roles view directly |
| `/credentials` | No equivalent | Opens credentials view directly |
| `/intel` | No equivalent | Opens intelligence data view |
| `/vrt` | No equivalent | Opens VRT coverage view |
| `/chains` | No equivalent | Opens attack chains view |
| `/summarize` | `/compact` only | Missing alias |
| `/timestamps`, `/toggle-timestamps` | No equivalent | Toggle timestamp display |
| `/pin` | No equivalent | Pin message for reference |

Desktop has commands TUI doesn't (expected, UI-specific):
- `/new`, `/open`, `/terminal`, `/status`, `/help`, `/bolt`, `/skills`

**Fix:** Add missing aliases + data view shortcuts to `use-session-commands.tsx`. The `/web`, `/endpoints`, `/roles`, `/credentials` commands should switch the cyberstrike sidebar to the appropriate tab and section.

### H2. Sidebar Tab Switching Shortcuts

TUI sidebar is a single scrollable list — user scrolls to the section they need. Desktop sidebar has 5 tabs (Overview, HackBrowser, Vortex, Vulns, Servers), but:

- No keyboard shortcut to switch between tabs
- No slash commands to jump to a specific tab/section
- The `/web`, `/endpoints`, etc. TUI commands could naturally map to switching sidebar tabs

**Fix:** Map `/hackbrowser` to also switch sidebar to HackBrowser tab, `/vulnerabilities` to Vulns tab, etc.

### H3. Vortex Captures Section

| | TUI Sidebar | Desktop Sidebar |
|---|---|---|
| **Captures section** | Full captures with Pages/Endpoints/JS sub-views (sidebar.tsx:605-764) | Split across HackBrowser tab — Pages, Endpoints, JS Files present |
| **Observations/Endpoint tree** | Flat list | Tree view with observation children (cyberstrike-panels.tsx) — **Desktop is better** |
| **Signals** | Inline in sidebar (sidebar.tsx:559-604) | Separate "Vortex" tab |

No functional gap — data is the same, organization differs. Desktop actually has a richer endpoint tree view.

### H4. Objects & Functions Sections

| | TUI | Desktop |
|---|---|---|
| **Objects** | sidebar.tsx:831-860 | HackBrowser tab — present |
| **Functions** | sidebar.tsx:861-904 with "JS Functions" header | HackBrowser tab — present |

Present in both. No gap.

---

## MEDIUM — UX Differences

### M1. Sidebar Section Organization

TUI has everything in one scrollable list (17+ sections). Desktop splits across 5 tabs:

| Desktop Tab | Sections |
|---|---|
| **Overview** | Context, Cost & Usage, Messages, Token Breakdown, Agent Activity, Finish Reasons, Ingest Queue, Methodology, Phase & Inspection, Todo, Modified Files |
| **HackBrowser** | Status, Pages, Endpoints, JS Files, Roles, Credentials, Objects, Functions |
| **Vortex** | Signals list |
| **Vulns** | Vulnerabilities by status, Inspection Queue |
| **Servers** | MCP Servers (with toggles), Bolt (with toggles) |

This is a design choice, not a gap. Desktop tab organization is arguably better for discoverability. However, it means the user must switch tabs to see cross-cutting data (e.g., seeing vulnerabilities while looking at endpoints).

### M2. Desktop Has MORE Metrics Than TUI

Desktop-only metrics (via `SessionMetrics` class):
- Token Breakdown (input/output/reasoning/cache read/cache write)
- Agent Activity distribution (name, count, cost per agent)
- Finish Reasons breakdown
- Context usage progress bar with percentage
- Average cost per message
- Cache hit rate
- Cumulative vs current token view
- Session duration
- Compaction count

TUI "Context & LLM" section shows a simpler view: model, tokens used, context window remaining.

### M3. Sidebar Visibility for Child Sessions

TUI hides the sidebar when viewing a child session (`if (session()?.parentID) return false` at index.tsx:163). Desktop always shows the sidebar regardless of parent/child — data may not be meaningful for a child session since it's scoped to the parent.

**Impact:** Minor UX confusion — child session sidebar shows parent's data or empty data.

**Consider:** Either scope sidebar data to current session, or add a "viewing child session" indicator.

### M4. Keyboard Shortcuts

| Action | TUI | Desktop |
|---|---|---|
| Cycle child sessions | `Tab` / `Shift+Tab` | Not available |
| Go to parent | Dedicated keybind | Back button click only |
| Toggle sidebar | N/A (always visible) | Not mapped (could add) |
| Toggle thinking | Keybind available | `/thinking` command only |
| Toggle timestamps | Keybind available | Not available |

---

## LOW — Cosmetic & Minor

### L1. MCP Server Status Display

| | TUI | Desktop |
|---|---|---|
| **MCP display** | Name + tool count in sidebar | Name + tool count + toggle switch |
| **Enable/disable** | Command-based | Visual toggle switch — **Desktop is better** |

### L2. Bolt Template Display

| | TUI | Desktop |
|---|---|---|
| **Bolt display** | Name + status in sidebar | Name + description + toggle switch |
| **Browse templates** | Command-based | `/bolt` opens dialog — **Desktop is better** |

### L3. Vulnerability Detail View

| | TUI | Desktop |
|---|---|---|
| **Expand/collapse** | Inline expand in sidebar | Full expand with CWE, severity badge, copy button |
| **Grouped by status** | confirmed/potential/informational | Same grouping with color-coded badges — **Desktop is better** |

### L4. Modified Files Section

Both have it. Desktop includes it in the Overview tab. TUI at sidebar.tsx:988-1024. No gap.

---

## Verified NON-GAPS (Previously Suspected)

These were investigated and confirmed working in desktop:

| Feature | Status | Evidence |
|---|---|---|
| Sub-session click-to-enter | **WORKS** | `message-part.tsx:1978-2017`, `directory-layout.tsx:67` |
| Permission aggregation | **WORKS** | `session-request-tree.ts` recursive BFS |
| Question aggregation | **WORKS** | `session-prompt-dock.tsx` renders child questions |
| Vulnerability display | **WORKS** | `cyberstrike-panels.tsx:VulnsPanelList`, `cyberstrike-sidebar.tsx` Vulns tab |
| Methodology display | **WORKS** | Sidebar Overview tab with VRT coverage progress bar |
| Ingest Queue display | **WORKS** | Sidebar Overview tab |
| Phase & Inspection | **WORKS** | Sidebar Overview tab with lifecycle phases |
| HackBrowser status | **WORKS** | Sidebar HackBrowser tab + launch/stop commands |
| Queue pause/resume | **WORKS** | `/qpause` and `/qresume` commands |
| Report generation | **WORKS** | `/report` command |
| Session export | **WORKS** | `/export` command |

---

## Priority Action Items

| # | Priority | Item | Effort |
|---|---|---|---|
| 1 | **CRITICAL** | Add sibling cycling (Tab/Shift-Tab between child sessions) | Medium |
| 2 | **CRITICAL** | Add session tree status summary ("X/Y agents complete") | Medium |
| 3 | **CRITICAL** | Investigate backend `triage_vulnerability` permission denial | Backend |
| 4 | **HIGH** | Add missing slash command aliases (vuln/vulns, summarize, web, endpoints, roles, credentials) | Small |
| 5 | **HIGH** | Add `/web`, `/endpoints`, `/roles`, `/credentials` as sidebar tab shortcuts | Small |
| 6 | **HIGH** | Wire slash commands to switch sidebar tabs (hackbrowser→HackBrowser tab, etc.) | Small |
| 7 | **MEDIUM** | Add keyboard shortcuts for sidebar tab switching | Small |
| 8 | **MEDIUM** | Scope sidebar data to current session when viewing child | Medium |
| 9 | **MEDIUM** | Add timestamp toggle | Small |
| 10 | **LOW** | Add `/pin` command | Small |

---

## Conclusion

The desktop app is significantly more feature-complete than initially suspected. The primary gap is **navigation UX** — specifically cycling between sibling sub-sessions and knowing when all agents have completed. The sidebar data coverage and command coverage are nearly at parity. The 0-vulnerability issue is a backend problem, not a desktop UI gap.

Desktop actually exceeds TUI in several areas: richer metrics (SessionMetrics class), visual toggle switches for MCP/Bolt, endpoint observation tree, vulnerability detail cards with CWE/copy, and a tabbed sidebar organization.
