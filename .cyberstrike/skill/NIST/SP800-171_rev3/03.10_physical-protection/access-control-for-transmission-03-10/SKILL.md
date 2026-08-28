---
name: "Access Control for Transmission (03.10.08)_access-control-for-transmission"
description: "Access Control for Transmission"
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - access control for transmission (03-10-08)
  - family-03.10
  - cui-protection
  - cmmc
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Access Control for Transmission (03.10.08) Access Control for Transmission

## High-Level Description

**Family:** Physical Protection
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Access Control for Transmission

## What to Check

- [ ] Verify Access Control for Transmission (03.10.08) Access Control for Transmission is implemented for CUI systems
- [ ] Review SSP documentation for Access Control for Transmission (03.10.08)
- [ ] Validate CMMC Level 2 assessment objective for Access Control for Transmission (03.10.08)
- [ ] Confirm POA&M addresses any gaps for Access Control for Transmission (03.10.08)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Access Control for Transmission (03.10.08) implementation description and responsible parties.

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

Implement Access Control for Transmission per NIST SP 800-171 Rev 3.

### Supplemental Guidance

Safeguarding measures applied to system distribution and transmission lines prevent accidental damage, disruption, and physical tampering. Such measures may also be necessary to prevent eavesdropping or the modification of unencrypted transmissions. Safeguarding measures used to control physical access to system distribution and transmission lines include disconnected or locked spare jacks, locked wiring closets, cabling protection with conduit or cable trays, and wiretapping sensors.

## Risk Assessment

| Finding                                                                                    | Severity | Impact                               |
| ------------------------------------------------------------------------------------------ | -------- | ------------------------------------ |
| Access Control for Transmission (03.10.08) Access Control for Transmission not implemented | Medium   | CUI Protection - Physical Protection |
| Access Control for Transmission (03.10.08) partially implemented (POA&M)                   | Low      | CMMC certification risk              |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Access Control for Transmission (03.10.08) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
