---
name: "PW.4.4_pw44"
description: "Verify that acquired commercial, open-source, and all other third-party software components comply with the requirements, as defined by the organizati"
category: "input-validation"
version: "1.1"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-218
  - ssdf
  - pw-4-4
  - pw
  - secure-development
  - task
tech_stack:
  - any
cwe_ids:
  - CWE-20
chains_with:
  []
prerequisites:
  - Reuse Existing, Well-Secured Software When Feasible Instead of Duplicating Functionality (PW.4)
severity_boost: {}
---

# PW.4.4 PW.4.4

> **Task of practice:** Reuse Existing, Well-Secured Software When Feasible Instead of Duplicating Functionality (PW.4)

## High-Level Description

**Practice Group:** Produce Well-Secured Software (PW)
**Framework:** NIST SP 800-218 SSDF v1.1

Verify that acquired commercial, open-source, and all other third-party software components comply with the requirements, as defined by the organization, throughout their life cycles.

## What to Check

- [ ] Verify PW.4.4 PW.4.4 is integrated into SDLC
- [ ] Review CI/CD pipeline for PW.4.4 implementation
- [ ] Confirm automated tooling supports this practice

## How to Test

### Step 1: Review SDLC Documentation

Examine development lifecycle documentation for evidence of PW.4.4 practice implementation.

### Step 2: Verify Tooling

```
# Check CI/CD pipeline configuration
# Verify security tools are integrated

# Example: Check for SAST/DAST in pipeline
grep -r "security\|scan\|sast\|dast" .github/workflows/ 2>/dev/null
grep -r "security\|scan" Jenkinsfile 2>/dev/null
```

### Step 3: Assess Developer Awareness

Verify development team understands and follows PW.4.4 PW.4.4 practice.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| github-security-mcp | Check repository security settings | `github_security_*` tools |
| Manual Review | SDLC process review | Documentation and interviews |

## Remediation Guide

Implement PW.4.4 PW.4.4 in the software development lifecycle:

Verify that acquired commercial, open-source, and all other third-party software components comply with the requirements, as defined by the organization, throughout their life cycles.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PW.4.4 PW.4.4 not implemented | Medium | Secure Development - Produce Well-Secured Software |

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
