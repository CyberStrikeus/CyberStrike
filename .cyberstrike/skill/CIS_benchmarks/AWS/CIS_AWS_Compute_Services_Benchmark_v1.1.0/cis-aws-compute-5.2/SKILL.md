---
name: cis-aws-compute-5.2
description: "Change default Administrator login names and passwords for applications"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lightsail, passwords, default-credentials, authentication]
cis_id: "5.2"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-5.12]
prerequisites: []
severity_boost: {}
---

# 5.2 Change default Administrator login names and passwords for applications (Manual)

## Description

Change the default settings for the administrator login names and passwords of the application software that you install on Lightsail instances.

## Rationale

Default administrator login names and passwords for applications used on Lightsail instances can be used by hackers and individuals to break into your servers.

## Impact

N/A

## Audit Procedure

### Using AWS Console

To confirm that you have updated or changed the default administrator name and password for any application you are using is a manual process. Often dependent on the application itself and the operating system you are utilizing for the Lightsail instance.

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Lightsail` under Compute.
3. This will open up the Lightsail console.
4. Select the `Instance` you want to review.
5. Make sure the instance status is `running`.
6. Connect to the `instance`.
7. Depending on the instance OS and the application you are running determine what the default administrator name is set to and what the password is.
8. If the `default administrator` username and or password is still at the default settings please refer to the remediation below.
9. Repeat steps no. 4 - 8 to verify if any Lightsail instances require application updates.

### Using AWS CLI

N/A - This is a manual process dependent on the application and OS.

## Expected Result

All applications running on Lightsail instances should have their default administrator login names and passwords changed from the defaults.

## Remediation

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Lightsail` under Compute.
3. This will open up the Lightsail console.
4. Select the `Instance` you want to update the `default administrator` settings.
5. Make sure the instance status is `running`.
6. Click on `Snapshots`
7. Under `Manual snapshots` click on `+ Create snapshot`
8. Give it a name you will recognize
9. Click on `create`

While in process it will show Snapshotting...

10. Once the date and time and snapshot name appears it is completed.
11. Click on `Connect`
12. Run the process to change either the `default administrator` name or password or both.
13. Repeat steps no. 4 - 12 to apply any application `default administrator` changes required on the Lightsail instances that you are running.

### Using AWS CLI

N/A - This is a manual process dependent on the application and OS.

## Default Value

Applications are installed with default administrator credentials.

## References

1. https://lightsail.aws.amazon.com/ls/docs/en_us/all

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v7 | 4.2 Change Default Passwords - Before deploying any new asset, change all default passwords to have values consistent with administrative level accounts. | x | x | x |

## Profile

Level 1 | Manual
