---
name: cis-aws-euc-2.13
description: "Ensure Workspaces images are not older than 90 days"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workspaces, image-management, patching]
cis_id: "2.13"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Workspaces images are not older than 90 days (Manual)

## Description

WorkSpaces images should not have a creation time stamp over 90 days.

## Rationale

WorkSpaces images require Operating system patches to be applied and updated and by confirming the creation date is not over 90 days old can help ensure that updates are being applied.

## Impact

None

## Audit Procedure

### Using AWS Console

Perform the following to determine the age of WorkSpaces images.

1. Login to the WorkSpaces dashboard at https://console.aws.amazon.com/workspaces/
2. In the left pane click Images.
3. Review the Created date and confirm that all images are newer than 90 days.

If any images are older than 90 days refer to the remediation procedure below.

### Expected Result

All WorkSpaces images have a creation date within the last 90 days.

## Remediation

### Using AWS Console

To create a custom image:

**Note:** If you are still connected to the WorkSpace, disconnect.

1. Log in to the WorkSpaces console at https://console.aws.amazon.com/workspaces/
2. In the left pane, choose WorkSpaces.
3. Select the WorkSpace and choose Actions, Create Image.

A message displays, prompting you to restart your WorkSpace before continuing. Restarting your WorkSpace updates your Amazon WorkSpaces software to the latest version.

Once you have restarted your WorkSpace, repeat Step 4 of this procedure.

5. Click Next.
6. Enter an image name and a description.
7. Click Create Image. While the image is being created, the status of the WorkSpace is Suspended and the WorkSpace is unavailable.

In the left pane, click Images. The image is complete when the status of the WorkSpace changes to Available.

## Default Value

By default, images can exist for indefinite time.

## CIS Controls

**Controls Version v8:**

- 2.3 Address Unauthorized Software

**Controls Version v7:**

- 2.6 Address unapproved software

## Profile

Level 1
