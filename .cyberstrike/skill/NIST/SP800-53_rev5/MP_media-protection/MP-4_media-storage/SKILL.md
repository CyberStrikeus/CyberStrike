---
name: "MP-4_media-storage"
description: "Physically control and securely store [organization-defined] within [organization-defined] ;"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - mp-4
  - mp
tech_stack:
  - linux
  - windows
cwe_ids:
  []
chains_with:
  - AC-19
  - CP-2
  - CP-6
  - CP-9
  - CP-10
  - MP-2
  - MP-7
  - PE-3
  - PL-2
  - SC-12
prerequisites:
  []
severity_boost:
  AC-19: "Chain with AC-19 for comprehensive security coverage"
  CP-2: "Chain with CP-2 for comprehensive security coverage"
  CP-6: "Chain with CP-6 for comprehensive security coverage"
---

# MP-4 Media Storage

## High-Level Description

**Family:** Media Protection (MP)
**Framework:** NIST SP 800-53 Rev 5

System media includes digital and non-digital media. Digital media includes flash drives, diskettes, magnetic tapes, external or removable hard disk drives (e.g., solid state, magnetic), compact discs, and digital versatile discs. Non-digital media includes paper and microfilm. Physically controlling stored media includes conducting inventories, ensuring procedures are in place to allow individuals to check out and return media to the library, and maintaining accountability for stored media. Secure storage includes a locked drawer, desk, or cabinet or a controlled media library. The type of media storage is commensurate with the security category or classification of the information on the media. Controlled areas are spaces that provide physical and procedural controls to meet the requirements established for protecting information and systems. Fewer controls may be needed for media that contains information determined to be in the public domain, publicly releasable, or have limited adverse impacts on organizations, operations, or individuals if accessed by other than authorized personnel. In these situations, physical access controls provide adequate protection.

## What to Check

- [ ] Verify MP-4 Media Storage is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for MP-4

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for MP-4 implementation details. Verify the organization has documented how this control is satisfied.

### Step 2: Validate Implementation

```
# For cloud environments, use cloud-audit-mcp tools
# For on-premises, review system configurations directly

# Example: Check if account management policies exist
grep -r "account.management\|access.control" /etc/security/ 2>/dev/null
```

### Step 3: Test Operating Effectiveness

Verify the control is actively functioning, not just documented. Check logs, configurations, and operational evidence.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| Manual Review | Documentation and interview-based | N/A |

## Remediation Guide

### Control Statement

Physically control and securely store [organization-defined] within [organization-defined] ; and
Protect system media types defined in MP-4a until the media are destroyed or sanitized using approved equipment, techniques, and procedures.

### Implementation Guidance

System media includes digital and non-digital media. Digital media includes flash drives, diskettes, magnetic tapes, external or removable hard disk drives (e.g., solid state, magnetic), compact discs, and digital versatile discs. Non-digital media includes paper and microfilm. Physically controlling stored media includes conducting inventories, ensuring procedures are in place to allow individuals to check out and return media to the library, and maintaining accountability for stored media. Secure storage includes a locked drawer, desk, or cabinet or a controlled media library. The type of media storage is commensurate with the security category or classification of the information on the media. Controlled areas are spaces that provide physical and procedural controls to meet the requirements established for protecting information and systems. Fewer controls may be needed for media that contains information determined to be in the public domain, publicly releasable, or have limited adverse impacts on organizations, operations, or individuals if accessed by other than authorized personnel. In these situations, physical access controls provide adequate protection.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| MP-4 Media Storage not implemented | Medium | Media Protection |
| MP-4 partially implemented | Low | Incomplete Media Protection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - MP-4](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=mp-4)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-19, CP-2, CP-6, CP-9, CP-10) reviewed
