---
name: cis-aws-foundations-2.1.4
description: "Ensure Organizational Units are structured by environment and sensitivity"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, organizations, ou-structure, environment, sensitivity]
cis_id: "2.1.4"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.1.2, cis-aws-foundations-2.1.5]
prerequisites: []
severity_boost: {}
---

# Ensure Organizational Units are structured by environment and sensitivity

## Description

Ensure that AWS Organizations Organizational Units (OUs) are structured primarily by environment (for example, production, non-production, sandbox) and sensitivity (for example, security, logging, shared services, regulated workloads), rather than mirroring the corporate org chart. OUs should group accounts that share similar security requirements and controls so that appropriate authorization policies and other guardrails can be applied consistently at the OU level.

## Rationale

A clear OU structure based on environment and sensitivity makes it easier to apply consistent guardrails and centralized security controls to accounts that have similar risk profiles and compliance needs. Poorly defined or ad-hoc OU structures complicate policy management, increase the chance of misapplied controls, and can lead to mixing workloads with different data sensitivities under the same set of controls.

## Impact

Restructuring OUs by environment and sensitivity can require moving accounts, changing inherited policies, and updating automation that assumes existing OU paths. This may introduce short-term operational overhead, including policy revalidation, testing of workloads under new guardrails, and coordination with application and platform teams to avoid unintended service disruption.

## Audit Procedure

### Using AWS Console

1. From the management account, use AWS Organizations console to obtain:
   - The full OU hierarchy (root, top-level and child OUs).
   - The list of accounts in each OU.

### Using AWS CLI

```bash
# List roots
aws organizations list-roots

# List OUs under root
aws organizations list-organizational-units-for-parent --parent-id <root-id>

# List accounts under an OU
aws organizations list-accounts-for-parent --parent-id <ou-id>

# Recursively list child OUs
aws organizations list-organizational-units-for-parent --parent-id <ou-id>
```

2. Review top-level and key OUs and determine whether they are clearly aligned to:
   - Environment (for example, production, non-production, sandbox).
   - Sensitivity/function (for example, security, logging, shared services, regulated).

3. Note any OUs whose purpose is unclear or that appear to be organized mainly by department or owner rather than environment/sensitivity.

4. For each environment/sensitivity OU, select a sample of accounts and verify that their primary workloads match the OU's stated purpose.
   - Note any accounts that mix production and non-production workloads in the same OU when separate OUs are defined.
   - Note any accounts that place highly sensitive or regulated workloads in OUs that are intended for lower-sensitivity use.

## Expected Result

- Top-level OUs are clearly aligned to environment (production, non-production, sandbox) and sensitivity/function (security, logging, shared services, regulated).
- Accounts are placed in OUs that match their workload environment and sensitivity.
- No active accounts remain directly under the root unless explicitly justified and documented.

## Remediation

### Using AWS Console

1. Work with security, platform, and application teams to agree on a small set of top-level OUs such as:
   - Security / Management
   - Shared Services / Infrastructure
   - Prod
   - Non-Prod (dev, test, staging)
   - You may also define dedicated OUs for highly regulated workloads.

2. In the AWS Organizations console (management account), navigate to AWS Accounts. Under the root, create the agreed top-level OUs. If needed, create child OUs under these.

3. Export or list all existing accounts and their current OUs. Create a simple mapping from each account to its target OU based on environment and sensitivity.

4. In the AWS Organizations console (management account), navigate to AWS Accounts. Move accounts into the new environment/sensitivity-based OUs according to your mapping.
   - Start with low-risk accounts (for example, sandbox and non-production) to validate effects of inherited policies and guardrails before moving production and high-sensitivity accounts.

5. After accounts have been moved, remove old OUs that no longer reflect the target structure.
   - Ensure no active accounts remain directly under the root unless explicitly justified and documented.

6. Update architecture docs, onboarding runbooks, and account request processes to require new accounts to be created in the correct OU based on environment and sensitivity.

## Default Value

AWS Organizations creates a single root with no OUs by default. All accounts are placed directly under the root unless OUs are explicitly created.

## References

- [AWS Documentation - Organizing AWS Accounts](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_ous.html)
- [AWS Prescriptive Guidance - Organizing Your AWS Environment Using Multiple Accounts](https://docs.aws.amazon.com/prescriptive-guidance/latest/organizing-your-aws-environment/organizing-your-aws-environment.html)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.12 Segment Data Processing and Storage Based on Sensitivity | | * | * |

## Profile

Level 2 | Manual
