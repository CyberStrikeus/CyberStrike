---
name: "Least Functionality (03.04.06)_least-functionality"
description: "Configure the system to provide only mission-essential capabilities."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - least functionality (03-04-06)
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
chains_with: []
prerequisites: []
severity_boost: {}
---

# Least Functionality (03.04.06) Least Functionality

## High-Level Description

**Family:** Configuration Management
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Configure the system to provide only mission-essential capabilities.
Prohibit or restrict use of the following functions, ports, protocols, connections, and services: [organization-defined] .
Review the system [organization-defined] to identify unnecessary or nonsecure functions, ports, protocols, connections, and services.
Disable or remove functions, ports, protocols, connections, and services that are unnecessary or nonsecure.

## What to Check

- [ ] Verify Least Functionality (03.04.06) Least Functionality is implemented for CUI systems
- [ ] Review SSP documentation for Least Functionality (03.04.06)
- [ ] Validate CMMC Level 2 assessment objective for Least Functionality (03.04.06)
- [ ] Confirm POA&M addresses any gaps for Least Functionality (03.04.06)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Least Functionality (03.04.06) implementation description and responsible parties.

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

Configure the system to provide only mission-essential capabilities.
Prohibit or restrict use of the following functions, ports, protocols, connections, and services: [organization-defined] .
Review the system [organization-defined] to identify unnecessary or nonsecure functions, ports, protocols, connections, and services.
Disable or remove functions, ports, protocols, connections, and services that are unnecessary or nonsecure.

### Supplemental Guidance

Systems can provide a variety of functions and services. Some functions and services that are routinely provided by default may not be necessary to support essential organizational missions, functions, or operations. It may be convenient to provide multiple services from single system components. However, doing so increases risk over limiting the services provided by any one component. Where feasible, organizations limit functionality to a single function per component. Organizations review the functions and services provided by the system or system components to determine which functions and services are candidates for elimination. Organizations disable unused or unnecessary physical and logical ports and protocols to prevent the unauthorized connection of devices, the transfer of information, and tunneling. Organizations can employ network scanning tools, intrusion detection and prevention systems, and endpoint protection systems (e.g., firewalls and host-based intrusion detection systems) to identify and prevent the use of prohibited functions, ports, protocols, system connections, and services. Bluetooth, File Transfer Protocol (FTP), and peer-to-peer networking are examples of the types of protocols that organizations consider eliminating, restricting, or disabling.

## Risk Assessment

| Finding                                                            | Severity | Impact                                    |
| ------------------------------------------------------------------ | -------- | ----------------------------------------- |
| Least Functionality (03.04.06) Least Functionality not implemented | Medium   | CUI Protection - Configuration Management |
| Least Functionality (03.04.06) partially implemented (POA&M)       | Low      | CMMC certification risk                   |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Least Functionality (03.04.06) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
