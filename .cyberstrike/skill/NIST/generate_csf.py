#!/usr/bin/env python3
"""
NIST CSF v2.0 SKILL.md Generator for CyberStrike
Follows SKILL_GUIDE.md conventions.

Usage:
    python3 generate_csf.py /path/to/NIST_CSF_v2.0_catalog.json
"""

import json
import re
import sys
from pathlib import Path


FUNCTION_CATEGORIES = {
    'gv': 'configuration',
    'id': 'information-gathering',
    'pr': 'authorization',
    'de': 'information-gathering',
    'rs': 'configuration',
    'rc': 'configuration',
}

FUNCTION_CWE = {
    'gv': [],
    'id': ['CWE-200'],
    'pr': ['CWE-284'],
    'de': ['CWE-778'],
    'rs': [],
    'rc': [],
}

FUNCTION_TECH_STACK = {
    'gv': ['any'],
    'id': ['aws', 'azure', 'gcp', 'network'],
    'pr': ['aws', 'azure', 'gcp', 'linux', 'windows'],
    'de': ['aws', 'azure', 'gcp', 'siem'],
    'rs': ['any'],
    'rc': ['any'],
}

CWE_DESCRIPTIONS = {
    'CWE-200': 'Exposure of Sensitive Information',
    'CWE-284': 'Improper Access Control',
    'CWE-778': 'Insufficient Logging',
}


def slugify(name):
    s = name.lower()
    s = re.sub(r'[^a-z0-9\s-]', '', s)
    s = re.sub(r'[\s]+', '-', s)
    s = re.sub(r'-+', '-', s)
    return s.strip('-')[:60]


def clean_prose(text):
    if not text:
        return ''
    text = re.sub(r'\{\{[^}]+\}\}', '[organization-defined]', text)
    text = re.sub(r'  +', ' ', text)
    return text.strip()


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
    return '\n'.join(texts)


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
        if prop.get('name') == 'label':
            return prop.get('value', '')
    return ctrl.get('id', '').upper()


def generate_skill(ctrl, func_id, func_title, is_subcategory=False, parent_label=None):
    title = ctrl['title']
    label = get_label(ctrl)
    parts = ctrl.get('parts', [])

    statement = clean_prose(extract_prose(parts, 'statement'))
    if not statement:
        statement = clean_prose(extract_prose(parts))

    slug = slugify(title)
    dir_name = f'{label}_{slug}'
    description = oneliner(statement or title)

    category = FUNCTION_CATEGORIES.get(func_id.lower(), 'configuration')
    cwe_ids = FUNCTION_CWE.get(func_id.lower(), [])
    tech_stack = FUNCTION_TECH_STACK.get(func_id.lower(), ['any'])

    tags = ['nist', 'csf', 'v2.0', label.lower().replace('.', '-'), func_id.lower()]
    if is_subcategory:
        tags.append('subcategory')
    else:
        tags.append('category')

    chains = []
    for link in ctrl.get('links', []):
        if link.get('rel') == 'related':
            href = link.get('href', '')
            if href.startswith('#'):
                chains.append(href[1:].upper())

    prereqs = []
    if is_subcategory and parent_label:
        prereqs.append(parent_label)

    severity_boost = {}
    for chain_id in chains[:3]:
        severity_boost[chain_id] = f"Chain with {chain_id} for comprehensive coverage"

    tags_yaml = '\n'.join(f'  - {t}' for t in tags)
    tech_yaml = '\n'.join(f'  - {t}' for t in tech_stack)
    cwe_yaml = '\n'.join(f'  - {c}' for c in cwe_ids) if cwe_ids else '  []'
    chains_yaml = '\n'.join(f'  - {c}' for c in chains) if chains else '  []'
    prereqs_yaml = '\n'.join(f'  - {p}' for p in prereqs) if prereqs else '  []'
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
version: "2.0"
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
{prereqs_yaml}
severity_boost:{boost_yaml}
---'''

    sub_note = ''
    if is_subcategory and parent_label:
        sub_note = f'\n> **Subcategory of:** {parent_label}\n'

    check_items = [
        f'- [ ] Verify {label} {title} outcome is achieved',
        f'- [ ] Review documentation and evidence for {label}',
        f'- [ ] Assess organizational maturity for {func_title} function',
    ]
    if is_subcategory:
        check_items.append(f'- [ ] Map to SP 800-53 controls that satisfy {label}')
    check_section = '\n'.join(check_items)

    cwe_table = ''
    for cwe in cwe_ids:
        cwe_table += f'| {cwe} | {CWE_DESCRIPTIONS.get(cwe, "See MITRE CWE")} |\n'

    severity = 'High' if func_id.upper() in ('PR', 'DE') else 'Medium'

    body = f'''
