---
name: cis-aws-euc-5.4
description: "Ensure session disconnect timeout is set to 5 minutes or less"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, appstream, session-management, timeout]
cis_id: "5.4"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure session disconnect timeout is set to 5 minutes or less (Automated)

## Profile Applicability

- Level 1

## Description

Disconnect timeout in minutes, is the amount of of time that a streaming session remains active after users disconnect.

## Rationale

If users try to reconnect to the streaming session after a disconnection or network interruption within the 5 minutes, they are connected to their previous session. Otherwise, they are connected to a new session with a new streaming instance and that instance isn't sitting out there not being used.

## Impact

None - this is a security best practice.

## Audit Procedure

Perform the following steps to view the Fleet settings in AppStream.

### Using AWS Console

1. Log in to the AppStream 2.0 console at `https://console.aws.amazon.com/appstream2`
2. In the left pane click on **Fleets**
3. Select the link for the fleet name you wish to view
4. On the **Fleet configuration** section confirm that Disconnect timeout is set to **5** minutes or less

If Disconnect timeout is set to anything greater than 5 minutes refer to the remediation below.

### Using AWS CLI

Not applicable - must be audited via Console.

## Expected Result

Disconnect timeout is set to 5 minutes or less.

## Remediation

### Using AWS Console

Perform the following steps to update the Fleet settings in AppStream:

1. Log in to the AppStream 2.0 console at `https://console.aws.amazon.com/appstream2`
2. In the left pane click on **Fleets**
3. Select the link for the fleet name you wish to edit
4. Scroll to the **Fleet configuration** section and click **Edit**
5. Change the Disconnect timeout to **5** minutes or less

### Using AWS CLI

Not applicable - must be configured via Console.

## Default Value

By default, AWS Appstream 2.0 session disconnect time is set to 15 minutes.

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
