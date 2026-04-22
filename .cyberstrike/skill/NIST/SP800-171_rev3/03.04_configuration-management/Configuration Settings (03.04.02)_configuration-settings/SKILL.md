---
name: "Configuration Settings (03.04.02)_configuration-settings"
description: "Establish, document, and implement the following configuration settings for the system that reflect the most restrictive mode consistent with opera..."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - configuration settings (03-04-02)
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

# Configuration Settings (03.04.02) Configuration Settings

## High-Level Description

**Family:** Configuration Management
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Establish, document, and implement the following configuration settings for the system that reflect the most restrictive mode consistent with operational requirements: [organization-defined] .
Identify, document, and approve any deviations from established configuration settings.

## What to Check

- [ ] Verify Configuration Settings (03.04.02) Configuration Settings is implemented for CUI systems
- [ ] Review SSP documentation for Configuration Settings (03.04.02)
- [ ] Validate CMMC Level 2 assessment objective for Configuration Settings (03.04.02)
- [ ] Confirm POA&M addresses any gaps for Configuration Settings (03.04.02)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Configuration Settings (03.04.02) implementation description and responsible parties.

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

Establish, document, and implement the following configuration settings for the system that reflect the most restrictive mode consistent with operational requirements: [organization-defined] .
Identify, document, and approve any deviations from established configuration settings.

### Supplemental Guidance

Configuration settings are the set of parameters that can be changed in hardware, software, or firmware components of the system and that affect the security posture or functionality of the system. Security-related configuration settings can be defined for systems (e.g., servers, workstations), input and output devices (e.g., scanners, copiers, printers), network components (e.g., firewalls, routers, gateways, voice and data switches, wireless access points, network appliances, sensors), operating systems, middleware, and applications. Security parameters are those parameters that impact the security state of the system, including the parameters required to satisfy other security requirements. Security parameters include registry settings; account, file, and directory permission settings (i.e., privileges); and settings for functions, ports, protocols, and remote connections. Organizations establish organization-wide configuration settings and subsequently derive specific configuration settings for the system. The established settings become part of the system’s configuration baseline. Common secure configurations (also referred to as security configuration checklists, lockdown and hardening guides, security reference guides, and security technical implementation guides) provide recognized, standardized, and established benchmarks that stipulate secure configuration settings for specific information technology platforms/products and instructions for configuring those system components to meet operational requirements. Common secure configurations can be developed by a variety of organizations, including information technology product developers, manufacturers, vendors, consortia, academia, industry, federal agencies, and other organizations in the public and private sectors.

## Risk Assessment

| Finding                                                                  | Severity | Impact                                    |
| ------------------------------------------------------------------------ | -------- | ----------------------------------------- |
| Configuration Settings (03.04.02) Configuration Settings not implemented | Medium   | CUI Protection - Configuration Management |
| Configuration Settings (03.04.02) partially implemented (POA&M)          | Low      | CMMC certification risk                   |

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

- [ ] SSP documents Configuration Settings (03.04.02) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
