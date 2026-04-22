# NIST Cybersecurity Framework Skills

This directory contains **1,606 SKILL.md files** across 4 NIST publications.

## Overview

| Publication          | Version | Skills    | Structure                                       |
| -------------------- | ------- | --------- | ----------------------------------------------- |
| **SP 800-53 Rev 5**  | 5.2.0   | 1,196     | 20 families → 324 controls + 872 enhancements   |
| **CSF v2.0**         | 2.0     | 219       | 6 functions → 34 categories → 185 subcategories |
| **SP 800-171 Rev 3** | 3.0     | 130       | 17 families → 130 requirements                  |
| **SP 800-218 SSDF**  | 1.1     | 61        | 4 groups → 19 practices + 42 tasks              |
| **Total**            |         | **1,606** |                                                 |

## Directory Structure

```
NIST/
├── SP800-53_rev5/
│   ├── AC_access-control/
│   │   ├── AC-01_policy-and-procedures/SKILL.md
│   │   ├── AC-02_account-management/SKILL.md
│   │   └── AC-02.01_automated-system-account-management/SKILL.md
│   ├── AU_audit-and-accountability/
│   ├── IA_identification-and-authentication/
│   └── ... (20 families)
├── CSF_v2.0/
│   ├── GV_govern/
│   │   ├── GV.OC_organizational-context/SKILL.md
│   │   └── GV.OC-01_mission-is-understood/SKILL.md
│   ├── PR_protect/
│   └── ... (6 functions)
├── SP800-171_rev3/
│   ├── 03.01_access-control/
│   │   └── 03.01.01_account-management/SKILL.md
│   └── ... (17 families)
└── SP800-218_SSDF/
    ├── PO_prepare-the-organization/
    │   ├── PO.1_define-security-requirements/SKILL.md
    │   └── PO.1.1_task/SKILL.md
    └── ... (4 practice groups)
```

## SP 800-53 Rev 5 — Security and Privacy Controls

The most comprehensive NIST publication. 20 control families:

| Family | Name                                      | Skills |
| ------ | ----------------------------------------- | ------ |
| AC     | Access Control                            | 147    |
| AT     | Awareness and Training                    | 17     |
| AU     | Audit and Accountability                  | 69     |
| CA     | Assessment, Authorization, and Monitoring | 32     |
| CM     | Configuration Management                  | 66     |
| CP     | Contingency Planning                      | 56     |
| IA     | Identification and Authentication         | 74     |
| IR     | Incident Response                         | 42     |
| MA     | Maintenance                               | 30     |
| MP     | Media Protection                          | 30     |
| PE     | Physical and Environmental Protection     | 59     |
| PL     | Planning                                  | 17     |
| PM     | Program Management                        | 37     |
| PS     | Personnel Security                        | 18     |
| PT     | PII Processing and Transparency           | 21     |
| RA     | Risk Assessment                           | 26     |
| SA     | System and Services Acquisition           | 147    |
| SC     | System and Communications Protection      | 162    |
| SI     | System and Information Integrity          | 119    |
| SR     | Supply Chain Risk Management              | 27     |

## CSF v2.0 — Cybersecurity Framework

6 core functions for organizational cybersecurity:

| Function | Name     | Skills |
| -------- | -------- | ------ |
| GV       | Govern   | 37     |
| ID       | Identify | 46     |
| PR       | Protect  | 66     |
| DE       | Detect   | 25     |
| RS       | Respond  | 30     |
| RC       | Recover  | 15     |

## SP 800-171 Rev 3 — Protecting CUI

Requirements for protecting Controlled Unclassified Information (CUI) in non-federal systems. Aligned with CMMC Level 2.

## SP 800-218 SSDF — Secure Software Development

Framework for integrating security into the SDLC. 4 practice groups: Prepare the Organization, Protect Software, Produce Well-Secured Software, Respond to Vulnerabilities.

## Lazy Loading & Fast Search

- **By publication:** Browse `SP800-53_rev5/` for security controls
- **By family/function:** `AC_access-control/` for all access control skills
- **By control ID:** Search for `AC-02` to find Account Management
- **By name:** Directory names include slugified titles — search for `encryption`, `authentication`, `logging`
- **Cross-framework:** Skills reference related controls via `chains_with`

## Data Source

- **OSCAL Repository:** [usnistgov/oscal-content](https://github.com/usnistgov/oscal-content)
- **Format:** OSCAL JSON (Catalog model)
- **Generators:** `generate_sp800_53.py`, `generate_csf.py`, `generate_sp800_171.py`, `generate_ssdf.py`

## Updating

```bash
git clone --depth 1 https://github.com/usnistgov/oscal-content.git /tmp/oscal-content

python3 generate_sp800_53.py /tmp/oscal-content/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json
python3 generate_csf.py /tmp/oscal-content/nist.gov/CSF/v2.0/json/NIST_CSF_v2.0_catalog.json
python3 generate_sp800_171.py /tmp/oscal-content/nist.gov/SP800-171/rev3/json/NIST_SP800-171_rev3_catalog.json
python3 generate_ssdf.py /tmp/oscal-content/nist.gov/SP800-218/ver1/json/NIST_SP800-218_ver1_catalog.json
```

## Contact

- CyberStrike: cyberstrike.io
- NIST CSRC: csrc.nist.gov
