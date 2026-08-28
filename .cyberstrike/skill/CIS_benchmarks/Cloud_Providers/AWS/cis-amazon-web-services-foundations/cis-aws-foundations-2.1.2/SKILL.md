---
name: cis-aws-foundations-2.1.2
description: "Ensure authorization guardrails for all AWS Organization accounts"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, organizations, scp, rcp, guardrails, authorization]
cis_id: "2.1.2"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.1.1, cis-aws-foundations-2.1.4]
prerequisites: []
severity_boost: {}
---

# Ensure authorization guardrails for all AWS Organization accounts

## Description

Ensure that one or more baseline authorization policies such as Service Control Policies (SCPs) and/or Resource Control Policies (RCPs) are attached to all member accounts in AWS Organizations in accordance with organizational security requirements. Authorization policies act as preventive permission guardrails: SCPs define the maximum available permissions for IAM principals within accounts, while RCPs define the maximum available permissions for resources within accounts. These policies can enforce security invariants such as preventing disabling of key security services, restricting use of unapproved AWS Regions, or blocking external access to sensitive resources.

## Rationale

Authorization policies do not grant permissions but instead set organization-wide limits on what actions principals can perform (SCPs) and what access can be granted to resources (RCPs), regardless of local IAM or resource-based policies. Without baseline guardrail authorization policies, each account can grant excessive or inconsistent permissions that disable logging, weaken security services, allow use of unapproved Regions and services, or permit unintended external access to resources. Attaching standard authorization policies to all member accounts enforces preventive, centralized control over high-risk actions and access patterns, supports least-privilege and role-based access control at scale, and helps ensure that all accounts and resources operate within the organization's defined security baseline.

## Impact

Enforcing baseline authorization policies for all member accounts can initially block some existing patterns, such as use of unapproved Regions, disabling security services, or granting broader permissions than the guardrails allow. Teams may need to adjust IAM policies, deployment pipelines, and exception processes so legitimate use cases remain possible within the new guardrails. This can introduce short-term operational overhead and require careful testing, especially when attaching new policies at the root or OU level.

## Audit Procedure

### Using AWS CLI

Pre-requisite: you must run these CLI commands in the management account for the AWS Organization.

1. Before auditing, document or confirm your organization's baseline guardrail requirements. Common examples include:
   - Prevent disabling CloudTrail, AWS Config, GuardDuty, or Security Hub
   - Restrict usage to approved AWS Regions only
   - Protect central security or logging roles from modification
   - Deny external principal access to sensitive resources

2. List all SCPs and RCPs in the organization:

```bash
aws organizations list-policies --filter SERVICE_CONTROL_POLICY
aws organizations list-policies --filter RESOURCE_CONTROL_POLICY
```

3. For each SCP/RCP, retrieve and review the policy document to determine if it implements your baseline guardrail requirements:

```bash
aws organizations describe-policy --policy-id <policy-id>
```

Review the Content field in the output to confirm the policy enforces organizational security requirements.

If no SCPs/RCPs exist that implement your documented baseline guardrail requirements, note this as a gap and proceed to remediation.

4. List all accounts in the organization and note the account IDs:

```bash
aws organizations list-accounts --query 'Accounts[?Status==`ACTIVE`].[Id,Name]' --output table
```

5. For each baseline guardrail Authorization policy identified in Step 2, list the accounts and OUs to which it is attached:

```bash
aws organizations list-targets-for-policy --policy-id <policy-id>
```

6. Compare the list of attached targets to your full account list.
   - If the policy is attached to the root, all accounts in the organization inherit it and this policy passes for coverage.
   - If the policy is attached to specific OUs, verify that all active member accounts belong to those OUs.
   - If the policy is attached to individual accounts, verify that all active member accounts are included.

## Expected Result

- All baseline guardrail authorization policies required by organizational security requirements exist.
- Each baseline guardrail authorization policy is attached to all active member accounts either directly or via OU/root inheritance.

## Remediation

### Using AWS Console

1. From the AWS Organizations console, go to Policies -> Service control policies.
   - If you already have standard guardrail SCPs that implement your security baseline, note their names.
   - If you do not have such policies, choose Create policy and create at least one baseline guardrail SCP that encodes non-negotiable security requirements.

2. Do the same step as above but for RCPs if needed. From the AWS Organizations console, go to Policies -> Resource control policies.

3. Attach guardrail authorization policies to the root and/or OUs. In AWS Organizations, choose AWS accounts, then select the Root of the organization.
   - Go to the Policies tab, then within section for Service control policies, choose Attach, and select the baseline guardrail SCP(s) you identified or created.
   - If using RCPs, then within section for Resource control policies, choose Attach, and select the baseline guardrail RCP(s) you identified or created.
   - If your design uses different guardrails per OU (for example, stricter policies for production OU), select each OU in turn and attach the appropriate guardrail SCPs and RCPs to those OUs.

4. AWS recommends testing authorization policies in a staging OU before attaching them broadly to the root to avoid unintended service disruption.

## Default Value

No custom SCPs or RCPs are attached by default. Only the AWS-managed `FullAWSAccess` SCP is attached to the root.

## References

- [AWS Documentation - Service Control Policies](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html)
- [AWS Documentation - Resource Control Policies](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_rcps.html)

## CIS Controls

| Controls Version | Control                           | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------- | ---- | ---- | ---- |
| v8               | 5.6 Centralize Account Management |      | \*   | \*   |
| v8               | 6.7 Centralize Access Control     |      | \*   | \*   |

## Profile

Level 2 | Manual
