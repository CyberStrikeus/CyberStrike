---
name: "Define and Use Criteria for Software Security Checks (PO.4)_define-and-use-criteria-for-software-security-checks"
description: "Help ensure that the software resulting from the SDLC meets the organization’s expectations by defining and using criteria for checking the software’s"
category: "configuration"
version: "1.1"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-218
  - ssdf
  - define and use criteria for software security checks (po-4)
  - po
  - secure-development
  - practice
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Define and Use Criteria for Software Security Checks (PO.4) Define and Use Criteria for Software Security Checks

## High-Level Description

**Practice Group:** Prepare the Organization (PO)
**Framework:** NIST SP 800-218 SSDF v1.1

Help ensure that the software resulting from the SDLC meets the organization’s expectations by defining and using criteria for checking the software’s security during development.

## What to Check

- [ ] Verify Define and Use Criteria for Software Security Checks (PO.4) Define and Use Criteria for Software Security Checks is integrated into SDLC
- [ ] Review CI/CD pipeline for Define and Use Criteria for Software Security Checks (PO.4) implementation
- [ ] Confirm automated tooling supports this practice

## How to Test

### Step 1: Review SDLC Documentation

Examine development lifecycle documentation for evidence of Define and Use Criteria for Software Security Checks (PO.4) practice implementation.

### Step 2: Verify Tooling

```
# Check CI/CD pipeline configuration
# Verify security tools are integrated

# Example: Check for SAST/DAST in pipeline
grep -r "security\|scan\|sast\|dast" .github/workflows/ 2>/dev/null
grep -r "security\|scan" Jenkinsfile 2>/dev/null
```

### Step 3: Assess Developer Awareness

Verify development team understands and follows Define and Use Criteria for Software Security Checks (PO.4) Define and Use Criteria for Software Security Checks practice.

## Tools

| Tool                | Purpose                            | Usage                        |
| ------------------- | ---------------------------------- | ---------------------------- |
| github-security-mcp | Check repository security settings | `github_security_*` tools    |
| Manual Review       | SDLC process review                | Documentation and interviews |

## Remediation Guide

Implement Define and Use Criteria for Software Security Checks (PO.4) Define and Use Criteria for Software Security Checks in the software development lifecycle:

Help ensure that the software resulting from the SDLC meets the organization’s expectations by defining and using criteria for checking the software’s security during development.

## Risk Assessment

| Finding                                                                                                                          | Severity | Impact                                        |
| -------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------- |
| Define and Use Criteria for Software Security Checks (PO.4) Define and Use Criteria for Software Security Checks not implemented | Medium   | Secure Development - Prepare the Organization |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

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
