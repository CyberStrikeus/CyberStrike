---
name: cis-aws-euc-5.5
description: "Ensure session Idle disconnect timeout is set to 10 minutes or less"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, appstream, session-management, timeout, idle]
cis_id: "5.5"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure session Idle disconnect timeout is set to 10 minutes or less (Automated)

## Profile Applicability

- Level 1

## Description

Idle disconnect timeout in minutes is the amount of time that users can be inactive before they are disconnected from their streaming session and the Disconnect timeout in minutes time begins.

## Rationale

Users are considered idle when they stop providing keyboard or mouse input during their streaming session. File uploads and downloads, audio in, audio out, and pixels changing do not qualify as user activity. Once disconnected from their streaming session the Disconnect timeout begins.

## Impact

None - this is a security best practice.

## Audit Procedure

Perform the following steps to view the Fleet settings in AppStream.

### Using AWS Console

1. Log in to the AppStream 2.0 console at `https://console.aws.amazon.com/appstream2`
2. In the left pane click on **Fleets**
3. Select the link for the fleet name you wish to view
4. Scroll to the **Fleet configuration** section and confirm that Idle disconnect timeout is set to **10** minutes or less

If Idle disconnect timeout is set to anything greater than 10 minutes refer to the remediation below.

### Using AWS CLI

Not applicable - must be audited via Console.

## Expected Result

Idle disconnect timeout is set to 10 minutes or less.

## Remediation

### Using AWS Console

Perform the following steps to view the Fleet settings in AppStream:

1. Log in to the AppStream 2.0 console at `https://console.aws.amazon.com/appstream2`
2. In the left pane click on **Fleets**
3. Select the link for the fleet name you wish to view
4. Scroll to the **Fleet configuration** section and click **Edit**
5. Change the Idle disconnect timeout to **10** minutes or less and click **Save changes**

### Using AWS CLI

Not applicable - must be configured via Console.

## Default Value

By default, AWS Appstream 2.0 idle disconnect time is 15 minutes.

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
