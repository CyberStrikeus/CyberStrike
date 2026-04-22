---
name: "PW.7.1_pw71"
description: "Determine whether code review (a person looks directly at the code to find issues) and/or code analysis (tools are used to find issues in code, either"
category: "input-validation"
version: "1.1"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-218
  - ssdf
  - pw-7-1
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
  - Review and/or Analyze Human-Readable Code to Identify Vulnerabilities and Verify Compliance with Security Requirements (PW.7)
severity_boost: {}
---

# PW.7.1 PW.7.1

> **Task of practice:** Review and/or Analyze Human-Readable Code to Identify Vulnerabilities and Verify Compliance with Security Requirements (PW.7)

## High-Level Description

**Practice Group:** Produce Well-Secured Software (PW)
**Framework:** NIST SP 800-218 SSDF v1.1

Determine whether code review (a person looks directly at the code to find issues) and/or code analysis (tools are used to find issues in code, either in a fully automated way or in conjunction with a person) should be used, as defined by the organization.

## What to Check

- [ ] Verify PW.7.1 PW.7.1 is integrated into SDLC
- [ ] Review CI/CD pipeline for PW.7.1 implementation
- [ ] Confirm automated tooling supports this practice

## How to Test

### Step 1: Review SDLC Documentation

Examine development lifecycle documentation for evidence of PW.7.1 practice implementation.

### Step 2: Verify Tooling

```
# Check CI/CD pipeline configuration
# Verify security tools are integrated

# Example: Check for SAST/DAST in pipeline
grep -r "security\|scan\|sast\|dast" .github/workflows/ 2>/dev/null
grep -r "security\|scan" Jenkinsfile 2>/dev/null
```

### Step 3: Assess Developer Awareness

Verify development team understands and follows PW.7.1 PW.7.1 practice.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| github-security-mcp | Check repository security settings | `github_security_*` tools |
| Manual Review | SDLC process review | Documentation and interviews |

## Remediation Guide

Implement PW.7.1 PW.7.1 in the software development lifecycle:

Determine whether code review (a person looks directly at the code to find issues) and/or code analysis (tools are used to find issues in code, either in a fully automated way or in conjunction with a person) should be used, as defined by the organization.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PW.7.1 PW.7.1 not implemented | Medium | Secure Development - Produce Well-Secured Software |

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
