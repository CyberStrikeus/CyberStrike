# CyberStrike Browser Agent — Panel UI Brief

> Hackbrowser (Playwright + LLM pentest crawler) tarayıcı pencerelerinde
> hedef sayfanın **üstüne** live telemetry gösteren bir panel enjekte eder.
> Panel bir pentesteri etkilemelidir ("oha, vaow"): canlı akan HTTP capture'lar,
> agent'ın o an ne yaptığı, mutation'lar, multi-credential context, intelligence
> tetiklemeleri. Dark-terminal estetiği + neon accent beklenir.
>
> Bu brief UI agent'ına (ayrı ekip / model) tek başına self-contained rehberdir.
> Hackbrowser tarafındaki kod dokunuşları da ayrı bir bölümde listelendi.

---

## 1. Amaç

**Hedef kitle:** Pentester / security engineer — birisi `bun start <target>`
komutunu çalıştırdığında Chromium penceresi açılır, hedef site yüklenir, panel
sağ-altta belirir. Agent crawl'e başladığında panelde canlı akan veri hemen fark
edilmelidir.

**Başarı kriteri:**
- İlk 3 saniye içinde gözle görülür hareket (pulse, flash, counter artışı)
- Kullanıcı 30 saniye izlediğinde ne olduğunu anlar ("agent endpoint buluyor")
- Sayfanın asıl içeriğini bozmaz / kaplamaz
- Agent akışını etkilemez (target elementler fareyle/Playwright ile tıklanabilir)

---

## 2. Display Modes (iki seviye)

### Mode A — Mini Card (default, her zaman görünür)

**Boyut:** yaklaşık `320×180px`, sağ-alt köşede sabit (`position: fixed; bottom: 16px; right: 16px`).

**İçerik yerleşimi:**
```
┌─────────────────────────────┐
│ 🛡 CS · admin · page 5/8    │ ← credential + page progress (sabit)
├─────────────────────────────┤
│ ▶ Clicking "Delete Alice"   │ ← current action (canlı güncellenir)
├─────────────────────────────┤
│ → POST /api/users       201 │ ← son 3 capture (FIFO)
│ → DEL  /api/users/3     200 │
│ → GET  /api/users?q=    200 │
├─────────────────────────────┤
│ 14 cap · 5 mut · 2 int   ⤢ │ ← counters + expand icon
└─────────────────────────────┘
```

**Kurallar:**
- Her event geldiğinde ilgili satırlar animasyonla güncellenir (tipografi shift etmesin — fixed-width layout)
- Capture row HTTP method'una göre renk (GET gri, POST yeşil, PUT sarı, DELETE kırmızı, PATCH mor)
- Mutation (POST/PUT/DELETE/PATCH) geldiğinde kart kenarında 300ms kırmızı/yeşil glow
- Action-start event'inde "▶ Clicking/Filling/Selecting..." satırı güncellenir + 200ms cyan flash
- Intelligence event'lerinde kart kenarında 400ms mavi ripple
- Credential switch'te üst bar rengi fade geçişle değişir (bkz. Renk paleti §7)

### Mode B — Expanded Panel (click ile açılır)

**Boyut:** yaklaşık `420×560px`, aynı köşede genişler. Close `✕` ile mini'ye döner.

**İçerik bölmeleri:**

```
┌─────────────────────────────────┐
│ 🛡 CS · crawl-in-progress    ✕ │ ← header + close button
├─────────────────────────────────┤
│ [admin] [manager] [user]        │ ← credential tabs (multi-cred)
├─────────────────────────────────┤
│ ▶ Clicking "Delete Alice"       │
│   on /users — cred: admin       │
├─────────────────────────────────┤
│ LIVE EVENTS (last 20)           │
│ 14:23:47 → POST /api/users  201 │ ← scrollable, monospace
│ 14:23:47   trigger: Create User │
│ 14:23:46 ⚡ intel: mark-empty    │
│          /basket (cart-item-add)│
│ 14:23:45 ▶ fill "Name" = "..."  │
│ ...                             │
├─────────────────────────────────┤
│ CURRENT PLAN · 3/8 remaining    │
│   ▸ click "Delete (2)"          │
│   ▸ form(5 fields → Submit)     │
│   ▸ click "Export CSV"          │
├─────────────────────────────────┤
│ SUMMARY                         │
│   Pages: 5/40                   │
│   Captured: 14                  │
│   Mutations: 5 (POST 3, DEL 2)  │
│   Credentials: 3 active         │
└─────────────────────────────────┘
```

