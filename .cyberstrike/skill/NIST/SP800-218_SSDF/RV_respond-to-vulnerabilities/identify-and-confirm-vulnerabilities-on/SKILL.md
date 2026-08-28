---
name: "Identify and Confirm Vulnerabilities on an Ongoing Basis (RV.1)_identify-and-confirm-vulnerabilities-on-an-ongoing-basis"
description: "Help ensure that vulnerabilities are identified more quickly so that they can be remediated more quickly in accordance with risk, reducing the window "
category: "configuration"
version: "1.1"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-218
  - ssdf
  - identify and confirm vulnerabilities on an ongoing basis (rv-1)
  - rv
  - secure-development
  - practice
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Identify and Confirm Vulnerabilities on an Ongoing Basis (RV.1) Identify and Confirm Vulnerabilities on an Ongoing Basis

## High-Level Description

**Practice Group:** Respond to Vulnerabilities (RV)
**Framework:** NIST SP 800-218 SSDF v1.1

Help ensure that vulnerabilities are identified more quickly so that they can be remediated more quickly in accordance with risk, reducing the window of opportunity for attackers.

## What to Check

- [ ] Verify Identify and Confirm Vulnerabilities on an Ongoing Basis (RV.1) Identify and Confirm Vulnerabilities on an Ongoing Basis is integrated into SDLC
- [ ] Review CI/CD pipeline for Identify and Confirm Vulnerabilities on an Ongoing Basis (RV.1) implementation
- [ ] Confirm automated tooling supports this practice

## How to Test

### Step 1: Review SDLC Documentation

Examine development lifecycle documentation for evidence of Identify and Confirm Vulnerabilities on an Ongoing Basis (RV.1) practice implementation.

### Step 2: Verify Tooling

```
# Check CI/CD pipeline configuration
# Verify security tools are integrated

# Example: Check for SAST/DAST in pipeline
grep -r "security\|scan\|sast\|dast" .github/workflows/ 2>/dev/null
grep -r "security\|scan" Jenkinsfile 2>/dev/null
```

### Step 3: Assess Developer Awareness

Verify development team understands and follows Identify and Confirm Vulnerabilities on an Ongoing Basis (RV.1) Identify and Confirm Vulnerabilities on an Ongoing Basis practice.

## Tools

| Tool                | Purpose                            | Usage                        |
| ------------------- | ---------------------------------- | ---------------------------- |
| github-security-mcp | Check repository security settings | `github_security_*` tools    |
| Manual Review       | SDLC process review                | Documentation and interviews |

## Remediation Guide

Implement Identify and Confirm Vulnerabilities on an Ongoing Basis (RV.1) Identify and Confirm Vulnerabilities on an Ongoing Basis in the software development lifecycle:

Help ensure that vulnerabilities are identified more quickly so that they can be remediated more quickly in accordance with risk, reducing the window of opportunity for attackers.

## Risk Assessment

| Finding                                                                                                                                  | Severity | Impact                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------- |
| Identify and Confirm Vulnerabilities on an Ongoing Basis (RV.1) Identify and Confirm Vulnerabilities on an Ongoing Basis not implemented | Medium   | Secure Development - Respond to Vulnerabilities |

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
