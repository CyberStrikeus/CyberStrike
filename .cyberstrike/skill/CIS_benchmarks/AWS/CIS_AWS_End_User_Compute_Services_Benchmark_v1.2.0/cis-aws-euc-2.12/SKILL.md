---
name: cis-aws-euc-2.12
description: "Restrict WorkSpaces Bundle options to organization approved versions"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workspaces, bundle-management, compliance]
cis_id: "2.12"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Restrict WorkSpaces Bundle options to organization approved versions (Manual)

## Description

Limit the existing WorkSpaces bundles that can be utilized and provisioned within your AWS account.

## Rationale

Limiting the type of AWS WorkSpaces bundle that can be utilized can address internal security and compliance requirements.

## Impact

None

## Audit Procedure

### Using AWS Console

Perform the following to ensure available workspace bundles are set.

1. Login to the WorkSpaces dashboard at https://console.aws.amazon.com/workspaces/
2. In the left pane click WorkSpaces to access the instances listing page.
3. Check the bundle type value for each Amazon WorkSpaces instance available in the current AWS region, listed in Bundle column, e.g.
4. If the value listed in the Bundle column is not the same for all listed resources, the WorkSpaces instances were launched using the approved bundle type.
5. Change the AWS region from the navigation bar and repeat step no. 4 for all other regions.

If the value listed in the Bundle column is not the same for all listed resources, the WorkSpaces instances were not launched using the approved bundle type, refer to the remediation procedure below.

### Using AWS CLI

1. Run describe-workspaces command available within the selected region:

```bash
aws workspaces describe-workspaces \
    --region us-east-1 \
    --output table \
    --query 'Workspaces[*].WorkspaceId'
```

2. The command output should return a table with the requested WorkSpaces IDs:

```
+-------------------+
|DescribeWorkspaces|
+-------------------+
|  ws-bbbdddeee     |
|  ws-aaabbbccc     |
|  ws-ccceeefff     |
+-------------------+
```

3. Run describe-workspaces command again using the name of the WorkSpaces instance as identifier and custom query filters get the ID of the bundle used by the selected instance:

```bash
aws workspaces describe-workspaces \
    --region us-east-1 \
    --workspace-ids ws-bbbdddeee \
    --query 'Workspaces[*].BundleId'
```

4. The command output should return the requested WorkSpaces bundle ID:

```
[ "wsb-ccc333fff" ]
```

5. Run describe-workspace-bundles command to describe the type of the bundle utilized by the selected AWS WorkSpaces instance:

```bash
aws workspaces describe-workspace-bundles \
    --region us-east-1 \
    --bundle-ids wsb-ccc333fff \
    --query 'Bundles[*].ComputeType.Name'
```

6. The command output should return the selected WorkSpaces bundle type:

```
[
    "PERFORMANCE"
]
```

7. Repeat steps no. 3 – 6 to verify the bundle type used by the rest of the AWS WorkSpaces instances created in the current region.
8. If the value listed for the Bundle is the same for all listed resources, the WorkSpaces instances were launched using the approved bundle type.
9. Repeat steps 1 – 8 to perform the entire audit process for all other AWS regions.

If the value listed in the Bundle output is not the same for all listed resources, the WorkSpaces instances were not launched using the approved bundle type, refer to the remediation procedure below.

### Expected Result

All WorkSpaces instances use the same approved bundle type.

## Remediation

### Using AWS Console

Preform the following to limit the bundle type. Create the required AWS support case:

1. Login in to AWS Support Center dashboard at https://console.aws.amazon.com/support/
2. Click Create a case.
3. For Case details:
   - Type, choose `Account`
   - Category, choose `Other Account Issues`
   - Subject, "Limit AWS WorkSpaces instances launch to approved bundle types".
   - Description textbox, explain that security and compliance requires the need to limit the provisioning of WorkSpaces instances to an approved bundle type.
   - Contact options, leave as default or change as needed.
4. Click Submit

## Default Value

By default, there is no bundle restriction. This is a manual decision that must be made by technology stakeholders in your organization.

## References

1. https://aws.amazon.com/workspaces/faqs/
2. https://docs.aws.amazon.com/workspaces/latest/adminguide/amazon-workspaces-bundles.html
3. https://aws.amazon.com/workspaces/features/
4. https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html

## CIS Controls

**Controls Version v8:**

- 2.3 Address Unauthorized Software

**Controls Version v7:**

- 2.6 Address unapproved software

## Profile

Level 1