**Kurallar:**
- Credential tabs sadece multi-cred mode'da görünür; tıklayınca feed sadece o credential'ın event'leri filter'lanır
- Live events monospace, max 20, yukarı scroll ile geçmişe bakılabilir
- Plan bölümü agent'ın son plan'ını gösterir (LLM JSON özet)
- Summary her yeni event'te güncellenir

### Geçiş davranışı

- Mini → Expanded: header'a veya `⤢` icon'a click. 200ms ease-out büyüme animasyonu.
- Expanded → Mini: `✕` click veya `Alt+C` kısayolu. 200ms küçülme.
- Local storage: son mode seçili kalır (sayfa yenilensin, mod korunsun).

---

## 3. Teknik Entegrasyon

### 3.1 Shadow DOM içinde render

Panel host div'i **Shadow DOM** kullanır. Target sayfanın CSS'i ile çakışma olmaz.

```html
<div id="__cs-host" data-cyberstrike-ui="panel" style="all:initial;position:fixed;bottom:16px;right:16px;z-index:2147483647"></div>
<script>
  const host = document.getElementById('__cs-host');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>/* panel styles */</style><div class="card">...</div>`;
</script>
```

- `data-cyberstrike-ui="panel"` attribute scanner tarafından filter edilir (§6)
- `z-index: 2147483647` (max) — her zaman üstte
- `all: initial` host div için — inherited styles izole

### 3.2 Injection — her page'e otomatik

Hackbrowser `context.addInitScript(injectFn)` ile her yeni page'de panel mount edilmesini sağlar. UI agent **injection fonksiyonu ve panel HTML'ini** tek bir `inject.ts` dosyasında hazırlar:

```ts
// src/panel/inject.ts (new file, ~80-150 lines)
export const PANEL_INIT_SCRIPT = `
  (function() {
    if (document.getElementById('__cs-host')) return;
    const host = document.createElement('div');
    host.id = '__cs-host';
    host.setAttribute('data-cyberstrike-ui', 'panel');
    host.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;pointer-events:none';
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = \`<style>...</style><div class="card">...</div>\`;
    // Interactive elements (header, expand icon) within shadow get pointer-events: auto
    // Event handler
    window.__csEvent = (e) => { /* update DOM based on event type */ };
  })();
`
```

Hackbrowser tarafında tek satır:
```ts
await context.addInitScript(PANEL_INIT_SCRIPT)
```

### 3.3 Event bridge — agent → panel

Agent tarafında her anlamlı olayda event pushlar:

```ts
// helper — agent.ts içinde
async function csEmit(page: Page, event: CSEvent): Promise<void> {
  await page.evaluate((e) => (window as any).__csEvent?.(e), event).catch(() => {})
}
```

**Neden `exposeBinding` değil `evaluate`?**
- `exposeBinding` panel → agent yönünde çağrı için gerekir (iki yönlü)
- Tek yönlü agent → panel için `page.evaluate` yeterli ve daha ucuz
- Hata durumunda agent crash olmasın diye `.catch(() => {})`

Eğer panel → agent yönünde bir şey gerekirse (ör. "pause" butonu) ileride `exposeBinding` eklenir.

---

## 4. Event Schema

Panel'in kabul edeceği event tipleri (TypeScript union). UI agent bu tipleri kullanarak renderer yazar.

```ts
type CSEvent =
  // İlk mount'ta gelir — panel initial state'ini set eder
  | { type: "init", target: string, credentials: string[], maxPages: number }

  // Sayfa değişikliği
  | { type: "page-change", url: string, pageNum: number, credential: string }

  // LLM plan alındı (mini card'da değişmez, expanded panel plan bölümünü günceller)
  | { type: "plan-received", tasks: number, pageState: "populated"|"empty"|"unknown",
      summary: Array<{ kind: "form"|"click", label: string }> }

  // Agent bir action başlatmak üzere (mini'de current action satırını güncelle)
  | { type: "action-start", kind: "click"|"fill"|"select"|"submit",
      targetLabel: string, value?: string, credential: string }

  // Action bitti (başarı/başarısızlık — glow efektini aç/kapat)
  | { type: "action-end", ok: boolean }

  // HTTP request yakalandı
  | { type: "capture", method: string, path: string, status: number,
      trigger?: string, credential: string, isMutation: boolean }

  // Intelligence Layer event'i (Aşama 13)
  | { type: "intelligence",
      kind: "mark-empty"|"drain"|"stale-prune"|"revisit",
      url: string, credential: string, note?: string }

  // Multi-cred credential değişimi (admin → manager → user)
  | { type: "credential-switch", from: string|null, to: string }

  // Crawl bittiğinde
  | { type: "crawl-done", summary: {
      pagesExplored: number, capturedEndpoints: number,
      mutations: number, credentials: string[]
    }}
