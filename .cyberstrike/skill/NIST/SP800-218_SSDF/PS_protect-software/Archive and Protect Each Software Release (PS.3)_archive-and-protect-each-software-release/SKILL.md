---
name: "Archive and Protect Each Software Release (PS.3)_archive-and-protect-each-software-release"
description: "Preserve software releases in order to help identify, analyze, and eliminate vulnerabilities discovered in the software after release."
category: "authorization"
version: "1.1"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-218
  - ssdf
  - archive and protect each software release (ps-3)
  - ps
  - secure-development
  - practice
tech_stack:
  - git
  - ci-cd
  - docker
cwe_ids:
  - CWE-284
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Archive and Protect Each Software Release (PS.3) Archive and Protect Each Software Release

## High-Level Description

**Practice Group:** Protect Software (PS)
**Framework:** NIST SP 800-218 SSDF v1.1

Preserve software releases in order to help identify, analyze, and eliminate vulnerabilities discovered in the software after release.

## What to Check

- [ ] Verify Archive and Protect Each Software Release (PS.3) Archive and Protect Each Software Release is integrated into SDLC
- [ ] Review CI/CD pipeline for Archive and Protect Each Software Release (PS.3) implementation
- [ ] Confirm automated tooling supports this practice

## How to Test

### Step 1: Review SDLC Documentation

Examine development lifecycle documentation for evidence of Archive and Protect Each Software Release (PS.3) practice implementation.

### Step 2: Verify Tooling

```
# Check CI/CD pipeline configuration
# Verify security tools are integrated

# Example: Check for SAST/DAST in pipeline
grep -r "security\|scan\|sast\|dast" .github/workflows/ 2>/dev/null
grep -r "security\|scan" Jenkinsfile 2>/dev/null
```

### Step 3: Assess Developer Awareness

Verify development team understands and follows Archive and Protect Each Software Release (PS.3) Archive and Protect Each Software Release practice.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| github-security-mcp | Check repository security settings | `github_security_*` tools |
| Manual Review | SDLC process review | Documentation and interviews |

## Remediation Guide

Implement Archive and Protect Each Software Release (PS.3) Archive and Protect Each Software Release in the software development lifecycle:

Preserve software releases in order to help identify, analyze, and eliminate vulnerabilities discovered in the software after release.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Archive and Protect Each Software Release (PS.3) Archive and Protect Each Software Release not implemented | Medium | Secure Development - Protect Software |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-284 | Improper Access Control |


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
