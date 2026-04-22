---
name: "PW.9.1_pw91"
description: "Define a secure baseline by determining how to configure each setting that has an effect on security or a security-related setting so that the default"
category: "input-validation"
version: "1.1"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-218
  - ssdf
  - pw-9-1
  - pw
  - secure-development
  - task
tech_stack:
  - any
cwe_ids:
  - CWE-20
chains_with: []
prerequisites:
  - Configure Software to Have Secure Settings by Default (PW.9)
severity_boost: {}
---

# PW.9.1 PW.9.1

> **Task of practice:** Configure Software to Have Secure Settings by Default (PW.9)

## High-Level Description

**Practice Group:** Produce Well-Secured Software (PW)
**Framework:** NIST SP 800-218 SSDF v1.1

Define a secure baseline by determining how to configure each setting that has an effect on security or a security-related setting so that the default settings are secure and do not weaken the security functions provided by the platform, network infrastructure, or services.

## What to Check

- [ ] Verify PW.9.1 PW.9.1 is integrated into SDLC
- [ ] Review CI/CD pipeline for PW.9.1 implementation
- [ ] Confirm automated tooling supports this practice

## How to Test

### Step 1: Review SDLC Documentation

Examine development lifecycle documentation for evidence of PW.9.1 practice implementation.

### Step 2: Verify Tooling

```
# Check CI/CD pipeline configuration
# Verify security tools are integrated

# Example: Check for SAST/DAST in pipeline
grep -r "security\|scan\|sast\|dast" .github/workflows/ 2>/dev/null
grep -r "security\|scan" Jenkinsfile 2>/dev/null
```

### Step 3: Assess Developer Awareness

Verify development team understands and follows PW.9.1 PW.9.1 practice.

## Tools

| Tool                | Purpose                            | Usage                        |
| ------------------- | ---------------------------------- | ---------------------------- |
| github-security-mcp | Check repository security settings | `github_security_*` tools    |
| Manual Review       | SDLC process review                | Documentation and interviews |

## Remediation Guide

Implement PW.9.1 PW.9.1 in the software development lifecycle:

Define a secure baseline by determining how to configure each setting that has an effect on security or a security-related setting so that the default settings are secure and do not weaken the security functions provided by the platform, network infrastructure, or services.

## Risk Assessment

| Finding                       | Severity | Impact                                             |
| ----------------------------- | -------- | -------------------------------------------------- |
| PW.9.1 PW.9.1 not implemented | Medium   | Secure Development - Produce Well-Secured Software |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
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
