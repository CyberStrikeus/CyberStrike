#!/usr/bin/env python3
"""
NIST SP 800-53 Rev 5 SKILL.md Generator for CyberStrike
Reads OSCAL JSON catalog and generates skill files organized by control family.

Follows SKILL_GUIDE.md conventions:
- name matches directory name
- description is one-line summary
- severity_boost is a map
- Body follows Offensive/Pentest template structure adapted for compliance
- Includes real commands/tools for AI agent testing

Usage:
    python3 generate_sp800_53.py /path/to/NIST_SP-800-53_rev5_catalog.json
"""

import json
import re
import sys
from pathlib import Path


# Family ID to category mapping (SKILL_GUIDE categories)
FAMILY_CATEGORIES = {
    'ac': 'authorization',
    'at': 'configuration',
    'au': 'information-gathering',
    'ca': 'configuration',
    'cm': 'configuration',
    'cp': 'configuration',
    'ia': 'authentication',
    'ir': 'configuration',
    'ma': 'configuration',
    'mp': 'configuration',
    'pe': 'configuration',
    'pl': 'configuration',
    'pm': 'configuration',
    'ps': 'configuration',
    'pt': 'configuration',
    'ra': 'information-gathering',
    'sa': 'configuration',
    'sc': 'configuration',
    'si': 'input-validation',
    'sr': 'configuration',
}

# Family to CWE mapping
FAMILY_CWE = {
    'ac': ['CWE-284'],
    'at': [],
    'au': ['CWE-778'],
    'ca': [],
    'cm': ['CWE-16'],
    'cp': [],
    'ia': ['CWE-287'],
    'ir': [],
    'ma': [],
    'mp': [],
    'pe': [],
    'pl': [],
    'pm': [],
    'ps': [],
    'pt': ['CWE-359'],
    'ra': [],
    'sa': ['CWE-16'],
    'sc': ['CWE-311'],
    'si': ['CWE-20'],
    'sr': [],
}

# Family to tech_stack mapping
FAMILY_TECH_STACK = {
    'ac': ['aws', 'azure', 'gcp', 'linux', 'windows'],
    'at': ['any'],
    'au': ['aws', 'azure', 'gcp', 'linux', 'windows'],
    'ca': ['any'],
    'cm': ['aws', 'azure', 'gcp', 'linux', 'windows'],
    'cp': ['aws', 'azure', 'gcp'],
    'ia': ['aws', 'azure', 'active-directory', 'linux', 'windows'],
    'ir': ['any'],
    'ma': ['linux', 'windows'],
    'mp': ['linux', 'windows'],
    'pe': ['any'],
    'pl': ['any'],
    'pm': ['any'],
    'ps': ['any'],
    'pt': ['any'],
    'ra': ['any'],
    'sa': ['any'],
    'sc': ['aws', 'azure', 'gcp', 'linux', 'windows', 'network'],
    'si': ['aws', 'azure', 'gcp', 'linux', 'windows'],
    'sr': ['any'],
}

# Audit tools per family
FAMILY_TOOLS = {
    'ac': '| cloud-audit-mcp | Check IAM policies and access controls | `cloud_audit_iam_policies` |\n| hackbrowser-mcp | Test web application access controls | `browser_auth_test` |',
    'au': '| cloud-audit-mcp | Check logging configuration | `cloud_audit_logging` |\n| AWS CLI | Review CloudTrail/CloudWatch | `aws cloudtrail describe-trails` |',
    'cm': '| cloud-audit-mcp | Check configuration baselines | `cloud_audit_config` |\n| AWS CLI | Review Config rules | `aws configservice describe-config-rules` |',
    'ia': '| cloud-audit-mcp | Check authentication settings | `cloud_audit_iam_policies` |\n| hackbrowser-mcp | Test authentication mechanisms | `browser_auth_test` |',
    'sc': '| cloud-audit-mcp | Check encryption and network controls | `cloud_audit_encryption` |\n| nmap | Network scanning | `nmap -sV --script ssl-enum-ciphers` |',
    'si': '| cloud-audit-mcp | Check integrity monitoring | `cloud_audit_monitoring` |\n| AWS CLI | Review GuardDuty/Inspector | `aws guardduty list-detectors` |',
}

