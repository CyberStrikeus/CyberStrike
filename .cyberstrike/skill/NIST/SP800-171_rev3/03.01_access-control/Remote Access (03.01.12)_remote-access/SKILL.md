---
name: "Remote Access (03.01.12)_remote-access"
description: "Establish usage restrictions, configuration requirements, and connection requirements for each type of allowable remote system access."
category: "authorization"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - remote access (03-01-12)
  - family-03.01
  - cui-protection
  - cmmc
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-284
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Remote Access (03.01.12) Remote Access

## High-Level Description

**Family:** Access Control
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Establish usage restrictions, configuration requirements, and connection requirements for each type of allowable remote system access.
Authorize each type of remote system access prior to establishing such connections.
Route remote access to the system through authorized and managed access control points.
Authorize the remote execution of privileged commands and remote access to security-relevant information.

## What to Check

- [ ] Verify Remote Access (03.01.12) Remote Access is implemented for CUI systems
- [ ] Review SSP documentation for Remote Access (03.01.12)
- [ ] Validate CMMC Level 2 assessment objective for Remote Access (03.01.12)
- [ ] Confirm POA&M addresses any gaps for Remote Access (03.01.12)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Remote Access (03.01.12) implementation description and responsible parties.

### Step 2: Assess Implementation

```
# Verify security controls protecting CUI
# Check access controls, encryption, monitoring as applicable

# For Linux systems:
ls -la /etc/security/ 2>/dev/null
grep -r "CUI\|controlled" /etc/security/ 2>/dev/null

# For cloud:
# Use cloud-audit-mcp tools to assess posture
```

### Step 3: CMMC Assessment Validation

Verify this requirement passes CMMC Level 2 assessment methodology per SP 800-171A Rev 3.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| cloud-audit-mcp | Assess cloud CUI environment | `cloud_audit_*` tools |
| Manual Review | SSP and POA&M review | Documentation analysis |

## Remediation Guide

### Requirement Statement

Establish usage restrictions, configuration requirements, and connection requirements for each type of allowable remote system access.
Authorize each type of remote system access prior to establishing such connections.
Route remote access to the system through authorized and managed access control points.
Authorize the remote execution of privileged commands and remote access to security-relevant information.

### Supplemental Guidance

Remote access is access to systems (or processes acting on behalf of users) that communicate through external networks, such as the internet. Monitoring and controlling remote access methods allows organizations to detect attacks and ensure compliance with remote access policies. Routing remote access through managed access control points enhances explicit control over such connections and reduces susceptibility to unauthorized access to the system, which could result in the unauthorized disclosure of CUI. Remote access to the system represents a significant potential vulnerability that can be exploited by adversaries. Restricting the execution of privileged commands and access to security-relevant information via remote access reduces the exposure of the organization and its susceptibility to threats by adversaries. A privileged command is a human-initiated command executed on a system that involves the control, monitoring, or administration of the system, including security functions and security-relevant information. Security-relevant information is information that can potentially impact the operation of security functions or the provision of security services in a manner that could result in failure to enforce the system security policy or maintain isolation of code and data. Privileged commands give individuals the ability to execute sensitive, security-critical, or security-relevant system functions.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Remote Access (03.01.12) Remote Access not implemented | High | CUI Protection - Access Control |
| Remote Access (03.01.12) partially implemented (POA&M) | Medium | CMMC certification risk |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-284 | Improper Access Control |


## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Remote Access (03.01.12) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
