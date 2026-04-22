---
name: "PO.3.2_po32"
description: "Follow recommended security practices to deploy, operate, and maintain tools and toolchains."
category: "configuration"
version: "1.1"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-218
  - ssdf
  - po-3-2
  - po
  - secure-development
  - task
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites:
  - Implement Supporting Toolchains (PO.3)
severity_boost: {}
---

# PO.3.2 PO.3.2

> **Task of practice:** Implement Supporting Toolchains (PO.3)

## High-Level Description

**Practice Group:** Prepare the Organization (PO)
**Framework:** NIST SP 800-218 SSDF v1.1

Follow recommended security practices to deploy, operate, and maintain tools and toolchains.

## What to Check

- [ ] Verify PO.3.2 PO.3.2 is integrated into SDLC
- [ ] Review CI/CD pipeline for PO.3.2 implementation
- [ ] Confirm automated tooling supports this practice

## How to Test

### Step 1: Review SDLC Documentation

Examine development lifecycle documentation for evidence of PO.3.2 practice implementation.

### Step 2: Verify Tooling

```
# Check CI/CD pipeline configuration
# Verify security tools are integrated

# Example: Check for SAST/DAST in pipeline
grep -r "security\|scan\|sast\|dast" .github/workflows/ 2>/dev/null
grep -r "security\|scan" Jenkinsfile 2>/dev/null
```

### Step 3: Assess Developer Awareness

Verify development team understands and follows PO.3.2 PO.3.2 practice.

## Tools

| Tool                | Purpose                            | Usage                        |
| ------------------- | ---------------------------------- | ---------------------------- |
| github-security-mcp | Check repository security settings | `github_security_*` tools    |
| Manual Review       | SDLC process review                | Documentation and interviews |

## Remediation Guide

Implement PO.3.2 PO.3.2 in the software development lifecycle:

Follow recommended security practices to deploy, operate, and maintain tools and toolchains.

## Risk Assessment

| Finding                       | Severity | Impact                                        |
| ----------------------------- | -------- | --------------------------------------------- |
| PO.3.2 PO.3.2 not implemented | Medium   | Secure Development - Prepare the Organization |

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
