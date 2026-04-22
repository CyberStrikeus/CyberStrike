# MITRE ATT&CK Mobile Skills

This directory contains **124 SKILL.md files** for the MITRE ATT&CK Mobile framework v18.1.

## Overview

- **Framework Version**: 18.1 (October 2025)
- **Domain**: Mobile
- **Total Techniques**: 77 (main)
- **Total Sub-Techniques**: 47
- **Total Skills**: 124
- **Tactics**: 12
- **Platforms**: Android, iOS

## Directory Structure

Skills are organized by **primary tactic**, with meaningful directory names for fast AI navigation:

```
mitre_attack_mobile/
├── TA0027_initial-access/
│   ├── T1474_supply-chain-compromise/
│   │   └── SKILL.md
│   └── T1474.001_compromise-software-dependencies-and-development-tools/
│       └── SKILL.md
├── TA0041_execution/
│   └── T1575_native-api/
│       └── SKILL.md
└── ...
```

**Naming convention:** `{technique_id}_{slugified-name}/SKILL.md`

## Tactic Breakdown

| Tactic ID | Name | Skills |
|-----------|------|--------|
| TA0027 | Initial Access | 11 |
| TA0028 | Persistence | 7 |
| TA0029 | Privilege Escalation | 3 |
| TA0030 | Defense Evasion | 32 |
| TA0031 | Credential Access | 5 |
| TA0032 | Discovery | 10 |
| TA0033 | Lateral Movement | 1 |
| TA0034 | Impact | 9 |
| TA0035 | Collection | 23 |
| TA0036 | Exfiltration | 3 |
| TA0037 | Command and Control | 16 |
| TA0041 | Execution | 4 |
| **Total** | | **124** |

## Multi-Tactic Techniques

Some techniques belong to multiple tactics. These are placed in their **primary tactic** folder, with all tactics listed in the SKILL.md frontmatter under `all_tactics`.

## Lazy Loading & Fast Search

- **By tactic:** Browse `TA0030_defense-evasion/` to see all mobile defense evasion techniques
- **By technique ID:** Search for `T1474` to find Supply Chain Compromise
- **By name:** Directory names include slugified technique names — search for `clipboard`, `sms`, `keychain`
- **By platform:** Tags in frontmatter include `android` or `ios`
- **Multi-tactic awareness:** `all_tactics` frontmatter field lists every tactic a technique belongs to

## SKILL.md Format

Each SKILL.md contains:

**YAML Frontmatter:**
- `technique_id` — ATT&CK technique ID (T1474, T1474.001, etc.)
- `tactic` — Primary tactic (kill chain phase)
- `all_tactics` — All tactics this technique belongs to
- `platforms` — Target platforms (Android, iOS)
- `mitre_url` — Direct link to ATT&CK page
- `tech_stack` — Target technology stack
- `cwe_ids` — Related CWE identifiers
- `chains_with` — Related techniques for attack chaining
- `prerequisites` — Required parent techniques
- `severity_boost` — Chain severity mapping

**Body Sections:**
- **High-Level Description** — Full technique description
- **Kill Chain Phase** — Tactic position with IDs
- **What to Check** — Checklist for assessment
- **How to Test** — Testing methodology
- **Remediation Guide** — Defensive countermeasures
- **Detection** — Detection strategies
- **Risk Assessment** — Severity and impact
- **CWE Categories** — Related weakness classifications
- **References** — External sources and ATT&CK link

## Data Source

- **STIX Repository:** [mitre-attack/attack-stix-data](https://github.com/mitre-attack/attack-stix-data)
- **Format:** STIX 2.1 JSON (`mobile-attack.json`)
- **Generator:** `generate_skills.py` in this directory

## Updating

```bash
git clone --depth 1 https://github.com/mitre-attack/attack-stix-data.git /tmp/attack-stix-data
python3 generate_skills.py /tmp/attack-stix-data/mobile-attack/mobile-attack.json
```

## Contact

- CyberStrike: cyberstrike.io
- MITRE ATT&CK: attack.mitre.org
