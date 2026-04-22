---
name: "Implement Roles and Responsibilities (PO.2)_implement-roles-and-responsibilities"
description: "Ensure that everyone inside and outside of the organization involved in the SDLC is prepared to perform their SDLC-related roles and responsibilities "
category: "configuration"
version: "1.1"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-218
  - ssdf
  - implement roles and responsibilities (po-2)
  - po
  - secure-development
  - practice
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Implement Roles and Responsibilities (PO.2) Implement Roles and Responsibilities

## High-Level Description

**Practice Group:** Prepare the Organization (PO)
**Framework:** NIST SP 800-218 SSDF v1.1

Ensure that everyone inside and outside of the organization involved in the SDLC is prepared to perform their SDLC-related roles and responsibilities throughout the SDLC.

## What to Check

- [ ] Verify Implement Roles and Responsibilities (PO.2) Implement Roles and Responsibilities is integrated into SDLC
- [ ] Review CI/CD pipeline for Implement Roles and Responsibilities (PO.2) implementation
- [ ] Confirm automated tooling supports this practice

## How to Test

### Step 1: Review SDLC Documentation

Examine development lifecycle documentation for evidence of Implement Roles and Responsibilities (PO.2) practice implementation.

### Step 2: Verify Tooling

```
# Check CI/CD pipeline configuration
# Verify security tools are integrated

# Example: Check for SAST/DAST in pipeline
grep -r "security\|scan\|sast\|dast" .github/workflows/ 2>/dev/null
grep -r "security\|scan" Jenkinsfile 2>/dev/null
```

### Step 3: Assess Developer Awareness

Verify development team understands and follows Implement Roles and Responsibilities (PO.2) Implement Roles and Responsibilities practice.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| github-security-mcp | Check repository security settings | `github_security_*` tools |
| Manual Review | SDLC process review | Documentation and interviews |

## Remediation Guide

Implement Implement Roles and Responsibilities (PO.2) Implement Roles and Responsibilities in the software development lifecycle:

Ensure that everyone inside and outside of the organization involved in the SDLC is prepared to perform their SDLC-related roles and responsibilities throughout the SDLC.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Implement Roles and Responsibilities (PO.2) Implement Roles and Responsibilities not implemented | Medium | Secure Development - Prepare the Organization |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

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
