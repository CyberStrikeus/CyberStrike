# WSTG-CLNT-01.1: Testing for Self DOM-Based XSS

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
console.log("test");
eval("alert(1)");
```

### Step 2: Test Input Field Exploitation

```javascript
// Test if pasting scripts in input fields triggers execution
// Some apps process pasted content unsafely

// In browser console:
document.querySelector('input[type="text"]').value = "<script>alert(1)</script>";
// Check if it gets executed when form is submitted
```

---

## Remediation

```javascript
// Add console warning
if (typeof console !== 'undefined') {
    console.log('%cStop!', 'color: red; font-size: 50px; font-weight: bold;');
    console.log('%cThis is a browser feature for developers.', 'font-size: 20px;');
    console.log('%cIf someone told you to paste something here, it is likely a scam.', 'font-size: 16px;');
}
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| No self-XSS warning | 3.5 | Low |

---

## Checklist

```
[ ] Console protection checked
[ ] Self-XSS warnings present
[ ] Input field paste handling tested
[ ] Findings documented
```
