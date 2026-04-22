---
name: "Network Disconnect (03.13.09)_network-disconnect"
description: "Network Disconnect"
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - network disconnect (03-13-09)
  - family-03.13
  - cui-protection
  - cmmc
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
  - network
cwe_ids:
  - CWE-311
chains_with: []
prerequisites: []
severity_boost: {}
---

# Network Disconnect (03.13.09) Network Disconnect

## High-Level Description

**Family:** System and Communications Protection
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Network Disconnect

## What to Check

- [ ] Verify Network Disconnect (03.13.09) Network Disconnect is implemented for CUI systems
- [ ] Review SSP documentation for Network Disconnect (03.13.09)
- [ ] Validate CMMC Level 2 assessment objective for Network Disconnect (03.13.09)
- [ ] Confirm POA&M addresses any gaps for Network Disconnect (03.13.09)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Network Disconnect (03.13.09) implementation description and responsible parties.

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

| Tool            | Purpose                      | Usage                  |
| --------------- | ---------------------------- | ---------------------- |
| cloud-audit-mcp | Assess cloud CUI environment | `cloud_audit_*` tools  |
| Manual Review   | SSP and POA&M review         | Documentation analysis |

## Remediation Guide

### Requirement Statement

Implement Network Disconnect per NIST SP 800-171 Rev 3.

### Supplemental Guidance

This requirement applies to internal and external networks. Terminating network connections associated with communications sessions includes deallocating TCP/IP addresses or port pairs at the operating system level or deallocating networking assignments at the application level if multiple application sessions are using a single network connection. Time periods of inactivity may be established by organizations and include time periods by type of network access or for specific network accesses.

## Risk Assessment

| Finding                                                          | Severity | Impact                                                |
| ---------------------------------------------------------------- | -------- | ----------------------------------------------------- |
| Network Disconnect (03.13.09) Network Disconnect not implemented | High     | CUI Protection - System and Communications Protection |
| Network Disconnect (03.13.09) partially implemented (POA&M)      | Medium   | CMMC certification risk                               |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-311 | Missing Encryption of Sensitive Data |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Network Disconnect (03.13.09) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
