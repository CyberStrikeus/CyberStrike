---
name: cis-aws-compute-2.3
description: "Ensure Tag Policies are Enabled"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ec2, tag-policies, organizations, governance]
cis_id: "2.3"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-2.4, cis-aws-compute-2.1.1]
prerequisites: []
severity_boost: {}
---

# Ensure Tag Policies are Enabled

## Description
Tag policies help you standardize tags on all tagged resources across your organization.

## Rationale
You can use tag policies to define tag keys (including how they should be capitalized) and their allowed values.

## Impact
Enabling tag policies may require organizations to update their tagging practices to comply with the new policy. Non-compliant tags may be rejected if enforcement is enabled.

## Audit Procedure

### Using AWS CLI

1. Run the `list-policies` command:

```bash
aws organizations list-policies --filter TAG_POLICY
```

2. If information displays it means you have a tagging policy in place.
3. If empty brackets display `[]` refer to the remediation below.

### Using AWS Console

1. Login to AWS Organizations using https://console.aws.amazon.com/organizations/
2. In the left pane click on `Policies`.
3. Confirm `Tag policies` status is `enabled`.

If `Tag policies` status is disabled refer to the remediation below.

## Expected Result
The CLI should return tag policy information (not empty brackets). In the console, Tag policies status should display as `enabled`.

## Remediation

### Using AWS CLI

You must use an IAM user, assume an IAM role, or sign in as the root user (not recommended) in the organization's management account.

1. Run the `enable-policy-type` command:

```bash
aws organizations enable-policy-type --root-id <RootID> --policy-type TAG_POLICIES
```

The list of PolicyTypes in the output will now include the specified policy type with the Status of ENABLED.

### Using AWS Console

You must sign in as an IAM user, assume an IAM role, or sign in as the root user (not recommended) in the organization's management account.

1. Login to AWS Organizations using https://console.aws.amazon.com/organizations/
2. In the Left pane click on `Policies`.
3. Click on `Tag policies`.
4. Click on `Enable Tag Policies`.
5. The page is updated with a list of the Available policies and the ability to create one.

## Default Value
Tag policies are disabled by default in AWS Organizations.

## References
1. https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_enable-disable.html#enable-policy-type

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 1.1 Establish and Maintain Detailed Enterprise Asset Inventory | x | x | x |
| v7 | 1.5 Maintain Asset Inventory Information | | x | x |

## Profile
Level 1 | Manual
