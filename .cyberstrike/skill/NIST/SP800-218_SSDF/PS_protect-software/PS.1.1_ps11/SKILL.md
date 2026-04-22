---
name: "PS.1.1_ps11"
description: "Store all forms of code – including source code, executable code, and configuration-as-code – based on the principle of least privilege so that onl..."
category: "authorization"
version: "1.1"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-218
  - ssdf
  - ps-1-1
  - ps
  - secure-development
  - task
tech_stack:
  - git
  - ci-cd
  - docker
cwe_ids:
  - CWE-284
chains_with:
  []
prerequisites:
  - Protect All Forms of Code from Unauthorized Access and Tampering (PS.1)
severity_boost: {}
---

# PS.1.1 PS.1.1

> **Task of practice:** Protect All Forms of Code from Unauthorized Access and Tampering (PS.1)

## High-Level Description

**Practice Group:** Protect Software (PS)
**Framework:** NIST SP 800-218 SSDF v1.1

Store all forms of code – including source code, executable code, and configuration-as-code – based on the principle of least privilege so that only authorized personnel, tools, services, etc. have access.

## What to Check

- [ ] Verify PS.1.1 PS.1.1 is integrated into SDLC
- [ ] Review CI/CD pipeline for PS.1.1 implementation
- [ ] Confirm automated tooling supports this practice

## How to Test

### Step 1: Review SDLC Documentation

Examine development lifecycle documentation for evidence of PS.1.1 practice implementation.

### Step 2: Verify Tooling

```
# Check CI/CD pipeline configuration
# Verify security tools are integrated

# Example: Check for SAST/DAST in pipeline
grep -r "security\|scan\|sast\|dast" .github/workflows/ 2>/dev/null
grep -r "security\|scan" Jenkinsfile 2>/dev/null
```

### Step 3: Assess Developer Awareness

Verify development team understands and follows PS.1.1 PS.1.1 practice.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| github-security-mcp | Check repository security settings | `github_security_*` tools |
| Manual Review | SDLC process review | Documentation and interviews |

## Remediation Guide

Implement PS.1.1 PS.1.1 in the software development lifecycle:

Store all forms of code – including source code, executable code, and configuration-as-code – based on the principle of least privilege so that only authorized personnel, tools, services, etc. have access.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PS.1.1 PS.1.1 not implemented | Medium | Secure Development - Protect Software |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-284 | Improper Access Control |


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
