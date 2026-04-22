#!/usr/bin/env python3
"""
MITRE ATT&CK Enterprise SKILL.md Generator for CyberStrike
Reads STIX 2.1 JSON and generates skill files organized by tactic.

Follows SKILL_GUIDE.md conventions:
- name field matches directory name
- severity_boost is a map (not string)
- tech_stack populated from platforms
- chains_with populated from sub-technique relationships
- Content follows Offensive/Pentest template structure

Usage:
    python3 generate_skills.py /path/to/enterprise-attack.json

Directory structure:
    mitre_attack/
    ├── TA0001_initial-access/
    │   ├── T1189_drive-by-compromise/
    │   │   └── SKILL.md
    │   └── T1190_exploit-public-facing-application/
    │       └── SKILL.md
    └── TA0002_execution/
        ├── T1059_command-and-scripting-interpreter/
        │   └── SKILL.md
        └── T1059.001_powershell/
            └── SKILL.md
"""

import json
import re
import sys
from pathlib import Path


# Map ATT&CK platforms to tech_stack values
PLATFORM_MAP = {
    'Windows': 'windows',
    'Linux': 'linux',
    'macOS': 'macos',
    'Network': 'network',
    'Containers': 'containers',
    'IaaS': 'cloud',
    'SaaS': 'saas',
    'Office Suite': 'office',
    'Identity Provider': 'identity',
    'Google Workspace': 'google-workspace',
    'Azure AD': 'azure-ad',
    'Office 365': 'office-365',
    'PRE': 'pre',
    'ESXi': 'esxi',
}

# Tactic to MITRE ATT&CK category mapping
TACTIC_CATEGORIES = {
    'reconnaissance': 'information-gathering',
    'resource-development': 'information-gathering',
    'initial-access': 'input-validation',
    'execution': 'input-validation',
    'persistence': 'configuration',
    'privilege-escalation': 'authorization',
    'defense-evasion': 'configuration',
    'credential-access': 'authentication',
    'discovery': 'information-gathering',
    'lateral-movement': 'authorization',
    'collection': 'information-gathering',
    'exfiltration': 'client-side',
    'command-and-control': 'configuration',
    'impact': 'business-logic',
}


def slugify(name):
    """Convert technique name to URL-friendly slug for directory names."""
    s = name.lower()
    s = re.sub(r'[^a-z0-9\s-]', '', s)
    s = re.sub(r'[\s]+', '-', s)
    s = re.sub(r'-+', '-', s)
    return s.strip('-')


def clean_description(desc):
    """Clean STIX description for markdown."""
    if not desc:
        return ''
    desc = re.sub(r'\[([^\]]+)\]\(https://attack\.mitre\.org/[^)]+\)', r'\1', desc)
    desc = re.sub(r'\(Citation:\s*[^)]+\)', '', desc)
    desc = re.sub(r'  +', ' ', desc)
    return desc.strip()


def oneliner(desc):
    """Extract first sentence for YAML description field."""
    if not desc:
        return ''
    clean = clean_description(desc)
    match = re.match(r'^(.+?\.)\s', clean)
    line = match.group(1) if match else clean[:200]
    if len(line) > 200:
        line = line[:197] + '...'
    line = line.replace('"', '\\"')
    return line


def build_lookup(data):
    """Build ID -> object lookup dict."""
    return {obj['id']: obj for obj in data['objects']}


def build_technique_id_map(techniques):
    """Build ext_id -> technique lookup and parent->children map."""
    id_map = {}
    children_map = {}
    for tech in techniques:
        ext_id = tech['external_references'][0]['external_id']
        id_map[ext_id] = tech
        if tech.get('x_mitre_is_subtechnique', False):
            parent_id = ext_id.split('.')[0]
            children_map.setdefault(parent_id, []).append(ext_id)
    return id_map, children_map


def get_mitigations(tech_id, relationships, lookup):
    """Get mitigations for a technique via relationships."""
    results = []
    for rel in relationships:
        if (rel.get('target_ref') == tech_id and
            rel.get('relationship_type') == 'mitigates' and
            not rel.get('revoked', False)):
            source = lookup.get(rel['source_ref'])
            if source and not source.get('revoked', False):
                ext_id = ''
                if source.get('external_references'):
                    ext_id = source['external_references'][0].get('external_id', '')
                results.append({
                    'id': ext_id,
                    'name': source.get('name', ''),
                    'description': clean_description(rel.get('description', source.get('description', '')))
                })
    return results


