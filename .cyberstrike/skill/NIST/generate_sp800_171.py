#!/usr/bin/env python3
"""
NIST SP 800-171 Rev 3 SKILL.md Generator for CyberStrike
Follows SKILL_GUIDE.md conventions.

Usage:
    python3 generate_sp800_171.py /path/to/NIST_SP800-171_rev3_catalog.json
"""

import json
import re
import sys
from pathlib import Path


FAMILY_CATEGORIES = {
    '03.01': 'authorization',
    '03.02': 'configuration',
    '03.03': 'information-gathering',
    '03.04': 'configuration',
    '03.05': 'authentication',
    '03.06': 'configuration',
    '03.07': 'configuration',
    '03.08': 'configuration',
    '03.09': 'configuration',
    '03.10': 'configuration',
    '03.11': 'information-gathering',
    '03.12': 'configuration',
    '03.13': 'configuration',
    '03.14': 'input-validation',
    '03.15': 'configuration',
    '03.16': 'configuration',
    '03.17': 'configuration',
}

FAMILY_CWE = {
    '03.01': ['CWE-284'],
    '03.02': [],
    '03.03': ['CWE-778'],
    '03.04': ['CWE-16'],
    '03.05': ['CWE-287'],
    '03.06': [],
    '03.07': [],
    '03.08': [],
    '03.09': [],
    '03.10': [],
    '03.11': [],
    '03.12': [],
    '03.13': ['CWE-311'],
    '03.14': ['CWE-20'],
    '03.15': [],
    '03.16': [],
    '03.17': [],
}

FAMILY_TECH_STACK = {
    '03.01': ['aws', 'azure', 'gcp', 'linux', 'windows'],
    '03.02': ['any'],
    '03.03': ['aws', 'azure', 'gcp', 'linux', 'windows'],
    '03.04': ['aws', 'azure', 'gcp', 'linux', 'windows'],
    '03.05': ['aws', 'azure', 'active-directory', 'linux', 'windows'],
    '03.06': ['any'],
    '03.07': ['linux', 'windows'],
    '03.08': ['linux', 'windows'],
    '03.09': ['any'],
    '03.10': ['any'],
    '03.11': ['any'],
    '03.12': ['any'],
    '03.13': ['aws', 'azure', 'gcp', 'linux', 'windows', 'network'],
    '03.14': ['aws', 'azure', 'gcp', 'linux', 'windows'],
    '03.15': ['any'],
    '03.16': ['any'],
    '03.17': ['any'],
}

CWE_DESCRIPTIONS = {
    'CWE-16': 'Configuration',
    'CWE-20': 'Improper Input Validation',
    'CWE-284': 'Improper Access Control',
    'CWE-287': 'Improper Authentication',
    'CWE-311': 'Missing Encryption of Sensitive Data',
    'CWE-778': 'Insufficient Logging',
}


def slugify(name):
    s = name.lower()
    s = re.sub(r'[^a-z0-9\s-]', '', s)
    s = re.sub(r'[\s]+', '-', s)
    s = re.sub(r'-+', '-', s)
    return s.strip('-')[:60]


def extract_prose(parts, name_filter=None):
    texts = []
    for part in parts:
        if name_filter and part.get('name') != name_filter:
            continue
        if 'prose' in part:
            texts.append(part['prose'])
        if 'parts' in part:
            for sub in part['parts']:
                if 'prose' in sub:
                    texts.append(sub['prose'])
                if 'parts' in sub:
                    for subsub in sub['parts']:
                        if 'prose' in subsub:
                            texts.append(subsub['prose'])
    return '\n'.join(texts)


def clean_prose(text):
    text = re.sub(r'\{\{[^}]+\}\}', '[organization-defined]', text)
    text = re.sub(r'  +', ' ', text)
    return text.strip()


def oneliner(text):
    if not text:
        return ''
    clean = clean_prose(text)
    match = re.match(r'^(.+?[.;])\s', clean)
    line = match.group(1) if match else clean[:150]
    if len(line) > 150:
        line = line[:147] + '...'
    line = line.replace('"', '\\"').replace('\n', ' ')
    return line


def get_label(ctrl):
    for prop in ctrl.get('props', []):
        if prop.get('name') == 'label' and not prop.get('class'):
            return prop.get('value', '')
    return ctrl.get('id', '').upper()


