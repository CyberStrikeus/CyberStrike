---
name: "Configure Software to Have Secure Settings by Default (PW.9)_configure-software-to-have-secure-settings-by-default"
description: "Help improve the security of the software at the time of installation to reduce the likelihood of the software being deployed with weak security setti"
category: "input-validation"
version: "1.1"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-218
  - ssdf
  - configure software to have secure settings by default (pw-9)
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

# Configure Software to Have Secure Settings by Default (PW.9) Configure Software to Have Secure Settings by Default

## High-Level Description

**Practice Group:** Produce Well-Secured Software (PW)
**Framework:** NIST SP 800-218 SSDF v1.1

Help improve the security of the software at the time of installation to reduce the likelihood of the software being deployed with weak security settings, putting it at greater risk of compromise.

## What to Check

- [ ] Verify Configure Software to Have Secure Settings by Default (PW.9) Configure Software to Have Secure Settings by Default is integrated into SDLC
- [ ] Review CI/CD pipeline for Configure Software to Have Secure Settings by Default (PW.9) implementation
- [ ] Confirm automated tooling supports this practice

## How to Test

### Step 1: Review SDLC Documentation

Examine development lifecycle documentation for evidence of Configure Software to Have Secure Settings by Default (PW.9) practice implementation.

### Step 2: Verify Tooling

```
# Check CI/CD pipeline configuration
# Verify security tools are integrated

# Example: Check for SAST/DAST in pipeline
grep -r "security\|scan\|sast\|dast" .github/workflows/ 2>/dev/null
grep -r "security\|scan" Jenkinsfile 2>/dev/null
```

### Step 3: Assess Developer Awareness

Verify development team understands and follows Configure Software to Have Secure Settings by Default (PW.9) Configure Software to Have Secure Settings by Default practice.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| github-security-mcp | Check repository security settings | `github_security_*` tools |
| Manual Review | SDLC process review | Documentation and interviews |

## Remediation Guide

Implement Configure Software to Have Secure Settings by Default (PW.9) Configure Software to Have Secure Settings by Default in the software development lifecycle:

Help improve the security of the software at the time of installation to reduce the likelihood of the software being deployed with weak security settings, putting it at greater risk of compromise.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Configure Software to Have Secure Settings by Default (PW.9) Configure Software to Have Secure Settings by Default not implemented | Medium | Secure Development - Produce Well-Secured Software |

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