def get_detections(tech_id, relationships, lookup):
    """Get detection data components for a technique."""
    results = []
    for rel in relationships:
        if (rel.get('target_ref') == tech_id and
            rel.get('relationship_type') == 'detects' and
            not rel.get('revoked', False)):
            source = lookup.get(rel['source_ref'])
            if source and not source.get('revoked', False):
                results.append({
                    'name': source.get('name', ''),
                    'description': clean_description(rel.get('description', ''))
                })
    return results


def build_chains_with(ext_id, is_sub, children_map):
    """Build chains_with list from technique relationships."""
    chains = []
    if is_sub:
        parent_id = ext_id.split('.')[0]
        chains.append(parent_id)
        siblings = children_map.get(parent_id, [])
        for s in sorted(siblings):
            if s != ext_id:
                chains.append(s)
    else:
        children = children_map.get(ext_id, [])
        for c in sorted(children):
            chains.append(c)
    return chains


def generate_skill_md(tech, tactic_info, mitigations, detections, is_sub, dir_name, children_map):
    """Generate SKILL.md content following SKILL_GUIDE.md conventions."""
    ext_id = tech['external_references'][0]['external_id']
    name = tech['name']
    desc = tech.get('description', '')
    clean_desc = clean_description(desc)
    platforms = tech.get('x_mitre_platforms', [])
    all_tactics = [p['phase_name'] for p in tech.get('kill_chain_phases', [])]
    primary_tactic = all_tactics[0] if all_tactics else 'unknown'
    url = tech['external_references'][0].get('url', f'https://attack.mitre.org/techniques/{ext_id.replace(".", "/")}')

    # name matches directory name (SKILL_GUIDE requirement)
    skill_name = dir_name

    # category from SKILL_GUIDE categories
    category = TACTIC_CATEGORIES.get(primary_tactic, 'configuration')

    # tech_stack from platforms
    tech_stack = []
    for p in platforms:
        mapped = PLATFORM_MAP.get(p, p.lower())
        if mapped not in tech_stack:
            tech_stack.append(mapped)

    # tags
    tags = ['mitre-attack', 'enterprise', ext_id.lower()]
    for tac in all_tactics:
        if tac not in tags:
            tags.append(tac)
    for p in platforms:
        slug_p = p.lower().replace(' ', '-')
        if slug_p not in tags:
            tags.append(slug_p)
    if is_sub:
        tags.append('sub-technique')

    # chains_with from parent/child relationships
    chains = build_chains_with(ext_id, is_sub, children_map)

    # severity_boost as map (SKILL_GUIDE requirement)
    severity_boost = {}
    for chain_id in chains[:3]:
        severity_boost[chain_id] = f"Chain with {chain_id} for deeper attack path"

    # YAML formatting helpers
    tags_yaml = '\n'.join(f'  - {t}' for t in tags)
    tech_stack_yaml = '\n'.join(f'  - {t}' for t in tech_stack) if tech_stack else '  - any'
    chains_yaml = '\n'.join(f'  - {c}' for c in chains) if chains else '  []'
    boost_yaml = ''
    if severity_boost:
        for k, v in severity_boost.items():
            boost_yaml += f'\n  {k}: "{v}"'
    else:
        boost_yaml = ' {}'

    # CWE IDs based on tactic
    cwe_map = {
        'initial-access': ['CWE-20'],
        'execution': ['CWE-94'],
        'persistence': ['CWE-276'],
        'privilege-escalation': ['CWE-269'],
        'defense-evasion': ['CWE-693'],
        'credential-access': ['CWE-522'],
        'discovery': ['CWE-200'],
        'lateral-movement': ['CWE-284'],
        'collection': ['CWE-200'],
        'exfiltration': ['CWE-200'],
        'command-and-control': ['CWE-300'],
        'impact': ['CWE-400'],
        'reconnaissance': ['CWE-200'],
        'resource-development': [],
    }
    cwe_ids = cwe_map.get(primary_tactic, [])
    cwe_yaml = '\n'.join(f'  - {c}' for c in cwe_ids) if cwe_ids else '  []'

    # Prerequisites
    prereqs = []
    if is_sub:
        parent_id = ext_id.split('.')[0]
        prereqs.append(parent_id)
    prereqs_yaml = '\n'.join(f'  - {p}' for p in prereqs) if prereqs else '  []'

    # Build frontmatter (SKILL_GUIDE compliant)
    frontmatter = f'''---
name: "{skill_name}"
description: "{oneliner(desc)}"
category: "{category}"
version: "18.1"
author: "cyberstrike-official"
tags:
{tags_yaml}
technique_id: "{ext_id}"
tactic: "{primary_tactic}"
all_tactics:
{'\n'.join(f'  - {t}' for t in all_tactics)}
platforms:
{'\n'.join(f'  - {p}' for p in platforms) if platforms else '  - any'}
mitre_url: "{url}"
tech_stack:
{tech_stack_yaml}
cwe_ids:
{cwe_yaml}
chains_with:
{chains_yaml}
prerequisites:
{prereqs_yaml}
severity_boost:{boost_yaml}
---'''

    # === BODY — follows Offensive/Pentest template from SKILL_GUIDE ===

    # Tactic display
    tactic_lines = []
    for tac in all_tactics:
        info = tactic_info.get(tac)
        if info:
            tactic_lines.append(f'- {info["name"]} ({info["id"]})')
        else:
            tactic_lines.append(f'- {tac}')

    # Sub-technique note
    sub_note = ''
    if is_sub:
        parent_id = ext_id.split('.')[0]
        sub_note = f'\n> **Sub-technique of:** {parent_id}\n'

    # Platform display
    plat_lines = '\n'.join(f'- {p}' for p in platforms) if platforms else '- All platforms'

    # What to Check section
    check_items = []
    check_items.append(f'- [ ] Identify if {name} technique is applicable to target environment')
    for p in platforms[:3]:
        check_items.append(f'- [ ] Check {p} systems for indicators of {name}')
    if mitigations:
        check_items.append(f'- [ ] Verify mitigations are bypassed or absent ({len(mitigations)} known mitigations)')
    if detections:
        check_items.append(f'- [ ] Assess detection coverage ({len(detections)} detection strategies)')
    check_section = '\n'.join(check_items)

    # Mitigations as Remediation Guide
    mit_section = ''
    if mitigations:
        mit_parts = []
        for m in mitigations:
            mit_parts.append(f'### {m["id"]} {m["name"]}')
            if m['description']:
                mit_parts.append(m['description'])
            mit_parts.append('')
        mit_section = '\n'.join(mit_parts)
    else:
        mit_section = 'No specific mitigations documented for this technique.'

    # Detection section
    det_section = ''
    if detections:
        det_parts = []
        for d in detections:
            det_parts.append(f'### {d["name"]}')
            if d['description']:
                det_parts.append(d['description'])
            det_parts.append('')
        det_section = '\n'.join(det_parts)
    else:
        det_section = 'No specific detection data components documented for this technique.'

    # Risk Assessment table
    severity = 'High' if any(k in (name + desc).lower() for k in ['credential', 'exploit', 'injection', 'hijack', 'rootkit', 'privilege', 'phishing', 'backdoor']) else 'Medium' if any(k in (name + desc).lower() for k in ['discovery', 'obfuscat', 'proxy', 'tunnel']) else 'Low'

    # CWE table
    cwe_table_rows = ''
    cwe_descriptions = {
        'CWE-20': 'Improper Input Validation',
        'CWE-94': 'Improper Control of Generation of Code',
        'CWE-200': 'Exposure of Sensitive Information',
        'CWE-269': 'Improper Privilege Management',
        'CWE-276': 'Incorrect Default Permissions',
        'CWE-284': 'Improper Access Control',
        'CWE-300': 'Channel Accessible by Non-Endpoint',
        'CWE-400': 'Uncontrolled Resource Consumption',
        'CWE-522': 'Insufficiently Protected Credentials',
        'CWE-693': 'Protection Mechanism Failure',
    }
    for cwe in cwe_ids:
        cwe_table_rows += f'| {cwe} | {cwe_descriptions.get(cwe, "See MITRE CWE")} |\n'

    # References
    refs = []
    for ref in tech.get('external_references', []):
        if ref.get('url') and ref.get('source_name') != 'mitre-attack':
            refs.append(f'- [{ref.get("source_name", "Reference")}]({ref["url"]})')
    refs.append(f'- [MITRE ATT&CK - {ext_id}]({url})')
    refs_section = '\n'.join(refs[:15])

    body = f'''
# {ext_id} {name}
{sub_note}
## High-Level Description

{clean_desc}

## Kill Chain Phase

{chr(10).join(tactic_lines)}

**Platforms:** {', '.join(platforms) if platforms else 'All'}

## What to Check

{check_section}

## How to Test

### Identify Attack Surface

Determine if the target environment is susceptible to {name} by examining the target platforms ({', '.join(platforms[:3]) if platforms else 'any'}).

### Assess Existing Defenses

Review whether mitigations for {ext_id} are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

{mit_section}

## Detection

{det_section}

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| {name} technique applicable | {severity} | {primary_tactic.replace("-", " ").title()} |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
{cwe_table_rows if cwe_table_rows else '| N/A | No direct CWE mapping |'}

## References

{refs_section}
'''

    return frontmatter + '\n' + body


