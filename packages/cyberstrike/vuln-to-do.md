# Vulnerability feature – step-by-step plan

Session’a zafiyet (vulnerability) ekleme: tablo, tool, API, TUI panel. Referans: **Todo** (tablo, namespace, tool, permission, API, event, TUI sidebar).

---

## 1. Schema & DB

- **Dosya:** `src/session/session.sql.ts`
  - Yeni tablo: `VulnerabilityTable` (veya `SessionVulnerabilityTable`).
  - Alanlar (snake_case, AGENTS.md): `id` (PK), `session_id` (FK → SessionTable, onDelete: cascade), `severity` (text), `title` (text), `description` (text), `cwe_id` (text, nullable), `file` (text, nullable), `line_start` / `line_end` (integer, nullable), `evidence` (text, nullable), `recommendation` (text, nullable), `status` (text: open/fixed/ignored), `position` (integer, sıralama), `message_id` (text, nullable, FK → MessageTable – nerede raporlandı), `...Timestamps`.
  - İndeks: `vulnerability_session_idx` on `session_id`; isteğe bağlı `vulnerability_severity_idx`.
- **Dosya:** `src/storage/schema.ts`
  - Export ekle: `VulnerabilityTable` (session.sql’den).
- **Migration**
  - `bun run db generate --name add_vulnerability` (drizzle.config.ts schema: `./src/**/*.sql.ts`).
  - Oluşan `migration/<timestamp>_add_vulnerability/migration.sql`’i uygula (veya mevcut migration akışına ekle).

---

## 2. Session domain – Vulnerability namespace

- **Dosya:** `src/session/vulnerability.ts` (yeni)
  - Zod: `Vulnerability.Info` (severity, title, description, cwe_id?, file?, line_start?, line_end?, evidence?, recommendation?, status, position?, message_id? + time).
  - `Vulnerability.Event.Updated` (veya `Added`/`Updated` ayrı): `vulnerability.updated` – payload: `sessionID`, `vulnerabilities: Vulnerability.Info[]` (Todo gibi liste güncellenince) veya tek kayıt eklenince `vulnerability.added` + `vulnerability.updated` (liste için).
  - `Vulnerability.add(sessionID, info)` veya `Vulnerability.update(sessionID, vulnerabilities[])`: DB insert/update + `Bus.publish(Event.Updated, …)`.
  - `Vulnerability.get(sessionID)`: session’a ait tüm zafiyetleri `position`/id sırasına göre döndür.
  - Todo’daki gibi: `update` tüm listeyi replace edebilir veya sadece `add` tek kayıt ekleyebilir. Tool tek kayıt ekleyecekse `add` yeterli; TUI’da “tüm liste” göstermek için `get` kullanılır.

---

## 3. Tool – report_vulnerability

- **Dosya:** `src/tool/vulnerability.ts` (yeni)
  - `Tool.define("report_vulnerability", { description, parameters, execute })`.
  - Description: `src/tool/report_vulnerability.txt` (veya `vulnerability.txt`) – “When you find a security vulnerability, call this tool to record it in the session.”
  - Parameters: severity (enum: critical/high/medium/low/info), title, description; optional: cwe_id, file, line_start, line_end, evidence, recommendation, status (default open).
  - execute: `ctx.ask({ permission: "report_vulnerability", patterns: ["*"], … })` → `Vulnerability.add(ctx.sessionID, { … })` → return `{ title, output, metadata: { vulnerability } }`.
- **Dosya:** `src/tool/registry.ts`
  - Import ve `all()` listesine `ReportVulnerabilityTool` (veya benzeri isim) ekle.
- **CLI run – tool render**
  - **Dosya:** `src/cli/cmd/run.ts`
  - Tool switch’e `part.tool === "report_vulnerability"` ekle; ilgili tool’un props’u ile bir `vulnerability(…)` render fonksiyonu çağır (inline/block, Todo benzeri).

---

## 4. Permission & config

- **Dosya:** `src/agent/agent.ts`
  - İlgili agent’ların `permission` merge’üne `report_vulnerability: "deny"` veya güvenlik agent’ları için `allow` ekle (örn. web-application, cloud-security, mobile-application agent’larında allow).
- **Dosya:** `src/config/config.ts`
  - Permission config şemasına `report_vulnerability: PermissionAction.optional()` ekle (todoread/todowrite gibi).
- **Dosya:** `src/cli/cmd/agent.ts`
  - Tool listesine `"report_vulnerability"` ekle (varsa).
- **Dosya:** `src/cli/cmd/github.ts`
  - Tool etiketleme map’ine `report_vulnerability: ["Vulnerability", UI.Style.…]` ekle (opsiyonel).

---

## 5. API – session routes

- **Dosya:** `src/server/routes/session.ts`
  - `GET /:sessionID/vulnerability` (veya `/vulnerabilities`): describeRoute (operationId: `session.vulnerability` veya `session.vulnerabilities`), validator param `sessionID`, handler: `Vulnerability.get(sessionID)` → `c.json(list)`.
  - OpenAPI schema: `resolver(Vulnerability.Info.array())`. Bu sayede SDK regenerate’de `session.vulnerability()` ve `Vulnerability` tipi üretilir.

---

## 6. TUI – sync & sidebar

