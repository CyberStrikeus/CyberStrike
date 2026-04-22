---
name: "Media Use (03.08.07)_media-use"
description: "Restrict or prohibit the use of [organization-defined]."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - media use (03-08-07)
  - family-03.08
  - cui-protection
  - cmmc
tech_stack:
  - linux
  - windows
cwe_ids:
  []
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Media Use (03.08.07) Media Use

## High-Level Description

**Family:** Media Protection
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Restrict or prohibit the use of [organization-defined].
Prohibit the use of removable system media without an identifiable owner.

## What to Check

- [ ] Verify Media Use (03.08.07) Media Use is implemented for CUI systems
- [ ] Review SSP documentation for Media Use (03.08.07)
- [ ] Validate CMMC Level 2 assessment objective for Media Use (03.08.07)
- [ ] Confirm POA&M addresses any gaps for Media Use (03.08.07)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Media Use (03.08.07) implementation description and responsible parties.

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

Restrict or prohibit the use of [organization-defined].
Prohibit the use of removable system media without an identifiable owner.

### Supplemental Guidance

In contrast to requirement [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.08.01)03.08.01, which restricts user access to media, this requirement restricts or prohibits the use of certain types of media, such as external hard drives, flash drives, or smart displays. Organizations can use technical and non-technical measures (e.g., policies, procedures, and rules of behavior) to control the use of system media. For example, organizations may control the use of portable storage devices by using physical cages on workstations to prohibit access to external ports or disabling or removing the ability to insert, read, or write to devices. Organizations may limit the use of portable storage devices to only approved devices, including devices provided by the organization, devices provided by other approved organizations, and devices that are not personally owned. Organizations may also control the use of portable storage devices based on the type of device — prohibiting the use of writeable, portable devices — and implement this restriction by disabling or removing the capability to write to such devices. Limits on the use of organization-controlled system media in external systems include restrictions on how the media may be used and under what conditions. Requiring identifiable owners (e.g., individuals, organizations, or projects) for removable system media reduces the risk of using such technologies by allowing organizations to assign responsibility and accountability for addressing known vulnerabilities in the media (e.g., insertion of malicious code).

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Media Use (03.08.07) Media Use not implemented | Medium | CUI Protection - Media Protection |
| Media Use (03.08.07) partially implemented (POA&M) | Low | CMMC certification risk |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Media Use (03.08.07) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