def main():
    if len(sys.argv) < 2:
        print('Usage: python3 generate_skills.py /path/to/enterprise-attack.json')
        sys.exit(1)

    stix_path = sys.argv[1]
    output_dir = Path(__file__).parent

    print(f'Reading STIX data from {stix_path}...')
    with open(stix_path) as f:
        data = json.load(f)

    lookup = build_lookup(data)

    # Get tactics
    tactics = [o for o in data['objects'] if o['type'] == 'x-mitre-tactic' and not o.get('revoked', False)]
    tactic_info = {}
    for t in tactics:
        short = t['x_mitre_shortname']
        tactic_info[short] = {
            'id': t['external_references'][0]['external_id'],
            'name': t['name'],
            'short': short,
            'description': clean_description(t.get('description', ''))
        }

    # Get active techniques
    techniques = [
        o for o in data['objects']
        if o['type'] == 'attack-pattern'
        and not o.get('revoked', False)
        and not o.get('x_mitre_deprecated', False)
    ]

    # Get relationships
    relationships = [
        o for o in data['objects']
        if o['type'] == 'relationship'
        and not o.get('revoked', False)
    ]

    # Build technique ID map and parent->children map
    tech_id_map, children_map = build_technique_id_map(techniques)

    print(f'Found {len(techniques)} active techniques')
    print(f'Found {len(relationships)} relationships')

    # Create tactic directories
    tactic_dirs = {}
    for short, info in sorted(tactic_info.items(), key=lambda x: x[1]['id']):
        dir_name = f'{info["id"]}_{short}'
        dir_path = output_dir / dir_name
        dir_path.mkdir(parents=True, exist_ok=True)
        tactic_dirs[short] = dir_path

    # Process techniques
    created = 0
    skipped = 0
    per_tactic = {short: 0 for short in tactic_info}

    for tech in sorted(techniques, key=lambda x: x['external_references'][0]['external_id']):
        ext_id = tech['external_references'][0]['external_id']
        name = tech['name']
        is_sub = tech.get('x_mitre_is_subtechnique', False)
        phases = tech.get('kill_chain_phases', [])

        if not phases:
            skipped += 1
            continue

        primary_tactic = phases[0]['phase_name']
        if primary_tactic not in tactic_dirs:
            skipped += 1
            continue

        # Build directory name: T1059_command-and-scripting-interpreter
        slug = slugify(name)
        tech_dir_name = f'{ext_id}_{slug}'
        tech_dir = tactic_dirs[primary_tactic] / tech_dir_name
        tech_dir.mkdir(parents=True, exist_ok=True)

        # Get mitigations and detections
        mitigations = get_mitigations(tech['id'], relationships, lookup)
        detections = get_detections(tech['id'], relationships, lookup)

        # Generate SKILL.md (SKILL_GUIDE compliant)
        content = generate_skill_md(tech, tactic_info, mitigations, detections, is_sub, tech_dir_name, children_map)
        skill_path = tech_dir / 'SKILL.md'
        skill_path.write_text(content, encoding='utf-8')

        created += 1
        per_tactic[primary_tactic] = per_tactic.get(primary_tactic, 0) + 1

    print(f'\nCreated {created} SKILL.md files ({skipped} skipped)')
    print('\nPer tactic:')
    for short, info in sorted(tactic_info.items(), key=lambda x: x[1]['id']):
        count = per_tactic.get(short, 0)
        print(f'  {info["id"]} {info["name"]}: {count}')

    print(f'\nTotal: {created}')


if __name__ == '__main__':
    main()
