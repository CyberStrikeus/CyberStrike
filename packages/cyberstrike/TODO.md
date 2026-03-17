# Ingest endpoint (port-based input) – yapılacaklar

Bu dosya, HTTP ile gelen istekleri "kullanıcı input'u" gibi işleyip TUI chat'te gösterme özelliğinin adım adım planıdır.

---

## 1. Ingest route şeması ve endpoint

- [x] **1.1** `src/server/routes/session.ts` içinde yeni route ekle: `POST /session/ingest`
- [x] **1.2** Request body şeması:
  - `text` (string, zorunlu) – kullanıcı mesajı gibi işlenecek metin
  - `sessionID` (string, opsiyonel) – yoksa veya geçersizse yeni session oluşturulacak
  - `agent` (string, opsiyonel) – kullanılacak agent (yoksa default)
  - `model` (object: `providerID`, `modelID`, opsiyonel)
- [x] **1.3** Response: `202 Accepted` + `{ sessionID }` (yeni veya mevcut).

---

## 2. Handler mantığı

- [x] **2.1** Body'den `sessionID` al. Varsa `Session.get(sessionID)` ile session'ı kontrol et; yoksa veya geçersizse `Session.create({ title: "Ingest" })` ile yeni session oluştur.
- [x] **2.2** `SessionPrompt.prompt()` için input: `sessionID`, `agent`, `model`, `parts: [{ type: "text", text: body.text }]`.
- [x] **2.3** `SessionPrompt.prompt(...)` fire-and-forget çağrıldı (await yok); 202 + `sessionID` hemen dönüyor. Yanıt TUI event'leri ile chat'te görünecek.
- [x] **2.4** Hata durumunda log; promise `.catch()` ile yakalandı.

---

## 3. Route sıralaması

- [x] **3.1** `POST /session/ingest` route'u `POST "/"` ile `delete("/:sessionID")` arasına eklendi; `/ingest` literal path parametreli route'lardan önce eşleşir.

---

## 4. TUI tarafı

- [x] **4.1** Ek TUI kodu gerekmedi. Mevcut event aboneliği ingest ile oluşan session/mesajları günceller.

---

## 5. Test ve doğrulama

- [ ] **5.1** CyberStrike TUI çalışırken `curl -X POST http://localhost:4096/session/ingest -H "Content-Type: application/json" -d '{"text":"Merhaba"}'` ile istek at; yanıtta `sessionID` gelmeli.
- [ ] **5.2** Aynı `sessionID` ile ikinci istek at; aynı session'da yeni mesaj görünmeli.
- [ ] **5.3** TUI'da ilgili session açıkken ingest isteği at; chat'in canlı güncellendiğini kontrol et.

---

## 6. Porta bağlanma (ingest için gerçek port gerekir)

**Sorun:** `bun run --conditions=browser ./src/index.ts run` (veya sadece `./src/index.ts`) çalıştırıldığında sunucu **gerçek bir TCP portunda dinlemiyor**; istekler sadece process içi `Server.App().fetch` ile yapılıyor. Bu yüzden dışarıdan (curl, ingest) bağlanınca "connection refused" alınır.

**Çözüm:**

- **TUI + port (önerilen):** Varsayılan komut (TUI) ile port ver; hem sohbet arayüzü açılır hem sunucu o portta dinler. İlk mesajı istersen `--prompt` ile ver.

  ```bash
  bun run --conditions=browser ./src/index.ts --port 4096
  ```

  İlk mesajı da göndermek için:

  ```bash
  bun run --conditions=browser ./src/index.ts --port 4096 --prompt "ilk mesaj"
  ```

  Bu komutla TUI açılır, sohbet akışı normal devam eder. Ingest için aynı porta istek at:

  ```bash
  curl -X POST http://127.0.0.1:4096/session/ingest -H "Content-Type: application/json" -d '{"text":"Merhaba"}'
  ```

- **Headless run + port:** Sadece mesaj gönderip cevabı terminalde görmek için (TUI yok):

  ```bash
  bun run --conditions=browser ./src/index.ts run --port 4096 "ilk mesaj"
  ```

- **Serve + Attach:** Bir terminalde sunucu, diğerinde TUI.
  ```bash
  # Terminal 1
  bun run ./src/index.ts serve --port 4096
  # Terminal 2
  bun run ./src/index.ts attach http://127.0.0.1:4096
  ```

**Not:** `--conditions=browser` tsconfig'teki `customConditions: ["browser"]` ile uyumlu; TUI için kullanılır. Port dinleme (Bun.serve) bu koşuldan etkilenmemeli. Hata devam ederse `--conditions=browser` olmadan `bun run ./src/index.ts run --port 4096` deneyin.

---

## Sıra özeti

1. Ingest body şeması (zod) + route tanımı
2. Handler: session resolve/create → prompt input → SessionPrompt.prompt (async) → response sessionID
3. Route'u doğru yere (parametreli route'lardan önce) koy
4. TUI'da event ile güncelleme (kod yok, test)
5. curl + TUI ile test
