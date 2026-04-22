---
name: "PO.2.1_po21"
description: "Create new roles and alter responsibilities for existing roles as needed to encompass all parts of the SDLC."
category: "configuration"
version: "1.1"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-218
  - ssdf
  - po-2-1
  - po
  - secure-development
  - task
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites:
  - Implement Roles and Responsibilities (PO.2)
severity_boost: {}
---

# PO.2.1 PO.2.1

> **Task of practice:** Implement Roles and Responsibilities (PO.2)

## High-Level Description

**Practice Group:** Prepare the Organization (PO)
**Framework:** NIST SP 800-218 SSDF v1.1

Create new roles and alter responsibilities for existing roles as needed to encompass all parts of the SDLC. Periodically review and maintain the defined roles and responsibilities, updating them as needed.

## What to Check

- [ ] Verify PO.2.1 PO.2.1 is integrated into SDLC
- [ ] Review CI/CD pipeline for PO.2.1 implementation
- [ ] Confirm automated tooling supports this practice

## How to Test

### Step 1: Review SDLC Documentation

Examine development lifecycle documentation for evidence of PO.2.1 practice implementation.

### Step 2: Verify Tooling

```
# Check CI/CD pipeline configuration
# Verify security tools are integrated

# Example: Check for SAST/DAST in pipeline
grep -r "security\|scan\|sast\|dast" .github/workflows/ 2>/dev/null
grep -r "security\|scan" Jenkinsfile 2>/dev/null
```

### Step 3: Assess Developer Awareness

Verify development team understands and follows PO.2.1 PO.2.1 practice.

## Tools

| Tool                | Purpose                            | Usage                        |
| ------------------- | ---------------------------------- | ---------------------------- |
| github-security-mcp | Check repository security settings | `github_security_*` tools    |
| Manual Review       | SDLC process review                | Documentation and interviews |

## Remediation Guide

Implement PO.2.1 PO.2.1 in the software development lifecycle:

Create new roles and alter responsibilities for existing roles as needed to encompass all parts of the SDLC. Periodically review and maintain the defined roles and responsibilities, updating them as needed.

## Risk Assessment

| Finding                       | Severity | Impact                                        |
| ----------------------------- | -------- | --------------------------------------------- |
| PO.2.1 PO.2.1 not implemented | Medium   | Secure Development - Prepare the Organization |

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
