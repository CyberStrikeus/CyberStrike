---
name: "Configuration Change Control (03.04.03)_configuration-change-control"
description: "Define the types of changes to the system that are configuration-controlled."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - configuration change control (03-04-03)
  - family-03.04
  - cui-protection
  - cmmc
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-16
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Configuration Change Control (03.04.03) Configuration Change Control

## High-Level Description

**Family:** Configuration Management
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Define the types of changes to the system that are configuration-controlled.
Review proposed configuration-controlled changes to the system, and approve or disapprove such changes with explicit consideration for security impacts.
Implement and document approved configuration-controlled changes to the system.
Monitor and review activities associated with configuration-controlled changes to the system.

## What to Check

- [ ] Verify Configuration Change Control (03.04.03) Configuration Change Control is implemented for CUI systems
- [ ] Review SSP documentation for Configuration Change Control (03.04.03)
- [ ] Validate CMMC Level 2 assessment objective for Configuration Change Control (03.04.03)
- [ ] Confirm POA&M addresses any gaps for Configuration Change Control (03.04.03)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Configuration Change Control (03.04.03) implementation description and responsible parties.

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

Define the types of changes to the system that are configuration-controlled.
Review proposed configuration-controlled changes to the system, and approve or disapprove such changes with explicit consideration for security impacts.
Implement and document approved configuration-controlled changes to the system.
Monitor and review activities associated with configuration-controlled changes to the system.

### Supplemental Guidance

Configuration change control refers to tracking, reviewing, approving or disapproving, and logging changes to the system. Specifically, it involves the systematic proposal, justification, implementation, testing, review, and disposition of changes to the system, including system upgrades and modifications. Configuration change control includes changes to baseline configurations for system components (e.g., operating systems, applications, firewalls, routers, mobile devices) and configuration items of the system, changes to configuration settings, unscheduled and unauthorized changes, and changes to remediate vulnerabilities. This requirement is related to [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.04.04) 03.04.04.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Configuration Change Control (03.04.03) Configuration Change Control not implemented | Medium | CUI Protection - Configuration Management |
| Configuration Change Control (03.04.03) partially implemented (POA&M) | Low | CMMC certification risk |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-16 | Configuration |


## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Configuration Change Control (03.04.03) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