def generate_skill(ctrl, family_num, family_title):
    title = ctrl['title']
    label = get_label(ctrl)
    parts = ctrl.get('parts', [])

    statement = clean_prose(extract_prose(parts, 'statement'))
    guidance = clean_prose(extract_prose(parts, 'guidance'))

    slug = slugify(title)
    dir_name = f'{label}_{slug}'
    description = oneliner(statement or title)

    category = FAMILY_CATEGORIES.get(family_num, 'configuration')
    cwe_ids = FAMILY_CWE.get(family_num, [])
    tech_stack = FAMILY_TECH_STACK.get(family_num, ['any'])

    tags = ['nist', 'sp800-171', 'rev3', label.lower().replace('.', '-'), f'family-{family_num}', 'cui-protection', 'cmmc']

    chains = []
    for link in ctrl.get('links', []):
        if link.get('rel') == 'related':
            href = link.get('href', '').replace('#', '')
            if href:
                chains.append(href.upper())

    severity_boost = {}
    for chain_id in chains[:3]:
        severity_boost[chain_id] = f"Chain with {chain_id} for CUI protection coverage"

    tags_yaml = '\n'.join(f'  - {t}' for t in tags)
    tech_yaml = '\n'.join(f'  - {t}' for t in tech_stack)
    cwe_yaml = '\n'.join(f'  - {c}' for c in cwe_ids) if cwe_ids else '  []'
    chains_yaml = '\n'.join(f'  - {c}' for c in chains[:10]) if chains else '  []'
    boost_yaml = ''
    if severity_boost:
        for k, v in severity_boost.items():
            boost_yaml += f'\n  {k}: "{v}"'
    else:
        boost_yaml = ' {}'

    frontmatter = f'''---
name: "{dir_name}"
description: "{description}"
category: "{category}"
version: "3.0"
author: "cyberstrike-official"
tags:
{tags_yaml}
tech_stack:
{tech_yaml}
cwe_ids:
{cwe_yaml}
chains_with:
{chains_yaml}
prerequisites:
  []
severity_boost:{boost_yaml}
---'''

    check_items = [
        f'- [ ] Verify {label} {title} is implemented for CUI systems',
        f'- [ ] Review SSP documentation for {label}',
        f'- [ ] Validate CMMC Level 2 assessment objective for {label}',
        f'- [ ] Confirm POA&M addresses any gaps for {label}',
    ]
    check_section = '\n'.join(check_items)

    cwe_table = ''
    for cwe in cwe_ids:
        cwe_table += f'| {cwe} | {CWE_DESCRIPTIONS.get(cwe, "See MITRE CWE")} |\n'

    severity = 'High' if family_num in ('03.01', '03.05', '03.13', '03.14') else 'Medium'

    body = f'''
# {label} {title}

## High-Level Description

**Family:** {family_title}
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

{statement if statement else title}

## What to Check

{check_section}

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for {label} implementation description and responsible parties.

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

{statement if statement else f'Implement {title} per NIST SP 800-171 Rev 3.'}

### Supplemental Guidance

{guidance if guidance else 'Refer to SP 800-171A Rev 3 for detailed assessment procedures.'}

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| {label} {title} not implemented | {severity} | CUI Protection - {family_title} |
| {label} partially implemented (POA&M) | {'Medium' if severity == 'High' else 'Low'} | CMMC certification risk |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
{cwe_table if cwe_table else '| N/A | No direct CWE mapping |'}

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents {label} implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
'''

    return dir_name, frontmatter + '\n' + body


def main():
    if len(sys.argv) < 2:
        print('Usage: python3 generate_sp800_171.py /path/to/NIST_SP800-171_rev3_catalog.json')
        sys.exit(1)

    catalog_path = sys.argv[1]
    output_dir = Path(__file__).parent / 'SP800-171_rev3'

    if output_dir.exists():
        import shutil
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f'Reading SP 800-171 Rev 3 catalog from {catalog_path}...')
    with open(catalog_path) as f:
        data = json.load(f)

    catalog = data['catalog']
    families = catalog['groups']
    print(f'Found {len(families)} families')

    created = 0
    per_family = {}

    for family in families:
        family_id = family['id']
        family_title = family['title']
        family_num = re.search(r'(\d+\.\d+)', family_id)
        family_num = family_num.group(1) if family_num else family_id
        slug = slugify(family_title)
        family_dir_name = f'{family_num}_{slug}'
        family_dir = output_dir / family_dir_name
        family_dir.mkdir(parents=True, exist_ok=True)

        count = 0
        for ctrl in family.get('controls', []):
            dir_name, content = generate_skill(ctrl, family_num, family_title)
            skill_dir = family_dir / dir_name
            skill_dir.mkdir(parents=True, exist_ok=True)
            (skill_dir / 'SKILL.md').write_text(content, encoding='utf-8')
            count += 1

        per_family[family_num] = count
        created += count

    print(f'\nCreated {created} SKILL.md files')
    print('\nPer family:')
    for fid, count in sorted(per_family.items()):
        print(f'  {fid}: {count}')
    print(f'\nTotal: {created}')


if __name__ == '__main__':
    main()