CWE_DESCRIPTIONS = {
    'CWE-16': 'Configuration',
    'CWE-20': 'Improper Input Validation',
    'CWE-284': 'Improper Access Control',
    'CWE-287': 'Improper Authentication',
    'CWE-311': 'Missing Encryption of Sensitive Data',
    'CWE-359': 'Exposure of Private Personal Information',
    'CWE-778': 'Insufficient Logging',
}


def slugify(name):
    """Convert title to URL-friendly slug."""
    s = name.lower()
    s = re.sub(r'[^a-z0-9\s-]', '', s)
    s = re.sub(r'[\s]+', '-', s)
    s = re.sub(r'-+', '-', s)
    return s.strip('-')[:60]


def extract_prose(parts, name_filter=None):
    """Extract prose text from OSCAL parts recursively."""
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
    """Clean OSCAL prose — remove parameter placeholders."""
    text = re.sub(r'\{\{\s*insert:\s*param,\s*[^}]+\}\}', '[organization-defined]', text)
    text = re.sub(r'  +', ' ', text)
    return text.strip()


def oneliner(text):
    """Extract first sentence for description."""
    if not text:
        return ''
    clean = clean_prose(text)
    match = re.match(r'^(.+?[.;])\s', clean)
    line = match.group(1) if match else clean[:150]
    if len(line) > 150:
        line = line[:147] + '...'
    line = line.replace('"', '\\"').replace('\n', ' ')
    return line


def get_related_controls(ctrl):
    """Get related control IDs from links."""
    related = []
    for link in ctrl.get('links', []):
        if link.get('rel') == 'related':
            href = link.get('href', '')
            if href.startswith('#'):
                cid = href[1:].upper()
                related.append(cid)
    return related


def get_label(ctrl):
    """Get display label from props."""
    for prop in ctrl.get('props', []):
        if prop.get('name') == 'label' and not prop.get('class'):
            return prop.get('value', '')
    return ctrl.get('id', '').upper()


