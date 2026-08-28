---
name: cis-aws-euc-2.14
description: "Ensure WorkSpaces that are not being utilized are removed"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workspaces, resource-management, unused-resources]
cis_id: "2.14"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure WorkSpaces that are not being utilized are removed (Automated)

## Description

Identify and remove any WorkSpace instances available within your AWS account that are not being utilized.

## Rationale

An AWS WorkSpaces instance is considered unused if has 0 (zero) known user connections registered within the past 30 days.

## Impact

None

## Audit Procedure

### Using AWS Console

Perform the following to ensure WorkSpaces not being utilized have been removed.

1. Log in to the WorkSpaces dashboard at https://console.aws.amazon.com/workspaces/
2. In the left panel click WorkSpaces
3. Choose the WorkSpaces instance that you want to examine.
4. Click on WorkSpace id link.
   - Verify the User Last Active attribute value is less than 30 days old
5. Repeat step 4 to verify the last user login, returned by the User Last Active attribute value, for all WorkSpaces.
6. Change the AWS region and repeat the audit process for other regions.

If the User Last Active was registered more than 30 days ago (e.g. Feb 16, 2017 10:32:54 UTC), the selected WorkSpaces instance is not in use anymore and can be safely removed from your AWS account. Refer to the remediation procedure below.

### Using AWS CLI

1. Run the describe-workspaces command to list the IDs of all WorkSpaces instances available within the selected region:

```bash
aws workspaces describe-workspaces \
    --region us-east-1 \
    --output table \
    --query 'Workspaces[*].WorkspaceId'
```

2. The command should return a table with the requested WorkSpaces IDs:

```
+-------------------+
|DescribeWorkspaces|
+-------------------+
|  ws-7cgsl2k65     |
|  ws-8d6il5kr3     |
|  ws-2dtyllq47     |
+-------------------+
```

3. Run the describe-workspaces-connection-status command using the ID of the WorkSpaces instance in the table output:

```bash
aws workspaces describe-workspaces-connection-status \
    --region us-east-1 \
    --workspace-ids ws-7cgsl2k65 \
    --query \
'WorkspacesConnectionStatus[*].LastKnownUserConnectionTimestamp'
```

4. The command should return the timestamp of the User last active for the selected instance:

```
[
    1489139777.721
]
```

5. Run the date command using the timestamp value returned at the previous step to convert it to a human readable date value:

```bash
date -d @1489139777.721
```

6. Verify the User Last Active attribute value is less than 30 days old:

```
Fri Mar 10 09:56:17 UTC 2017
```

If the User last active date returned is more than 30 days ago, the selected WorkSpaces instance is not utilized anymore and can be safely removed from your AWS account. Refer to the remediation procedure below to remove the WorkSpaces.

7. Repeat steps 3 – 6 to verify the User Last active date for the other WorkSpaces instances listed in the current region.
8. Change the AWS region by updating the --region command parameter value and repeat steps no. 1 – 7 to perform the entire audit process for other regions.

### Expected Result

All WorkSpaces instances have been accessed within the last 30 days.

## Remediation

### Using AWS Console

Perform the following to remove unused WorkSpaces based on the output collected from the audit procedure.

1. Log in to WorkSpaces dashboard at https://console.aws.amazon.com/workspaces/
2. In the left panel click WorkSpaces
3. Select the WorkSpace ID that you have identified as not being used.
4. Click Actions, Remove WorkSpaces
5. Confirm using the Audit that this is the WorkSpaces ID you should remove.
6. Click Remove WorkSpaces

### Using AWS CLI

**Note that running this command does not prompt you to confirm that you are removing the correct WorkSpaces ID.**

1. Run terminate-workspaces command using the ID of the WorkSpaces instance from the Audit that you want to delete:

```bash
aws workspaces terminate-workspaces \
    --region us-east-1 \
    --terminate-workspace-requests ws-0cgsl1k23
```

## Default Value

By default, Workspaces are not deleted after a defined period of inactivity.

## References

1. https://aws.amazon.com/workspaces/faqs/
2. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/workspaces/index.html#cli-aws-workspaces

## CIS Controls

**Controls Version v8:**

- 1.1 Establish and Maintain Detailed Enterprise Asset Inventory
- 3.5 Securely Dispose of Data

**Controls Version v7:**

- 1.4 Maintain Detailed Asset Inventory
- 13.2 Remove Sensitive Data or Systems Not Regularly Accessed by Organization

## Profile

Level 1
