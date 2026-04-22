#!/usr/bin/env python3
"""
NIST SP 800-218 SSDF v1.1 SKILL.md Generator for CyberStrike
Follows SKILL_GUIDE.md conventions.

Usage:
    python3 generate_ssdf.py /path/to/NIST_SP800-218_ver1_catalog.json
"""

import json
import re
import sys
from pathlib import Path


GROUP_CATEGORIES = {
    'po': 'configuration',
    'ps': 'authorization',
    'pw': 'input-validation',
    'rv': 'configuration',
}

GROUP_CWE = {
    'po': [],
    'ps': ['CWE-284'],
    'pw': ['CWE-20'],
    'rv': [],
}

GROUP_TECH_STACK = {
    'po': ['any'],
    'ps': ['git', 'ci-cd', 'docker'],
    'pw': ['any'],
    'rv': ['any'],
}

CWE_DESCRIPTIONS = {
    'CWE-20': 'Improper Input Validation',
    'CWE-284': 'Improper Access Control',
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
    return '\n'.join(texts)


def clean_prose(text):
    if not text:
        return ''
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
        if prop.get('name') == 'label':
            return prop.get('value', '')
    return ctrl.get('id', '').upper()


def generate_skill(ctrl, group_id, group_title, is_task=False, parent_label=None):
    title = ctrl['title']
    label = get_label(ctrl)
    parts = ctrl.get('parts', [])

    statement = clean_prose(extract_prose(parts, 'statement'))
    if not statement:
        statement = clean_prose(extract_prose(parts))

    slug = slugify(title)
    # Sanitize label for filesystem (remove /)
    safe_label = label.replace('/', '-')
    dir_name = f'{safe_label}_{slug}'
    description = oneliner(statement or title)

    category = GROUP_CATEGORIES.get(group_id.lower(), 'configuration')
    cwe_ids = GROUP_CWE.get(group_id.lower(), [])
    tech_stack = GROUP_TECH_STACK.get(group_id.lower(), ['any'])

    tags = ['nist', 'sp800-218', 'ssdf', label.lower().replace('.', '-'), group_id.lower(), 'secure-development']
    if is_task:
        tags.append('task')
    else:
        tags.append('practice')

    prereqs = []
    if is_task and parent_label:
        prereqs.append(parent_label)

    tags_yaml = '\n'.join(f'  - {t}' for t in tags)
    tech_yaml = '\n'.join(f'  - {t}' for t in tech_stack)
    cwe_yaml = '\n'.join(f'  - {c}' for c in cwe_ids) if cwe_ids else '  []'
    prereqs_yaml = '\n'.join(f'  - {p}' for p in prereqs) if prereqs else '  []'

    frontmatter = f'''---
name: "{dir_name}"
description: "{description}"
category: "{category}"
version: "1.1"
author: "cyberstrike-official"
tags:
{tags_yaml}
tech_stack:
{tech_yaml}
cwe_ids:
{cwe_yaml}
chains_with:
  []
prerequisites:
{prereqs_yaml}
severity_boost: {{}}
---'''

    task_note = ''
    if is_task and parent_label:
        task_note = f'\n> **Task of practice:** {parent_label}\n'

    check_items = [
        f'- [ ] Verify {label} {title} is integrated into SDLC',
        f'- [ ] Review CI/CD pipeline for {label} implementation',
        f'- [ ] Confirm automated tooling supports this practice',
    ]
    check_section = '\n'.join(check_items)

    cwe_table = ''
    for cwe in cwe_ids:
        cwe_table += f'| {cwe} | {CWE_DESCRIPTIONS.get(cwe, "See MITRE CWE")} |\n'

    body = f'''
# {label} {title}
{task_note}
## High-Level Description

**Practice Group:** {group_title} ({group_id.upper()})
**Framework:** NIST SP 800-218 SSDF v1.1

{statement if statement else title}

## What to Check

{check_section}

## How to Test

### Step 1: Review SDLC Documentation

Examine development lifecycle documentation for evidence of {label} practice implementation.

### Step 2: Verify Tooling

```
# Check CI/CD pipeline configuration
# Verify security tools are integrated

# Example: Check for SAST/DAST in pipeline
grep -r "security\|scan\|sast\|dast" .github/workflows/ 2>/dev/null
grep -r "security\|scan" Jenkinsfile 2>/dev/null
```

### Step 3: Assess Developer Awareness

Verify development team understands and follows {label} {title} practice.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| github-security-mcp | Check repository security settings | `github_security_*` tools |
| Manual Review | SDLC process review | Documentation and interviews |

## Remediation Guide

Implement {label} {title} in the software development lifecycle:

{statement if statement else f'Integrate {title} practice per NIST SSDF v1.1.'}

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| {label} {title} not implemented | Medium | Secure Development - {group_title} |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
{cwe_table if cwe_table else '| N/A | No direct CWE mapping |'}

## References

- [NIST SP 800-218 SSDF v1.1](https://csrc.nist.gov/pubs/sp/800/218/final)
- [NIST SSDF Practices](https://csrc.nist.gov/projects/ssdf)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] Practice documented in SDLC policy
- [ ] Tooling configured and operational
- [ ] Development team trained
- [ ] Evidence of consistent application
- [ ] Periodic review scheduled
'''

    return dir_name, frontmatter + '\n' + body


def main():
    if len(sys.argv) < 2:
        print('Usage: python3 generate_ssdf.py /path/to/NIST_SP800-218_ver1_catalog.json')
        sys.exit(1)

    catalog_path = sys.argv[1]
    output_dir = Path(__file__).parent / 'SP800-218_SSDF'

    if output_dir.exists():
        import shutil
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f'Reading SSDF catalog from {catalog_path}...')
    with open(catalog_path) as f:
        data = json.load(f)

    catalog = data['catalog']
    groups = catalog['groups']
    print(f'Found {len(groups)} practice groups')

    created = 0
    per_group = {}

    for group in groups:
        group_id = group['id']
        group_title = group['title']
        slug = slugify(group_title)
        group_dir_name = f'{group_id.upper()}_{slug}'
        group_dir = output_dir / group_dir_name
        group_dir.mkdir(parents=True, exist_ok=True)

        count = 0
        practices = group.get('controls', [])

        for practice in practices:
            practice_label = get_label(practice)
            dir_name, content = generate_skill(practice, group_id, group_title)
            skill_dir = group_dir / dir_name
            skill_dir.mkdir(parents=True, exist_ok=True)
            (skill_dir / 'SKILL.md').write_text(content, encoding='utf-8')
            count += 1

            for task in practice.get('controls', []):
                dir_name, content = generate_skill(task, group_id, group_title, is_task=True, parent_label=practice_label)
                skill_dir = group_dir / dir_name
                skill_dir.mkdir(parents=True, exist_ok=True)
                (skill_dir / 'SKILL.md').write_text(content, encoding='utf-8')
                count += 1

        per_group[group_id.upper()] = count
        created += count

    print(f'\nCreated {created} SKILL.md files')
    print('\nPer group:')
    for gid, count in sorted(per_group.items()):
        print(f'  {gid}: {count}')
    print(f'\nTotal: {created}')


if __name__ == '__main__':
    main()
