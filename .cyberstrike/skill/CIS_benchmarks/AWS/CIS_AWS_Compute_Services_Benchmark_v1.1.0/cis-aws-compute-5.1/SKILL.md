---
name: cis-aws-compute-5.1
description: "Apply updates to any apps running in Lightsail"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lightsail, patching, updates, applications]
cis_id: "5.1"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-5.11]
prerequisites: []
severity_boost: {}
---

# 5.1 Apply updates to any apps running in Lightsail (Manual)

## Description

Amazon Lightsail is a virtual private server (VPS) provider and is the easiest way to get started with AWS for developers, small businesses, students, and other users who need a solution to build and host their applications on cloud.

## Rationale

Lightsail offers a range of operating system and application templates that are automatically installed when you create a new Lightsail instance. Application templates include WordPress, Drupal, Joomla!, Ghost, Magento, Redmine, LAMP, Nginx (LEMP), MEAN, Node.js, Django, and more. You can install additional software on your instances by using the in-browser SSH or your own SSH client.

## Impact

N/A

## Audit Procedure

### Using AWS Console

To confirm that you are running the latest version of the application you are using is a manual process. Often dependent on the application itself and the operating system you are utilizing for the Lightsail instance.

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Lightsail` under Compute.
3. This will open up the Lightsail console.
4. Select the `Instance` you want to review.
5. Make sure the instance status is `running`.
6. Connect to the `instance`.
7. Depending on the instance OS and the application you are running determine what version it is and if there are any updates.
8. If there are updates refer to the remediation below.
9. Repeat steps no. 4 - 8 to verify if any Lightsail instances require application updates.

### Using AWS CLI

N/A - This is a manual process dependent on the application and OS.

## Expected Result

All applications running on Lightsail instances should be running the latest stable version with all security patches applied.

## Remediation

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Lightsail` under Compute.
3. This will open up the Lightsail console.
4. Select the `Instance` you want to update.
5. Make sure the instance status is `running`.
6. Click on `Snapshots`
7. Under `Manual snapshots` click on `+ Create snapshot`
8. Give it a name you will recognize
9. Click on `create`

While in process it will show 'Snapshotting...'

10. Once the date and time and snapshot name appears it is completed.
11. Click on `Connect`
12. Run the updates for the application discovered above in the Audit.
13. Repeat steps no. 4 - 12 to apply any application updates required on the Lightsail instances that you are running.

### Using AWS CLI

N/A - This is a manual process dependent on the application and OS.

## Default Value

Applications are installed with the version available at instance creation time. Updates are not applied automatically.

## References

1. https://lightsail.aws.amazon.com/ls/docs/en_us/overview
2. https://aws.amazon.com/lightsail/features/?opdp2=features/?pg=ln&sec=hs

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 7.4 Perform Automated Application Patch Management - Perform application updates on enterprise assets through automated patch management on a monthly, or more frequent, basis.                                                        | x    | x    | x    |
| v7               | 3.5 Deploy Automated Software Patch Management Tools - Deploy automated software update tools in order to ensure that third-party software on all systems is running the most recent security updates provided by the software vendor. | x    | x    | x    |

## Profile

Level 1 | Manual
