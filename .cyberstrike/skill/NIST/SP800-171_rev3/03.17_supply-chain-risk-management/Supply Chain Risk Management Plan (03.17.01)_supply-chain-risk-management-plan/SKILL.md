---
name: "Supply Chain Risk Management Plan (03.17.01)_supply-chain-risk-management-plan"
description: "Develop a plan for managing supply chain risks associated with the research and development, design, manufacturing, acquisition, delivery, integrat..."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - supply chain risk management plan (03-17-01)
  - family-03.17
  - cui-protection
  - cmmc
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Supply Chain Risk Management Plan (03.17.01) Supply Chain Risk Management Plan

## High-Level Description

**Family:** Supply Chain Risk Management
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Develop a plan for managing supply chain risks associated with the research and development, design, manufacturing, acquisition, delivery, integration, operations, maintenance, and disposal of the system, system components, or system services.
Review and update the supply chain risk management plan [organization-defined].
Protect the supply chain risk management plan from unauthorized disclosure.

## What to Check

- [ ] Verify Supply Chain Risk Management Plan (03.17.01) Supply Chain Risk Management Plan is implemented for CUI systems
- [ ] Review SSP documentation for Supply Chain Risk Management Plan (03.17.01)
- [ ] Validate CMMC Level 2 assessment objective for Supply Chain Risk Management Plan (03.17.01)
- [ ] Confirm POA&M addresses any gaps for Supply Chain Risk Management Plan (03.17.01)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Supply Chain Risk Management Plan (03.17.01) implementation description and responsible parties.

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

Develop a plan for managing supply chain risks associated with the research and development, design, manufacturing, acquisition, delivery, integration, operations, maintenance, and disposal of the system, system components, or system services.
Review and update the supply chain risk management plan [organization-defined].
Protect the supply chain risk management plan from unauthorized disclosure.

### Supplemental Guidance

Dependence on the products, systems, and services of external providers and the nature of the relationships with those providers present an increasing level of risk to an organization. Threat actions that may increase security risks include unauthorized production, the insertion or use of counterfeits, tampering, poor manufacturing and development practices in the supply chain, theft, and the insertion of malicious software, firmware, and hardware. Supply chain risks can be endemic or systemic within a system, component, or service. Managing supply chain risks is a complex, multifaceted undertaking that requires a coordinated effort across an organization to build trust relationships and communicate with internal and external stakeholders. Supply chain risk management (SCRM) activities include identifying and assessing risks, determining appropriate risk response actions, developing SCRM plans to document response actions, and monitoring performance against the plans. The system-level SCRM plan is implementation-specific and provides constraints, policy implementation, requirements, and implications. It can either be stand-alone or incorporated into system security plans. The SCRM plan addresses the management, implementation, and monitoring of SCRM requirements and the development or sustainment of systems across the system development life cycle to support mission and business functions. Because supply chains can differ significantly across and within organizations, SCRM plans are tailored to individual program, organizational, and operational contexts.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Supply Chain Risk Management Plan (03.17.01) Supply Chain Risk Management Plan not implemented | Medium | CUI Protection - Supply Chain Risk Management |
| Supply Chain Risk Management Plan (03.17.01) partially implemented (POA&M) | Low | CMMC certification risk |

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

- [ ] SSP documents Supply Chain Risk Management Plan (03.17.01) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
