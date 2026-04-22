# MITRE ATT&CK Enterprise Skills

This directory contains **691 SKILL.md files** for the MITRE ATT&CK Enterprise framework v18.1.

## Overview

- **Framework Version**: 18.1 (October 2025)
- **Domain**: Enterprise
- **Total Techniques**: 216 (main)
- **Total Sub-Techniques**: 475
- **Total Skills**: 691
- **Tactics**: 14

## Directory Structure

Skills are organized by **primary tactic**, with meaningful directory names for fast AI navigation:

```
mitre_attack/
├── TA0001_initial-access/
│   ├── T1189_drive-by-compromise/
│   │   └── SKILL.md
│   └── T1190_exploit-public-facing-application/
│       └── SKILL.md
├── TA0002_execution/
│   ├── T1059_command-and-scripting-interpreter/
│   │   └── SKILL.md
│   └── T1059.001_powershell/
│       └── SKILL.md
└── ...
```

**Naming convention:** `{technique_id}_{slugified-name}/SKILL.md`
- Main technique: `T1059_command-and-scripting-interpreter/`
- Sub-technique: `T1059.001_powershell/`

## Tactic Breakdown

| Tactic ID | Name | Skills |
|-----------|------|--------|
| TA0043 | Reconnaissance | 45 |
| TA0042 | Resource Development | 47 |
| TA0001 | Initial Access | 15 |
| TA0002 | Execution | 45 |
| TA0003 | Persistence | 80 |
| TA0004 | Privilege Escalation | 25 |
| TA0005 | Defense Evasion | 183 |
| TA0006 | Credential Access | 62 |
| TA0007 | Discovery | 43 |
| TA0008 | Lateral Movement | 17 |
| TA0009 | Collection | 36 |
| TA0010 | Exfiltration | 19 |
| TA0011 | Command and Control | 41 |
| TA0040 | Impact | 33 |
| **Total** | | **691** |

## Multi-Tactic Techniques

154 techniques belong to multiple tactics (e.g., Persistence + Privilege Escalation). These are placed in their **primary tactic** folder, with all tactics listed in the SKILL.md frontmatter under `all_tactics`.

## Lazy Loading & Fast Search

- **By tactic:** Browse `TA0001_initial-access/` to see all initial access techniques
- **By technique ID:** Search for `T1059` to find Command and Scripting Interpreter
- **By name:** Directory names include slugified technique names — search for `powershell`, `phishing`, `credential-dumping`
- **By platform:** Tags in frontmatter include platform (windows, linux, macos, etc.)
- **Multi-tactic awareness:** `all_tactics` frontmatter field lists every tactic a technique belongs to

## SKILL.md Format

Each SKILL.md contains:

**YAML Frontmatter:**
- `technique_id` — ATT&CK technique ID (T1059, T1059.001, etc.)
- `tactic` — Primary tactic (kill chain phase)
- `all_tactics` — All tactics this technique belongs to
- `platforms` — Target platforms (Windows, Linux, macOS, etc.)
- `mitre_url` — Direct link to ATT&CK page
- `severity_boost` — Estimated severity (low/medium/high)

**Body Sections:**
- **Tactic** — Kill chain position with tactic IDs
- **Platforms** — Target operating systems/environments
- **Description** — Full technique description from ATT&CK
- **Mitigations** — Defensive countermeasures (with mitigation IDs)
- **Detection** — Detection data components and strategies
- **References** — External sources and ATT&CK link

## Data Source

- **STIX Repository:** [mitre-attack/attack-stix-data](https://github.com/mitre-attack/attack-stix-data)
- **Format:** STIX 2.1 JSON (`enterprise-attack.json`)
- **Generator:** `generate_skills.py` in this directory

## Updating

To regenerate skills from a newer ATT&CK version:

```bash
# Clone latest STIX data
git clone --depth 1 https://github.com/mitre-attack/attack-stix-data.git /tmp/attack-stix-data

# Regenerate skills
python3 generate_skills.py /tmp/attack-stix-data/enterprise-attack/enterprise-attack.json
```

## Contact

- CyberStrike: cyberstrike.io
- MITRE ATT&CK: attack.mitre.org