- **SDK tipleri:** `bun dev generate` (cyberstrike) + `./packages/sdk/js/script/build.ts` ile OpenAPI/SDK yeniden üretildikten sonra `Vulnerability` ve `EventVulnerabilityUpdated` (veya eklenen event adı) tipleri gelir.
- **Dosya:** `src/cli/cmd/tui/context/sync.tsx`
  - Store’a `vulnerability: { [sessionID: string]: Vulnerability[] }` ekle (initial: `vulnerability: {}`).
  - `sdk.event.listen`: `case "vulnerability.updated"` (veya `vulnerability.added`): `setStore("vulnerability", event.properties.sessionID, event.properties.vulnerabilities)` (veya tek kayıt ise listeyi merge et).
  - `sync(sessionID)` içinde `Promise.all`’a `sdk.client.session.vulnerability({ sessionID })` ekle; gelen listeyi `draft.vulnerability[sessionID] = …` ile yaz.
- **Dosya:** `src/cli/cmd/tui/routes/session/sidebar.tsx`
  - `vulnerability` memo: `sync.data.vulnerability[props.sessionID] ?? []`.
  - `expanded` store’a `vulnerability: true` ekle.
  - Todo bloğuna benzer blok: “Vulnerabilities” başlığı, uzun listeyse expand/collapse, `For each={vulnerability()}` ile severity + title (ve varsa file) göster; tıklanınca expand veya detay (opsiyonel).
- **Bileşen (opsiyonel):** `src/cli/cmd/tui/component/vulnerability-item.tsx` – severity rengi, title, file:line kısa satırı (TodoItem gibi).

---

## 7. Event tipi (OpenAPI / SDK)

- Server’da Bus event’i zaten `Vulnerability.Event.Updated` ile yayınlanacak. OpenAPI’da event şemasının çıkması için server’ın event tiplerini export edip describeRoute/resolver kullanan bir yerde veya ayrı bir event schema tanımında `EventVulnerabilityUpdated` (veya `vulnerability.updated`) tanımlı olmalı. Mevcut projede `todo.updated` nasıl OpenAPI’a düşüyorsa (hono-openapi + resolver) aynı pattern’i kullan: event payload’ı için Zod şema + ref. Gerekirse `src/server/` veya event schema dosyasında `vulnerability.updated` event tipini ekle; SDK build’de types.gen.ts’e yansır.

---

## 8. Prompt – güvenlik agent’ları

- **Dosyalar:** `src/agent/prompt/web-application.txt`, `mobile-application.txt`, `cloud-security.txt`, `web-proxy-agent.txt` (ilgili olanlar)
  - “When you identify a security vulnerability, use the report_vulnerability tool to record it: severity, title, description, and optionally file, line, evidence, recommendation.” gibi bir cümle ekle.

---

## 9. ACP (opsiyonel)

- **Dosya:** `src/acp/agent.ts`
  - Todo’da olduğu gibi, `part.tool === "report_vulnerability"` ve `part.state.status === "completed"` olduğunda ACP’ye session update (vulnerability listesi veya “vulnerability added”) göndermek istenirse, burada da branch eklenebilir. Öncelik düşük; önce TUI ve CLI akışı tamamlanabilir.

---

## 10. SDK regeneration (optional, for full typing)

- Run from repo root: `cd packages/cyberstrike && bun dev generate` (or start server and export OpenAPI), then `./packages/sdk/js/script/build.ts`. This adds `session.vulnerability()` and `EventVulnerabilityUpdated` to the SDK. Until then, TUI uses a typed `sessionClient.vulnerability?.(...)` and handles `vulnerability.updated` in the event listener’s `default` case.

## 11. Test & migration

- **Migration test:** Mevcut migration test’leri `migration/` layout’unu okuyor; yeni migration klasörünü ekleyip schema’nın uygulandığını doğula.
- **Birim test:** `src/session/vulnerability.ts` için `Vulnerability.get`, `Vulnerability.add` (ve event’in publish edildiği) testi; `test/session/vulnerability.test.ts` (veya mevcut session test dosyasına ek).
- **Tool test:** `test/tool/` altında report_vulnerability için bir test (permission + execute → DB’de kayıt var mı).
- **JSON migration:** Eski JSON’dan SQL’e migration yok (yeni özellik); `src/storage/json-migration.ts`’e vulnerability ile ilgili bir şey eklenmez. Sadece yeni tablo Drizzle migration ile gelir.

---

## Sıra özeti

| # | Adım | Dosyalar |
|---|------|----------|
| 1 | Schema + migration | session.sql.ts, schema.ts, `db generate` |
| 2 | Vulnerability namespace | session/vulnerability.ts (get, add, Event) |
| 3 | Tool + registry + run.ts render | tool/vulnerability.ts, report_vulnerability.txt, registry.ts, run.ts |
| 4 | Permission & config | agent.ts, config.ts, cli/cmd/agent.ts, github.ts |
| 5 | API route | server/routes/session.ts GET :sessionID/vulnerability |
| 6 | TUI sync + sidebar | tui/context/sync.tsx, tui/routes/session/sidebar.tsx, (vulnerability-item.tsx) |
| 7 | Event schema (SDK) | Event tipleri OpenAPI’da (mevcut event pattern’i) |
| 8 | Prompts | agent/prompt/*.txt (web-application, cloud-security, vb.) |
| 9 | ACP (opsiyonel) | acp/agent.ts |
| 10 | Test + SDK rebuild | test/session, test/tool, sdk build |

SDK’yı son olarak yeniden üret: cyberstrike’da `bun dev generate`, ardından `./packages/sdk/js/script/build.ts`. TUI ve app, yeni `session.vulnerability()` ve `Vulnerability` tipi ile derlenir.
