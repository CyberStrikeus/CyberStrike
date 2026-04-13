---
name: cis-aws-database-3.8
description: "Ensure to Regularly Patch Systems"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, rds, patching, maintenance, updates]
cis_id: "3.8"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-3.1, cis-aws-database-3.11]
prerequisites: []
severity_boost: {}
---

# 3.8 Ensure to Regularly Patch Systems (Manual)

## Description

This control ensures that RDS database instances and their database engines are regularly updated and patched to address security vulnerabilities and maintain system integrity.

## Rationale

Regular patching addresses known security vulnerabilities, bug fixes, and performance improvements, reducing the attack surface and maintaining compliance.

## Impact

Helps the organization reduce their security risk by regularly updating and patching their database and database engine. Regularly updating and scanning for any weaknesses in the company can bring up possible vulnerabilities that could have led to potential cyber-attack.

## Audit Procedure

### Using AWS Console

1. Stay Informed about Database Engine Updates
   - Stay up-to-date with the latest information regarding database engine updates and patches provided by the respective database engine vendors (e.g., MySQL, PostgreSQL, Oracle, SQL Server).
   - Subscribe to release announcements, security bulletins, and updates from the database engine vendor or AWS.

2. Review the Database Engine Documentation
   - Refer to the documentation provided by the database engine vendor to understand the recommended patching and update processes specific to the database engine you use on Amazon RDS.
   - Review the vendor's guidelines and best practices for applying updates and patches.

3. Plan for Maintenance Windows
   - Determine regular maintenance windows during which you can schedule updates and patches for your RDS instances.
   - Coordinate with your team to ensure minimal disruption to your applications and users during the maintenance window.

4. Enable Automated Minor Version Upgrades
   - In the Amazon RDS console, select the RDS instance you want to enable automated upgrades.
   - Under the `Maintenance & backups` or `Maintenance` section.
   - Enable the `Auto minor version upgrade` option.
   - This allows Amazon RDS to automatically apply eligible minor version upgrades to your RDS instances during the maintenance window.

5. Monitor Available Updates
   - Regularly monitor the `Pending Maintenance` section in the Amazon RDS console for any updates or patches for your RDS instances.
   - Pay attention to notifications and alerts from AWS about pending updates.

6. Schedule Updates and Patches
   - Review the available updates and patches and their associated release notes and security advisories.
   - Please select the appropriate updates based on their impact, criticality, and compatibility with your applications.
   - Schedule the updates and patches to be applied during the designated maintenance window.

7. Apply Updates and Patches
   - During the scheduled maintenance window, Amazon RDS automatically applies the eligible updates and patches to your RDS instances.
   - Monitor the progress of the updates and patches through the Amazon RDS console.

8. Test and Validate
   - After the updates and patches are applied, thoroughly test your applications to ensure they function as expected.
   - Validate the database performance, data integrity, and application functionality.

9. Monitor for Issues
   - Monitor the performance and behavior of your RDS instances after the updates and patches are applied.
   - Keep an eye out for any issues or anomalies and address them promptly.

10. Review and Document
    - Review the release notes and documentation of the applied updates and patches to understand the changes and improvements they bring.
    - Document the update and patching process, including the applied versions, dates, and any issues encountered.

## Expected Result

Auto minor version upgrades should be enabled, and RDS instances should be running supported and up-to-date engine versions with no pending critical patches.

## Remediation

### Using AWS Console

Enable Auto minor version upgrade in the RDS instance settings. Schedule and apply any pending maintenance actions. Review and apply major version upgrades as needed following proper testing.

## Default Value

Auto minor version upgrade is enabled by default for new RDS instances. Maintenance windows are assigned automatically but can be customized.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 7 Continuous Vulnerability Management | | | |
| v7 | 3 Continuous Vulnerability Management | | | |

## Profile

Level 1 | Manual
