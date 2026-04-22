---
name: "System Monitoring (03.14.06)_system-monitoring"
description: "Monitor the system to detect: Attacks and indicators of potential attacks and Unauthorized connections. Identify unauthorized use of the system. Monit"
category: "input-validation"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - system monitoring (03-14-06)
  - family-03.14
  - cui-protection
  - cmmc
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-20
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# System Monitoring (03.14.06) System Monitoring

## High-Level Description

**Family:** System and Information Integrity
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Monitor the system to detect:
Attacks and indicators of potential attacks and
Unauthorized connections.
Identify unauthorized use of the system.
Monitor inbound and outbound communications traffic to detect unusual or unauthorized activities or conditions.

## What to Check

- [ ] Verify System Monitoring (03.14.06) System Monitoring is implemented for CUI systems
- [ ] Review SSP documentation for System Monitoring (03.14.06)
- [ ] Validate CMMC Level 2 assessment objective for System Monitoring (03.14.06)
- [ ] Confirm POA&M addresses any gaps for System Monitoring (03.14.06)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for System Monitoring (03.14.06) implementation description and responsible parties.

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

Monitor the system to detect:
Attacks and indicators of potential attacks and
Unauthorized connections.
Identify unauthorized use of the system.
Monitor inbound and outbound communications traffic to detect unusual or unauthorized activities or conditions.

### Supplemental Guidance

System monitoring involves external and internal monitoring. Internal monitoring includes the observation of events that occur within the system. External monitoring includes the observation of events that occur at the system boundary. Organizations can monitor the system by observing audit record activities in real time or by observing other system aspects, such as access patterns, characteristics of access, and other actions. The monitoring objectives may guide determination of the events. A system monitoring capability is achieved through a variety of tools and techniques (e.g., audit record monitoring software, intrusion detection systems, intrusion prevention systems, malicious code protection software, scanning tools, network monitoring software). Strategic locations for monitoring devices include selected perimeter locations and near server farms that support critical applications with such devices being employed at managed system interfaces. The granularity of monitoring the information collected is based on organizational monitoring objectives and the capability of the system to support such objectives. Systems connections can be network, remote, or local. A network connection is any connection with a device that communicates through a network (e.g., local area network, the internet). A remote connection is any connection with a device that communicates through an external network (e.g., the internet). Network, remote, and local connections can be either wired or wireless. Unusual or unauthorized activities or conditions related to inbound and outbound communications traffic include internal traffic that indicates the presence of malicious code in the system or propagating among system components, the unauthorized export of information, or signaling to external systems. Evidence of malicious code is used to identify a potentially compromised system. System monitoring requirements, including the need for types of system monitoring, may be referenced in other requirements.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| System Monitoring (03.14.06) System Monitoring not implemented | High | CUI Protection - System and Information Integrity |
| System Monitoring (03.14.06) partially implemented (POA&M) | Medium | CMMC certification risk |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents System Monitoring (03.14.06) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
