---
name: "RV.1.3_rv13"
description: "Have a policy that addresses vulnerability disclosure and remediation, and implement the roles, responsibilities, and processes needed to support that"
category: "configuration"
version: "1.1"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-218
  - ssdf
  - rv-1-3
  - rv
  - secure-development
  - task
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites:
  - Identify and Confirm Vulnerabilities on an Ongoing Basis (RV.1)
severity_boost: {}
---

# RV.1.3 RV.1.3

> **Task of practice:** Identify and Confirm Vulnerabilities on an Ongoing Basis (RV.1)

## High-Level Description

**Practice Group:** Respond to Vulnerabilities (RV)
**Framework:** NIST SP 800-218 SSDF v1.1

Have a policy that addresses vulnerability disclosure and remediation, and implement the roles, responsibilities, and processes needed to support that policy.

## What to Check

- [ ] Verify RV.1.3 RV.1.3 is integrated into SDLC
- [ ] Review CI/CD pipeline for RV.1.3 implementation
- [ ] Confirm automated tooling supports this practice

## How to Test

### Step 1: Review SDLC Documentation

Examine development lifecycle documentation for evidence of RV.1.3 practice implementation.

### Step 2: Verify Tooling

```
# Check CI/CD pipeline configuration
# Verify security tools are integrated

# Example: Check for SAST/DAST in pipeline
grep -r "security\|scan\|sast\|dast" .github/workflows/ 2>/dev/null
grep -r "security\|scan" Jenkinsfile 2>/dev/null
```

### Step 3: Assess Developer Awareness

Verify development team understands and follows RV.1.3 RV.1.3 practice.

## Tools

| Tool                | Purpose                            | Usage                        |
| ------------------- | ---------------------------------- | ---------------------------- |
| github-security-mcp | Check repository security settings | `github_security_*` tools    |
| Manual Review       | SDLC process review                | Documentation and interviews |

## Remediation Guide

Implement RV.1.3 RV.1.3 in the software development lifecycle:

Have a policy that addresses vulnerability disclosure and remediation, and implement the roles, responsibilities, and processes needed to support that policy.

## Risk Assessment

| Finding                       | Severity | Impact                                          |
| ----------------------------- | -------- | ----------------------------------------------- |
| RV.1.3 RV.1.3 not implemented | Medium   | Secure Development - Respond to Vulnerabilities |

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
