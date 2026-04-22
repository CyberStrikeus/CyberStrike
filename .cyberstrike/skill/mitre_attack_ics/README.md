# MITRE ATT&CK ICS Skills

This directory contains **83 SKILL.md files** for the MITRE ATT&CK for Industrial Control Systems (ICS) framework v18.1.

## Overview

- **Framework Version**: 18.1 (October 2025)
- **Domain**: Industrial Control Systems (ICS)
- **Total Techniques**: 83
- **Total Sub-Techniques**: 0
- **Total Skills**: 83
- **Tactics**: 12
- **Platforms**: ICS (SCADA, PLC, RTU, DCS, HMI, Engineering Workstations)

## Directory Structure

Skills are organized by **primary tactic**, with meaningful directory names for fast AI navigation:

```
mitre_attack_ics/
├── TA0108_initial-access/
│   ├── T0817_drive-by-compromise/
│   │   └── SKILL.md
│   └── T0866_exploitation-of-remote-services/
│       └── SKILL.md
├── TA0105_impact/
│   ├── T0826_loss-of-availability/
│   │   └── SKILL.md
│   └── T0827_loss-of-control/
│       └── SKILL.md
└── ...
```

**Naming convention:** `{technique_id}_{slugified-name}/SKILL.md`

## Tactic Breakdown

| Tactic ID | Name | Skills |
|-----------|------|--------|
| TA0100 | Collection | 10 |
| TA0101 | Command and Control | 3 |
| TA0102 | Discovery | 5 |
| TA0103 | Evasion | 6 |
| TA0104 | Execution | 10 |
| TA0105 | Impact | 12 |
| TA0106 | Impair Process Control | 3 |
| TA0107 | Inhibit Response Function | 12 |
| TA0108 | Initial Access | 12 |
| TA0109 | Lateral Movement | 4 |
| TA0110 | Persistence | 5 |
| TA0111 | Privilege Escalation | 1 |
| **Total** | | **83** |

## ICS-Specific Tactics

Unlike Enterprise and Mobile, the ICS domain includes specialized tactics for OT environments:

- **TA0106 Impair Process Control** — Techniques to manipulate, disable, or damage physical control processes
- **TA0107 Inhibit Response Function** — Techniques that prevent operators from responding to failures or attacks

## Multi-Tactic Techniques

Some techniques belong to multiple tactics. These are placed in their **primary tactic** folder, with all tactics listed in the SKILL.md frontmatter under `all_tactics`.

## Lazy Loading & Fast Search

- **By tactic:** Browse `TA0105_impact/` to see all ICS impact techniques
- **By technique ID:** Search for `T0826` to find Loss of Availability
- **By name:** Directory names include slugified technique names — search for `plc`, `scada`, `firmware`, `denial`
- **ICS-specific:** All skills tagged with `ics` in frontmatter for domain-wide filtering
- **Multi-tactic awareness:** `all_tactics` frontmatter field lists every tactic a technique belongs to

## SKILL.md Format

Each SKILL.md contains:

**YAML Frontmatter:**
- `technique_id` — ATT&CK ICS technique ID (T0817, T0826, etc.)
- `tactic` — Primary tactic (kill chain phase)
- `all_tactics` — All tactics this technique belongs to
- `platforms` — ICS platform type
- `mitre_url` — Direct link to ATT&CK ICS page
- `tech_stack` — Always includes `ics`
- `cwe_ids` — Related CWE identifiers
- `chains_with` — Related techniques for attack chaining
- `prerequisites` — Required parent techniques
- `severity_boost` — Chain severity mapping

**Body Sections:**
- **High-Level Description** — Full technique description
- **Kill Chain Phase** — Tactic position with IDs
- **What to Check** — Checklist for ICS assessment
- **How to Test** — Testing methodology for OT environments
- **Remediation Guide** — ICS-specific defensive countermeasures
- **Detection** — Detection strategies for ICS/SCADA
- **Risk Assessment** — Severity and impact on physical processes
- **CWE Categories** — Related weakness classifications
- **References** — External sources and ATT&CK link

## Data Source

- **STIX Repository:** [mitre-attack/attack-stix-data](https://github.com/mitre-attack/attack-stix-data)
- **Format:** STIX 2.1 JSON (`ics-attack.json`)
- **Generator:** `generate_skills.py` in this directory

## Updating

```bash
git clone --depth 1 https://github.com/mitre-attack/attack-stix-data.git /tmp/attack-stix-data
python3 generate_skills.py /tmp/attack-stix-data/ics-attack/ics-attack.json
```

## Contact

- CyberStrike: cyberstrike.io
- MITRE ATT&CK: attack.mitre.org
