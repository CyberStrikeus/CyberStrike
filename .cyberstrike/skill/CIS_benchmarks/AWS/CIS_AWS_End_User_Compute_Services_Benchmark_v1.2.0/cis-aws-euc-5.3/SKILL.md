---
name: cis-aws-euc-5.3
description: "Ensure maximum session duration is no longer than 10 hours"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, appstream, session-management, timeout]
cis_id: "5.3"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure maximum session duration is no longer than 10 hours (Automated)

## Profile Applicability

- Level 1

## Description

When creating a fleet for AppStream 2.0 configure the Maximum session duration in minutes to be no greater than 600.

## Rationale

Having a session duration lasting longer than 10 hours should not be necessary and if running for any malicious reasons provides a greater time for usage than should be allowed.

## Impact

None - this is a security best practice.

## Audit Procedure

Perform the following steps to view the Fleet settings in AppStream.

### Using AWS Console

1. Log in to the AppStream 2.0 console at `https://console.aws.amazon.com/appstream2`
2. In the left pane click on **Fleets**
3. Select the link for the fleet name you wish to view
4. On the **Fleet configuration** section confirm that Maximum session duration is set to **600** minutes or less

If Maximum session duration is set to anything greater than 600 minutes refer to the remediation below.

### Using AWS CLI

Not applicable - must be audited via Console.

## Expected Result

Maximum session duration is set to 600 minutes (10 hours) or less.

## Remediation

### Using AWS Console

Perform the following steps to edit the Fleet settings in AppStream:

1. Log in to the AppStream 2.0 console at `https://console.aws.amazon.com/appstream2`
2. In the left pane click on **Fleets**
3. Select the link for the fleet name you wish to edit
4. Click **Actions**, **Stop**
5. Scroll to the **Fleet configuration** section and click **Edit**
6. Change the Maximum session duration is set to **600** minutes or less and click **Save Changes**
7. Click **Actions**, **Start**

### Using AWS CLI

Not applicable - must be configured via Console.

## Default Value

By default, AWS Appstream 2.0 maximum session time is 960 minutes.

## References

1. https://docs.aws.amazon.com/appstream2/latest/developerguide/set-up-stacks-fleets.html
2. https://us-east-1.console.aws.amazon.com/appstream2/home?region=us-east-1#/create-fleet

## CIS Controls

**v8:**
- 0.0 Explicitly Not Mapped

**v7:**
- 0.0 Explicitly Not Mapped

## Profile

Level 1