def generate_skill(ctrl, family_id, family_title, is_enhancement=False, parent_id=None):
    """Generate a SKILL.md for a control or enhancement."""
    title = ctrl['title']
    label = get_label(ctrl)
    parts = ctrl.get('parts', [])

    # Extract content
    statement = clean_prose(extract_prose(parts, 'statement'))
    guidance = clean_prose(extract_prose(parts, 'guidance'))

    # Build directory name
    display_id = label.replace(' ', '-')
    slug = slugify(title)
    dir_name = f'{display_id}_{slug}'

    # One-line description
    description = oneliner(statement or guidance or title)

    # Category
    category = FAMILY_CATEGORIES.get(family_id, 'configuration')

    # Tags
    tags = ['nist', 'sp800-53', 'rev5', label.lower().replace('(', '-').replace(')', ''), family_id]
    if is_enhancement:
        tags.append('enhancement')

    # Tech stack
    tech_stack = FAMILY_TECH_STACK.get(family_id, ['any'])

    # CWE
    cwe_ids = FAMILY_CWE.get(family_id, [])

    # Related controls (chains_with)
    related = get_related_controls(ctrl)
    chains = related[:10]

    # Prerequisites
    prereqs = []
    if is_enhancement and parent_id:
        prereqs.append(parent_id.upper())

    # Severity boost
    severity_boost = {}
    for chain_id in chains[:3]:
        severity_boost[chain_id] = f"Chain with {chain_id} for comprehensive security coverage"

    # YAML formatting
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
version: "5.2.0"
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

    # === BODY — Offensive/Pentest template adapted for NIST compliance ===

    # Enhancement note
    enh_note = ''
    if is_enhancement and parent_id:
        enh_note = f'\n> **Enhancement of:** {parent_id.upper()}\n'

    # What to Check — actionable checklist
    check_items = [f'- [ ] Verify {label} {title} is documented in SSP']
    if statement:
        # Count lettered items
        items = re.findall(r'\n([A-Za-z])\. |;\n', statement)
        stmt_items = statement.count(';') + 1
        if stmt_items > 1:
            check_items.append(f'- [ ] Validate all {stmt_items} control requirements are implemented')
    check_items.append(f'- [ ] Confirm control is operating effectively')
    check_items.append(f'- [ ] Review evidence of continuous monitoring for {label}')
    if is_enhancement:
        check_items.append(f'- [ ] Verify enhancement builds upon base control {parent_id.upper()}')
    check_section = '\n'.join(check_items)

    # Tools table
    tools_table = FAMILY_TOOLS.get(family_id, '| Manual Review | Documentation and interview-based | N/A |')

    # CWE table
    cwe_table = ''
    for cwe in cwe_ids:
        cwe_table += f'| {cwe} | {CWE_DESCRIPTIONS.get(cwe, "See MITRE CWE")} |\n'

    # Severity
    severity = 'High' if family_id in ('ac', 'ia', 'sc', 'si') else 'Medium'

    body = f'''
# {label} {title}
{enh_note}
## High-Level Description

**Family:** {family_title} ({family_id.upper()})
**Framework:** NIST SP 800-53 Rev 5

{guidance if guidance else statement if statement else 'No description available.'}

## What to Check

{check_section}

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for {label} implementation details. Verify the organization has documented how this control is satisfied.

### Step 2: Validate Implementation

```
# For cloud environments, use cloud-audit-mcp tools
# For on-premises, review system configurations directly

# Example: Check if account management policies exist
grep -r "account.management\|access.control" /etc/security/ 2>/dev/null
```

### Step 3: Test Operating Effectiveness

Verify the control is actively functioning, not just documented. Check logs, configurations, and operational evidence.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
{tools_table}

## Remediation Guide

### Control Statement

{statement if statement else 'Refer to NIST SP 800-53 Rev 5 for the full control statement.'}

### Implementation Guidance

{guidance if guidance else 'Implement this control per organizational risk assessment and system categorization.'}

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| {label} {title} not implemented | {severity} | {family_title} |
| {label} partially implemented | {'Medium' if severity == 'High' else 'Low'} | Incomplete {family_title} |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
{cwe_table if cwe_table else '| N/A | No direct CWE mapping |'}

## References

- [NIST SP 800-53 Rev 5 - {label}](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element={ctrl['id']})
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls ({', '.join(chains[:5]) if chains else 'none'}) reviewed
'''

    return dir_name, frontmatter + '\n' + body


def main():
    if len(sys.argv) < 2:
        print('Usage: python3 generate_sp800_53.py /path/to/NIST_SP-800-53_rev5_catalog.json')
        sys.exit(1)

    stix_path = sys.argv[1]
    output_dir = Path(__file__).parent / 'SP800-53_rev5'

    # Clean existing output
    if output_dir.exists():
        import shutil
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f'Reading OSCAL catalog from {stix_path}...')
    with open(stix_path) as f:
        data = json.load(f)

    catalog = data['catalog']
    families = catalog['groups']

    print(f'Found {len(families)} control families')

    created = 0
    per_family = {}

    for family in families:
        family_id = family['id']
        family_title = family['title']
        slug = slugify(family_title)
        family_dir_name = f'{family_id.upper()}_{slug}'
        family_dir = output_dir / family_dir_name
        family_dir.mkdir(parents=True, exist_ok=True)

        count = 0
        controls = family.get('controls', [])

        for ctrl in controls:
            dir_name, content = generate_skill(ctrl, family_id, family_title)
            skill_dir = family_dir / dir_name
            skill_dir.mkdir(parents=True, exist_ok=True)
            (skill_dir / 'SKILL.md').write_text(content, encoding='utf-8')
            count += 1

            for enh in ctrl.get('controls', []):
                dir_name, content = generate_skill(enh, family_id, family_title, is_enhancement=True, parent_id=ctrl['id'])
                skill_dir = family_dir / dir_name
                skill_dir.mkdir(parents=True, exist_ok=True)
                (skill_dir / 'SKILL.md').write_text(content, encoding='utf-8')
                count += 1

        per_family[family_id.upper()] = count
        created += count

    print(f'\nCreated {created} SKILL.md files')
    print('\nPer family:')
    for fid, count in sorted(per_family.items()):
        print(f'  {fid}: {count}')
    print(f'\nTotal: {created}')


if __name__ == '__main__':
    main()
