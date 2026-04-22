---
name: "Define Security Requirements for Software Development (PO.1)_define-security-requirements-for-software-development"
description: "Ensure that security requirements for software development are known at all times so that they can be taken into account throughout the SDLC and du..."
category: "configuration"
version: "1.1"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-218
  - ssdf
  - define security requirements for software development (po-1)
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

# Define Security Requirements for Software Development (PO.1) Define Security Requirements for Software Development

## High-Level Description

**Practice Group:** Prepare the Organization (PO)
**Framework:** NIST SP 800-218 SSDF v1.1

Ensure that security requirements for software development are known at all times so that they can be taken into account throughout the SDLC and duplication of effort can be minimized because the requirements information can be collected once and shared. This includes requirements from internal sources (e.g., the organization’s policies, business objectives, and risk management strategy) and external sources (e.g., applicable laws and regulations).

## What to Check

- [ ] Verify Define Security Requirements for Software Development (PO.1) Define Security Requirements for Software Development is integrated into SDLC
- [ ] Review CI/CD pipeline for Define Security Requirements for Software Development (PO.1) implementation
- [ ] Confirm automated tooling supports this practice

## How to Test

### Step 1: Review SDLC Documentation

Examine development lifecycle documentation for evidence of Define Security Requirements for Software Development (PO.1) practice implementation.

### Step 2: Verify Tooling

```
# Check CI/CD pipeline configuration
# Verify security tools are integrated

# Example: Check for SAST/DAST in pipeline
grep -r "security\|scan\|sast\|dast" .github/workflows/ 2>/dev/null
grep -r "security\|scan" Jenkinsfile 2>/dev/null
```

### Step 3: Assess Developer Awareness

Verify development team understands and follows Define Security Requirements for Software Development (PO.1) Define Security Requirements for Software Development practice.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| github-security-mcp | Check repository security settings | `github_security_*` tools |
| Manual Review | SDLC process review | Documentation and interviews |

## Remediation Guide

Implement Define Security Requirements for Software Development (PO.1) Define Security Requirements for Software Development in the software development lifecycle:

Ensure that security requirements for software development are known at all times so that they can be taken into account throughout the SDLC and duplication of effort can be minimized because the requirements information can be collected once and shared. This includes requirements from internal sources (e.g., the organization’s policies, business objectives, and risk management strategy) and external sources (e.g., applicable laws and regulations).

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Define Security Requirements for Software Development (PO.1) Define Security Requirements for Software Development not implemented | Medium | Secure Development - Prepare the Organization |

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
