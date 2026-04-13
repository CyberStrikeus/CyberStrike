---
name: cis-aws-storage-2.11
description: "Ensure Secure Password Policy Implementation"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, iam, password-policy, mfa, authentication]
cis_id: "2.11"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: [CWE-521]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Control 2.11: Ensure Secure Password Policy Implementation (Manual)

## Profile Applicability
- **Level 2**

## Description
Password policies outline the appropriate parameters for password configuration within an organization.

## Rationale
Clear password policies provide essential guidelines for maintaining strong authentication practices, reducing the risk of unauthorized access and data breaches within an organization. By enforcing requirements for complex passwords and regular updates, these policies help bolster cybersecurity defenses and ensure compliance with industry standards and regulations.

## Audit Procedure

### Via AWS CLI
\`\`\`bash
# Get account password policy
aws iam get-account-password-policy
\`\`\`

## Remediation

### Via AWS CLI
\`\`\`bash
# Set account password policy
aws iam update-account-password-policy \
  --minimum-password-length 14 \
  --require-symbols \
  --require-numbers \
  --require-uppercase-characters \
  --require-lowercase-characters \
  --allow-users-to-change-password \
  --max-password-age 90 \
  --password-reuse-prevention 24
\`\`\`

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 6.7 Centralize Access Control | | ● | ● |
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | ● |
| v7 | 4.2 Change Default Passwords | ● | ● | ● |
| v7 | 4.5 Use Multifactor Authentication For All Administrative Access | | ● | ● |