# {label} {title}
{sub_note}
## High-Level Description

**Function:** {func_title} ({func_id.upper()})
**Framework:** NIST Cybersecurity Framework v2.0

{statement if statement else title}

## What to Check

{check_section}

## How to Test

### Step 1: Identify Current Profile

Determine the organization's current and target CSF profile tier for {label}.

### Step 2: Assess Outcome Achievement

```
# Review organizational policies and procedures
# Check for evidence that {label} outcome is met
# Interview stakeholders responsible for {func_title}
```

### Step 3: Map to Technical Controls

Identify which SP 800-53 controls implement this CSF outcome and verify their operating effectiveness.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| cloud-audit-mcp | Assess cloud security posture | `cloud_audit_*` tools |
| Manual Review | Policy and procedure review | Interviews and documentation |

## Remediation Guide

Achieve the {label} {title} outcome:

{statement if statement else f'Implement controls that satisfy the {title} outcome per NIST CSF v2.0.'}

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| {label} {title} outcome not achieved | {severity} | {func_title} Function Gap |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
{cwe_table if cwe_table else '| N/A | No direct CWE mapping |'}

## References

- [NIST CSF v2.0](https://www.nist.gov/cyberframework)
- [NIST CSF v2.0 Reference Tool](https://csrc.nist.gov/projects/cybersecurity-framework/filters#/csf/filters)
- [CSF 2.0 Quick Start Guides](https://www.nist.gov/cyberframework/getting-started)

## Checklist

- [ ] Current profile tier assessed
- [ ] Target profile tier defined
- [ ] Gap analysis completed
- [ ] SP 800-53 control mapping verified
- [ ] Implementation roadmap exists
'''

    return dir_name, frontmatter + '\n' + body


def main():
    if len(sys.argv) < 2:
        print('Usage: python3 generate_csf.py /path/to/NIST_CSF_v2.0_catalog.json')
        sys.exit(1)

    catalog_path = sys.argv[1]
    output_dir = Path(__file__).parent / 'CSF_v2.0'

    if output_dir.exists():
        import shutil
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f'Reading CSF v2.0 catalog from {catalog_path}...')
    with open(catalog_path) as f:
        data = json.load(f)

    catalog = data['catalog']
    functions = catalog['groups']
    print(f'Found {len(functions)} functions')

    created = 0
    per_function = {}

    for func in functions:
        func_id = func['id']
        func_title = func['title']
        slug = slugify(func_title)
        func_dir_name = f'{func_id.upper()}_{slug}'
        func_dir = output_dir / func_dir_name
        func_dir.mkdir(parents=True, exist_ok=True)

        count = 0
        categories = func.get('controls', [])

        for cat in categories:
            cat_label = get_label(cat)
            dir_name, content = generate_skill(cat, func_id, func_title)
            skill_dir = func_dir / dir_name
            skill_dir.mkdir(parents=True, exist_ok=True)
            (skill_dir / 'SKILL.md').write_text(content, encoding='utf-8')
            count += 1

            for sub in cat.get('controls', []):
                dir_name, content = generate_skill(sub, func_id, func_title, is_subcategory=True, parent_label=cat_label)
                skill_dir = func_dir / dir_name
                skill_dir.mkdir(parents=True, exist_ok=True)
                (skill_dir / 'SKILL.md').write_text(content, encoding='utf-8')
                count += 1

        per_function[func_id.upper()] = count
        created += count

    print(f'\nCreated {created} SKILL.md files')
    print('\nPer function:')
    for fid, count in sorted(per_function.items()):
        print(f'  {fid}: {count}')
    print(f'\nTotal: {created}')


if __name__ == '__main__':
    main()
