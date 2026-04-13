---
name: wstg-clnt-01.1
description: "Testing for Self DOM-Based XSS"
category: client-side
owasp_id: WSTG-CLNT-01.1
version: "1.0.0"
author: cyberstrike-official
tags: [client-side, javascript, dom, cors, wstg, clnt]
tech_stack: []
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
sha256: 517a0bc395f84a76e7146465458daca77dd51b0f5ed30b7dc935caeedcd48084
signature: j5u70j+JnWr23xN+xmWgVf3Yj1sc+qz9WFR3UW8e3cWKgN4R5WtPPA/Yc8qjeJyjsmmuXJ4XvXt+Ia8e2ltfBw==
signed_by: cyberstrike-official
---

# wstg-clnt-01.1

## Test ID

WSTG-CLNT-01.1

## Test Name

Testing for Self DOM-Based XSS

## High-Level Description

Self DOM-Based XSS (also called Self-XSS) occurs when users are tricked into executing malicious JavaScript in their own browser context. While the attack requires social engineering, it can still lead to session theft or account compromise if combined with other vulnerabilities.

---

## What to Check

- [ ] Console paste protection
- [ ] Self-XSS warnings
- [ ] Input fields vulnerable to paste attacks
- [ ] Developer tools protections

---

## How to Test

### Step 1: Check Console Protection

```javascript
// Open browser console on target site
// Check if there's a warning message about pasting code

// Sites like Facebook show:
// "Stop! This is a browser feature intended for developers..."

// Check if console commands are restricted
console.log("test")
eval("alert(1)")
```

### Step 2: Test Input Field Exploitation

```javascript
// Test if pasting scripts in input fields triggers execution
// Some apps process pasted content unsafely

// In browser console:
document.querySelector('input[type="text"]').value = "<script>alert(1)</script>"
// Check if it gets executed when form is submitted
```

---

## Remediation

```javascript
// Add console warning
if (typeof console !== "undefined") {
  console.log("%cStop!", "color: red; font-size: 50px; font-weight: bold;")
  console.log("%cThis is a browser feature for developers.", "font-size: 20px;")
  console.log("%cIf someone told you to paste something here, it is likely a scam.", "font-size: 16px;")
}
```

---

## Risk Assessment

| Finding             | CVSS | Severity |
| ------------------- | ---- | -------- |
| No self-XSS warning | 3.5  | Low      |

sha256: 2b88f7ecbef302ee6c97767f34994aac624d0832ea3b18cb83071f2c9180abe1
signature: GHnbrM+UxEmWiI4/R1dvrKa6/FyN53T4jos1U4FSknmmR0kzfYwUdrmBxqaOCjvdNjifMEofHrarB32i8WdPAw==
signed_by: cyberstrike-official
---

## Checklist

```
[ ] Console protection checked
[ ] Self-XSS warnings present
[ ] Input field paste handling tested
[ ] Findings documented
```
