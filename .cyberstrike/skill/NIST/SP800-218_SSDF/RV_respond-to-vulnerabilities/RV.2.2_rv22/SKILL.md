---
name: "RV.2.2_rv22"
description: "Plan and implement risk responses for vulnerabilities."
category: "configuration"
version: "1.1"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-218
  - ssdf
  - rv-2-2
  - rv
  - secure-development
  - task
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  []
prerequisites:
  - Assess, Prioritize, and Remediate Vulnerabilities (RV.2)
severity_boost: {}
---

# RV.2.2 RV.2.2

> **Task of practice:** Assess, Prioritize, and Remediate Vulnerabilities (RV.2)

## High-Level Description

**Practice Group:** Respond to Vulnerabilities (RV)
**Framework:** NIST SP 800-218 SSDF v1.1

Plan and implement risk responses for vulnerabilities.

## What to Check

- [ ] Verify RV.2.2 RV.2.2 is integrated into SDLC
- [ ] Review CI/CD pipeline for RV.2.2 implementation
- [ ] Confirm automated tooling supports this practice

## How to Test

### Step 1: Review SDLC Documentation

Examine development lifecycle documentation for evidence of RV.2.2 practice implementation.

### Step 2: Verify Tooling

```
# Check CI/CD pipeline configuration
# Verify security tools are integrated

# Example: Check for SAST/DAST in pipeline
grep -r "security\|scan\|sast\|dast" .github/workflows/ 2>/dev/null
grep -r "security\|scan" Jenkinsfile 2>/dev/null
```

### Step 3: Assess Developer Awareness

Verify development team understands and follows RV.2.2 RV.2.2 practice.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| github-security-mcp | Check repository security settings | `github_security_*` tools |
| Manual Review | SDLC process review | Documentation and interviews |

## Remediation Guide

Implement RV.2.2 RV.2.2 in the software development lifecycle:

Plan and implement risk responses for vulnerabilities.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| RV.2.2 RV.2.2 not implemented | Medium | Secure Development - Respond to Vulnerabilities |

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
