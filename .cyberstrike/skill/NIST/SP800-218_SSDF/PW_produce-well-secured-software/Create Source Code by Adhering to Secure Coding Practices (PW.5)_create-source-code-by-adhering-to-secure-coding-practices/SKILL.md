---
name: "Create Source Code by Adhering to Secure Coding Practices (PW.5)_create-source-code-by-adhering-to-secure-coding-practices"
description: "Decrease the number of security vulnerabilities in the software, and reduce costs by minimizing vulnerabilities introduced during source code creation"
category: "input-validation"
version: "1.1"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-218
  - ssdf
  - create source code by adhering to secure coding practices (pw-5)
  - pw
  - secure-development
  - practice
tech_stack:
  - any
cwe_ids:
  - CWE-20
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Create Source Code by Adhering to Secure Coding Practices (PW.5) Create Source Code by Adhering to Secure Coding Practices

## High-Level Description

**Practice Group:** Produce Well-Secured Software (PW)
**Framework:** NIST SP 800-218 SSDF v1.1

Decrease the number of security vulnerabilities in the software, and reduce costs by minimizing vulnerabilities introduced during source code creation that meet or exceed organization-defined vulnerability severity criteria.

## What to Check

- [ ] Verify Create Source Code by Adhering to Secure Coding Practices (PW.5) Create Source Code by Adhering to Secure Coding Practices is integrated into SDLC
- [ ] Review CI/CD pipeline for Create Source Code by Adhering to Secure Coding Practices (PW.5) implementation
- [ ] Confirm automated tooling supports this practice

## How to Test

### Step 1: Review SDLC Documentation

Examine development lifecycle documentation for evidence of Create Source Code by Adhering to Secure Coding Practices (PW.5) practice implementation.

### Step 2: Verify Tooling

```
# Check CI/CD pipeline configuration
# Verify security tools are integrated

# Example: Check for SAST/DAST in pipeline
grep -r "security\|scan\|sast\|dast" .github/workflows/ 2>/dev/null
grep -r "security\|scan" Jenkinsfile 2>/dev/null
```

### Step 3: Assess Developer Awareness

Verify development team understands and follows Create Source Code by Adhering to Secure Coding Practices (PW.5) Create Source Code by Adhering to Secure Coding Practices practice.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| github-security-mcp | Check repository security settings | `github_security_*` tools |
| Manual Review | SDLC process review | Documentation and interviews |

## Remediation Guide

Implement Create Source Code by Adhering to Secure Coding Practices (PW.5) Create Source Code by Adhering to Secure Coding Practices in the software development lifecycle:

Decrease the number of security vulnerabilities in the software, and reduce costs by minimizing vulnerabilities introduced during source code creation that meet or exceed organization-defined vulnerability severity criteria.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Create Source Code by Adhering to Secure Coding Practices (PW.5) Create Source Code by Adhering to Secure Coding Practices not implemented | Medium | Secure Development - Produce Well-Secured Software |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [NIST SP 800-218 SSDF v1.1](https://csrc.nist.gov/pubs/sp/800/218/final)
- [NIST SSDF Practices](https://csrc.nist.gov/projects/ssdf)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] Practice documented in SDLC policy
- [ ] Tooling configured and operational
- [ ] Development team trained
- [ ] Evidence of consistent application
- [ ] Periodic review scheduled