```

### Example payloads

```json
{ "type": "capture", "method": "POST", "path": "/api/users",
  "status": 201, "trigger": "Create User", "credential": "admin", "isMutation": true }

{ "type": "action-start", "kind": "click", "targetLabel": "Delete Alice Johnson",
  "credential": "admin" }

{ "type": "intelligence", "kind": "mark-empty", "url": "http://localhost:4231/#/cart",
  "credential": "__single__", "note": "cart-item-added" }
```

Panel bu event'leri kuyruklar (son 100 tutulur, mini card son 3'ü render eder).

---

## 5. Pointer-events stratejisi

Panel'in hedef sayfayı bloklamaması kritik.

### Kurallar

- Host div (`#__cs-host`): `pointer-events: none` → kartın üstündeki target alanında fare target'a geçer
- Shadow DOM içinde:
  - `.card` (outer wrapper): `pointer-events: none` (default)
  - Interactive elements — header (tıklayınca expand), `⤢` icon, `✕` close, credential tabs, scrollable content: `pointer-events: auto`
  - Event feed rows: `pointer-events: auto` (hover'da highlight + scroll mümkün)

### Test senaryosu

1. Panel görünürken target'taki bir buton target DOM alanında (panel altında kalsa bile) Playwright `page.click()` ile tıklanmalı → **agent her zaman geçer** (Playwright DOM seviyesinde çalışır, pointer-events'ten bağımsız)
2. Manuel test: fare ile target butonu tıklamak denenirse pointer-events: none alanında geçer → etkileşim bozulmaz

---

## 6. Scanner filter — kritik

Hackbrowser `scanner.ts` DOM'u tarayıp element listesi üretir. Panel host div scanner'a girerse:
- LLM panel elementlerini görür (tokens israf)
- LLM panel butonlarını plan etmeye kalkabilir (plan gürültüsü)
- Dedup key'ler karışır

**Zorunlu filter:** Scanner'daki `INTERACTIVE_SELECTORS` aramasında `[data-cyberstrike-ui]` alt ağacı ignore edilmeli.

```ts
// scanner.ts — içeride page.evaluate'da
for (const el of document.querySelectorAll(INTERACTIVE_SELECTORS)) {
  if (el.closest("[data-cyberstrike-ui]")) continue  // ← EKLENECEK
  // ... mevcut mantık
}
```

Benzer şekilde `capture.ts` ui_context toplayıcısında da aynı filter (eğer trigger scope panel içindeyse — bu olmamalı ama defansif).

---

## 7. Stil rehberi

### Tema — "Dark Terminal + Neon"

```
Background:   #0b0f14 (neredeyse siyah, hafif mavi-gri)
Border:       #1f2937 (kart kenarı, subtle)
Text primary: #e5e7eb (açık gri)
Text muted:   #6b7280 (orta gri — timestamp, meta)
Accent cyan:  #22d3ee (agent action, expand icon, header pulse)
Accent green: #10b981 (successful capture, POST/PATCH low-risk)
Accent red:   #ef4444 (mutation/delete — dramatic)
Accent amber: #f59e0b (manager credential, PUT)
Accent mag:   #a855f7 (intelligence events)
```

### Tipografi

- Başlıklar/labels: system sans-serif stack (`ui-sans-serif, -apple-system, ...`)
- Request lines / code: monospace stack (`'JetBrains Mono', 'Fira Code', ui-monospace, ...`)
- Font size: 11-13px — küçük ama okunaklı

### Animasyon palet

| Event | Efekt | Süre |
|---|---|---|
| Capture | Yeni row için fade-in + left-border cyan flash | 300ms |
| Mutation | Kart sağ kenarında kırmızı/yeşil glow (risk rengine göre) | 300ms |
| Action-start | "▶" ikonu cyan flash + current action satır highlight | 200ms |
| Intelligence | Kart sol kenarında magenta ripple | 400ms |
| Credential-switch | Üst bar renk fade geçişi (admin→manager→user) | 250ms |
| Crawl-done | Karta yeşil checkmark overlay + summary açılır | 500ms |
| Idle pulse | Header'daki 🛡 ikonu 2s'de bir hafif opacity pulse | 2000ms |

### Credential renkleri

```
admin / superadmin / administrator: #22d3ee (cyan) — "full power"
manager / editor:                   #f59e0b (amber) — "elevated"
user / author / viewer:             #6b7280 (gray) — "regular"
multi-cred default (tek):           #a855f7 (magenta)
```

Label match fuzzy — credential id lowercase substring ile eşleşir.

### Sound effects (opsiyonel, default OFF)

