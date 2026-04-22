---
name: "Reuse Existing, Well-Secured Software When Feasible Instead of Duplicating Functionality (PW.4)_reuse-existing-well-secured-software-when-feasible-instead-o"
description: "Lower the costs of software development, expedite software development, and decrease the likelihood of introducing additional security vulnerabilit..."
category: "input-validation"
version: "1.1"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-218
  - ssdf
  - reuse existing, well-secured software when feasible instead of duplicating functionality (pw-4)
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

# Reuse Existing, Well-Secured Software When Feasible Instead of Duplicating Functionality (PW.4) Reuse Existing, Well-Secured Software When Feasible Instead of Duplicating Functionality

## High-Level Description

**Practice Group:** Produce Well-Secured Software (PW)
**Framework:** NIST SP 800-218 SSDF v1.1

Lower the costs of software development, expedite software development, and decrease the likelihood of introducing additional security vulnerabilities into the software by reusing software modules and services that have already had their security posture checked. This is particularly important for software that implements security functionality, such as cryptographic modules and protocols.

## What to Check

- [ ] Verify Reuse Existing, Well-Secured Software When Feasible Instead of Duplicating Functionality (PW.4) Reuse Existing, Well-Secured Software When Feasible Instead of Duplicating Functionality is integrated into SDLC
- [ ] Review CI/CD pipeline for Reuse Existing, Well-Secured Software When Feasible Instead of Duplicating Functionality (PW.4) implementation
- [ ] Confirm automated tooling supports this practice

## How to Test

### Step 1: Review SDLC Documentation

Examine development lifecycle documentation for evidence of Reuse Existing, Well-Secured Software When Feasible Instead of Duplicating Functionality (PW.4) practice implementation.

### Step 2: Verify Tooling

```
# Check CI/CD pipeline configuration
# Verify security tools are integrated

# Example: Check for SAST/DAST in pipeline
grep -r "security\|scan\|sast\|dast" .github/workflows/ 2>/dev/null
grep -r "security\|scan" Jenkinsfile 2>/dev/null
```

### Step 3: Assess Developer Awareness

Verify development team understands and follows Reuse Existing, Well-Secured Software When Feasible Instead of Duplicating Functionality (PW.4) Reuse Existing, Well-Secured Software When Feasible Instead of Duplicating Functionality practice.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| github-security-mcp | Check repository security settings | `github_security_*` tools |
| Manual Review | SDLC process review | Documentation and interviews |

## Remediation Guide

Implement Reuse Existing, Well-Secured Software When Feasible Instead of Duplicating Functionality (PW.4) Reuse Existing, Well-Secured Software When Feasible Instead of Duplicating Functionality in the software development lifecycle:

Lower the costs of software development, expedite software development, and decrease the likelihood of introducing additional security vulnerabilities into the software by reusing software modules and services that have already had their security posture checked. This is particularly important for software that implements security functionality, such as cryptographic modules and protocols.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Reuse Existing, Well-Secured Software When Feasible Instead of Duplicating Functionality (PW.4) Reuse Existing, Well-Secured Software When Feasible Instead of Duplicating Functionality not implemented | Medium | Secure Development - Produce Well-Secured Software |

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
