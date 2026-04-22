---
name: "Literacy Training and Awareness (03.02.01)_literacy-training-and-awareness"
description: "Provide security literacy training to system users: As part of initial training for new users and [organization-defined] thereafter, When required by "
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - literacy training and awareness (03-02-01)
  - family-03.02
  - cui-protection
  - cmmc
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Literacy Training and Awareness (03.02.01) Literacy Training and Awareness

## High-Level Description

**Family:** Awareness and Training
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Provide security literacy training to system users:
As part of initial training for new users and [organization-defined] thereafter,
When required by system changes or following [organization-defined], and
On recognizing and reporting indicators of insider threat, social engineering, and social mining.
Update security literacy training content [organization-defined] and following [organization-defined].

## What to Check

- [ ] Verify Literacy Training and Awareness (03.02.01) Literacy Training and Awareness is implemented for CUI systems
- [ ] Review SSP documentation for Literacy Training and Awareness (03.02.01)
- [ ] Validate CMMC Level 2 assessment objective for Literacy Training and Awareness (03.02.01)
- [ ] Confirm POA&M addresses any gaps for Literacy Training and Awareness (03.02.01)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Literacy Training and Awareness (03.02.01) implementation description and responsible parties.

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

Provide security literacy training to system users:
As part of initial training for new users and [organization-defined] thereafter,
When required by system changes or following [organization-defined], and
On recognizing and reporting indicators of insider threat, social engineering, and social mining.
Update security literacy training content [organization-defined] and following [organization-defined].

### Supplemental Guidance

Organizations provide basic and advanced levels of security literacy training to system users (including managers, senior executives, system administrators, and contractors) and measures to test the knowledge level of users. Organizations determine the content of literacy training based on specific organizational requirements, the systems to which personnel have authorized access, and work environments (e.g., telework). The content includes an understanding of the need for security and the actions required of users to maintain security and respond to incidents. The content also addresses the need for operations security and the handling of CUI. Security awareness techniques include displaying posters, offering supplies inscribed with security reminders, generating email advisories or notices from organizational officials, displaying logon screen messages, and conducting awareness events using podcasts, videos, and webinars. Security literacy training is conducted at a frequency consistent with applicable laws, directives, regulations, and policies. Updating literacy training content on a regular basis ensures that the content remains relevant. Events that may precipitate an update to literacy training content include assessment or audit findings, security incidents or breaches, or changes in applicable laws, Executive Orders, directives, regulations, policies, standards, and guidelines. Potential indicators and possible precursors of insider threats include behaviors such as inordinate, long-term job dissatisfaction; attempts to gain access to information that is not required for job performance; unexplained access to financial resources; sexual harassment or bullying of fellow employees; workplace violence; and other serious violations of the policies, procedures, rules, directives, or practices of organizations. Organizations may consider tailoring insider threat awareness topics to roles (e.g., training for managers may be focused on specific changes in the behavior of team members, while training for employees may be focused on more general observations). Social engineering is an attempt to deceive an individual into revealing information or taking an action that can be used to breach, compromise, or otherwise adversely impact a system. Social engineering includes phishing, pretexting, impersonation, baiting, quid pro quo, threadjacking, social media exploitation, and tailgating. Social mining is an attempt to gather information about the organization that may be used to support future attacks. Security literacy training includes how to communicate employee and management concerns regarding potential indicators of insider threat and potential and actual instances of social engineering and data mining through appropriate organizational channels in accordance with established policies and procedures.

## Risk Assessment

| Finding                                                                                    | Severity | Impact                                  |
| ------------------------------------------------------------------------------------------ | -------- | --------------------------------------- |
| Literacy Training and Awareness (03.02.01) Literacy Training and Awareness not implemented | Medium   | CUI Protection - Awareness and Training |
| Literacy Training and Awareness (03.02.01) partially implemented (POA&M)                   | Low      | CMMC certification risk                 |

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

- [ ] SSP documents Literacy Training and Awareness (03.02.01) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