- Capture: yumuşak "tick" (10ms)
- Mutation: daha belirgin "pop"
- Crawl-done: "success chord"

Default kapalı, panelde `🔊` toggle butonu olsun (localStorage'da saklanır).

---

## 8. Browser-Agent tarafı kod değişiklikleri

UI agent bu bölümle ilgilenmez ama bütünlük için:

### 8.1 Yeni dosya: `src/panel/inject.ts`

Export: `PANEL_INIT_SCRIPT` (string) — panel HTML + CSS + JS bundle.

UI agent tüm panel kodunu bu dosyaya string olarak koyacak (inline). IIFE pattern, Shadow DOM mount, event handler registration.

### 8.2 `src/agent.ts` dokunuşları (~30 satır)

- Browser context oluşturulduktan sonra: `await context.addInitScript(PANEL_INIT_SCRIPT)`
- `csEmit(page, event)` helper fonksiyonu — `page.evaluate((e) => window.__csEvent?.(e), event)`
- Event emit noktaları:
  - `run()` başında → `init`
  - `explorePageWithAI` başında → `page-change`
  - `planPage` dönüşünde → `plan-received`
  - Form fill / click / submit öncesi → `action-start`
  - `execute()` sonrası → `action-end`
  - `trackResult` içinde HTTP yakalandığında → `capture` (+ isMutation flag)
  - `applyPlanIntelligence` içinde `markPageEmpty` → `intelligence` (mark-empty)
  - `drainOnMutation` dönüşünde → `intelligence` (drain)
  - `pruneStaleTasks` dropped > 0 → `intelligence` (stale-prune)
  - Multi-cred loop'ta credential change → `credential-switch`
  - `run()` sonunda → `crawl-done`

### 8.3 `src/scanner.ts` dokunuşu (~1 satır)

`collectInteractiveElements` evaluate içinde her element için `el.closest("[data-cyberstrike-ui]")` kontrolü → skip.

### 8.4 `src/capture.ts` dokunuşu (~1 satır, defansif)

`snapshotPageUI` içinde input selector'a `:not([data-cyberstrike-ui] *)` eklenebilir. Panel content area Shadow DOM olduğu için normalde ulaşılmaz, ama zararsız savunma.

---

## 9. Deliverables

UI agent'tan beklenen:

1. **`src/panel/inject.ts`** — bu dosya hackbrowser repo'suna girecek, `PANEL_INIT_SCRIPT` string export eder
2. **Visual demo video veya GIF** — 15-30 saniye, crawl sırasında panelin nasıl göründüğü (pitch value)
3. **İsteğe bağlı opt-out flag**: `--no-panel` CLI flag ile panel injection atlanabilir (gizli test'ler için)

### Teslim sonrası hackbrowser ekibi yapar:
- `agent.ts` event emission noktalarını ekler
- `scanner.ts` / `capture.ts` filter'larını ekler
- End-to-end canlı test

---

## 10. Önerilen iteration

1. **v1 (MVP):** Mini card + expanded panel, core event tipleri (`capture`, `action-start`, `credential-switch`, `crawl-done`), dark terminal stili
2. **v1.5:** Intelligence events, glow/pulse animasyonları
3. **v2:** Credential tab filter, plan bölümü, opsiyonel sound FX
4. **v2.5:** Drag-to-reposition, keyboard shortcut, position persistence
5. **v3+:** Element highlight (action öncesi target buton glow — fancy), mini screenshot preview

---

## 11. Kritik "yapma" listesi

- ❌ Global CSS ekleme (`document.head` içine `<style>` inject) — Shadow DOM **zorunlu**
- ❌ Panel DOM'unu host site'ın body/head'ine doğrudan append — host div + Shadow
- ❌ `pointer-events: auto` kartın tümüne — target site etkileşimi bozulur
- ❌ Event'leri debounce etmeden rendere et — her fill için 5-10 event gelir, throttling gerek
- ❌ Panel içinde `console.log` — host console'u kirletir
- ❌ `window.__cs*` dışında global namespace kirletme
- ❌ Data persistence server'a / external'a — tüm state in-memory

---

## 12. Soru / iteration

UI agent prototip aşamasında şu sorulara cevap verirse faydalı:
- Panel başlangıçta mini mi expanded mi? (öneri: mini, ilk event'te mini)
- Mini card genişliği sabit mi, event uzunluğuna göre esner mi? (öneri: sabit 320px, truncate long paths)
- Credential yoksa (single-cred) header'da `single` mı `__single__` mı? (öneri: credential label göstermeme — sadece "CS · page 5/8")

---

**Hedef: pentester ilk run'da paneli görünce "bu şey gerçekten çalışıyor ve şık" demeli.**
