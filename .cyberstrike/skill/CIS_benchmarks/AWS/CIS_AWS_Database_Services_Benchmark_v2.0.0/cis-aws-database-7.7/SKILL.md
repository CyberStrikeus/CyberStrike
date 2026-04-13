---
name: cis-aws-database-7.7
description: "Ensure Regular Updates and Patches"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, documentdb, patching, updates, maintenance]
cis_id: "7.7"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-7.11]
prerequisites: []
severity_boost: {}
---

# 7.7 Ensure Regular Updates and Patches (Manual)

## Description

Stay informed about the latest security updates and patches released by Amazon for DocumentDB. Regularly apply updates and patches to your DocumentDB instances to protect against known vulnerabilities.

## Rationale

Regular patching and updates are essential to protect DocumentDB instances from known security vulnerabilities and ensure the database engine is running with the latest security fixes.

## Impact

Helps the organization reduce their security risk by regularly updating and patching their database and database engine. Regularly updating and scanning for any weaknesses in the company can bring up possible vulnerabilities that could have led to potential cyber-attack.

## Audit Procedure

### Using AWS Console

1. Stay Informed
   - Stay updated with Amazon DocumentDB announcements, release notes, and security bulletins.
   - Subscribe to AWS newsletters, forums, and notifications to receive timely updates regarding updates and patches.

2. Plan for Maintenance Windows
   - Determine a suitable maintenance window to apply updates and patches to your DocumentDB cluster.
   - Consider the impact on your applications and users when scheduling the maintenance window.

3. Monitor the AWS Management Console
   - Regularly check the AWS Management Console for notifications related to available updates and patches for your DocumentDB cluster.
   - The console will provide information on new versions and available patches.

4. Review the Release Notes and Changelog
   - Before applying any updates or patches, review the release notes and changelog for the new version or patch.
   - Pay attention to any compatibility or breaking changes that may require application adjustments.

5. Create a Test Environment (Optional)
   - If feasible, create a separate test environment that closely resembles your production environment.
   - Deploy a copy of your DocumentDB cluster in the test environment to test the updates and patches before applying them to production.

6. Apply Updates and Patches
   - During the scheduled maintenance window, initiate the process to apply updates and patches to your DocumentDB cluster.
   - Follow the recommended procedure provided by AWS, which may involve a few simple clicks in the AWS Management Console.
   - Ensure that you select the appropriate version or patch to apply.

7. Monitor the Update Process
   - Monitor the progress of the update or patch application for your DocumentDB cluster.
   - AWS will provide status updates during the process to keep you informed.

8. Verify Post-Update Functionality
   - After the update or patch is applied, test the functionality of your applications that rely on the DocumentDB cluster.
   - Verify that your applications are working as expected and that any integration or dependencies are intact.

9. Review and Update Documentation
   - Update your documentation, including standard operating procedures (SOPs), to reflect the new version or patch applied to the DocumentDB cluster.
   - Document any changes or considerations specific to the update or patch.

10. Monitor for New Updates
    - Continuously monitor for new updates and patches released by AWS for DocumentDB.
    - Repeat the update process regularly to ensure your DocumentDB cluster remains up to date with the latest security enhancements and bug fixes.

## Expected Result

DocumentDB clusters are running the latest available engine version with all applicable security patches applied.

## Remediation

### Using AWS Console

Follow the audit procedure steps to identify available updates and apply them during scheduled maintenance windows. Use the AWS Management Console to modify the DocumentDB cluster and apply the latest engine version.

## Default Value

Amazon DocumentDB applies minor patches automatically during the configured maintenance window. Major version upgrades require manual action.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------- | ---- | ---- | ---- |
| v8               | 7 Continuous Vulnerability Management |      |      |      |
| v7               | 3 Continuous Vulnerability Management |      |      |      |

## Profile

Level 1 | Manual
