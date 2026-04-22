---
name: "Review the Software Design to Verify Compliance with Security Requirements and Risk Information (PW.2)_review-the-software-design-to-verify-compliance-with-securit"
description: "Help ensure that the software will meet the security requirements and satisfactorily address the identified risk information."
category: "input-validation"
version: "1.1"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-218
  - ssdf
  - review the software design to verify compliance with security requirements and risk information (pw-2)
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

# Review the Software Design to Verify Compliance with Security Requirements and Risk Information (PW.2) Review the Software Design to Verify Compliance with Security Requirements and Risk Information

## High-Level Description

**Practice Group:** Produce Well-Secured Software (PW)
**Framework:** NIST SP 800-218 SSDF v1.1

Help ensure that the software will meet the security requirements and satisfactorily address the identified risk information.

## What to Check

- [ ] Verify Review the Software Design to Verify Compliance with Security Requirements and Risk Information (PW.2) Review the Software Design to Verify Compliance with Security Requirements and Risk Information is integrated into SDLC
- [ ] Review CI/CD pipeline for Review the Software Design to Verify Compliance with Security Requirements and Risk Information (PW.2) implementation
- [ ] Confirm automated tooling supports this practice

## How to Test

### Step 1: Review SDLC Documentation

Examine development lifecycle documentation for evidence of Review the Software Design to Verify Compliance with Security Requirements and Risk Information (PW.2) practice implementation.

### Step 2: Verify Tooling

```
# Check CI/CD pipeline configuration
# Verify security tools are integrated

# Example: Check for SAST/DAST in pipeline
grep -r "security\|scan\|sast\|dast" .github/workflows/ 2>/dev/null
grep -r "security\|scan" Jenkinsfile 2>/dev/null
```

### Step 3: Assess Developer Awareness

Verify development team understands and follows Review the Software Design to Verify Compliance with Security Requirements and Risk Information (PW.2) Review the Software Design to Verify Compliance with Security Requirements and Risk Information practice.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| github-security-mcp | Check repository security settings | `github_security_*` tools |
| Manual Review | SDLC process review | Documentation and interviews |

## Remediation Guide

Implement Review the Software Design to Verify Compliance with Security Requirements and Risk Information (PW.2) Review the Software Design to Verify Compliance with Security Requirements and Risk Information in the software development lifecycle:

Help ensure that the software will meet the security requirements and satisfactorily address the identified risk information.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Review the Software Design to Verify Compliance with Security Requirements and Risk Information (PW.2) Review the Software Design to Verify Compliance with Security Requirements and Risk Information not implemented | Medium | Secure Development - Produce Well-Secured Software |

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
