---
name: cis-aws-database-10.7
description: "Ensure Regular Updates and Patches are Installed"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, timestream, time-series, patching, vulnerability-management]
cis_id: "10.7"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-10.6, cis-aws-database-10.8, cis-aws-database-10.9]
prerequisites: []
severity_boost: {}
---

# 10.7 Ensure Regular Updates and Patches are Installed (Manual)

## Description
Stay updated with the latest security patches and updates provided by AWS for Amazon Timestream. Follow AWS security best practices and recommendations to ensure your Timestream implementation remains secure.

## Rationale
Regular updates and patches address known vulnerabilities and security weaknesses in the service.

## Impact
This helps the organization reduce their security risk by regularly updating and patching their database and database engine. Regularly updating and scanning for any weaknesses in the company can bring up possible vulnerabilities that could have led to potential cyber-attack.

## Audit Procedure

### Using AWS Console
1. Stay Informed about Updates:
   - Stay updated with the latest announcements and releases related to Amazon Timestream. Subscribe to AWS notifications, blogs, and forums to learn about new features, enhancements, and security patches.
2. Review AWS Documentation:
   - Regularly review the official AWS documentation for Amazon Timestream. Pay attention to any updates or recommendations related to security, performance, and best practices.
3. Implement a Patch Management Process:
   - Establish a patch management process specific to Amazon Timestream within your organization. Define roles and responsibilities for managing patches, including testing and deployment procedures.
4. Test Patches in a Non-Production Environment:
   - Before deploying patches in production, create a non-production environment to test the patches. Set up a replica or a sandbox environment that resembles your production environment. Test the patches thoroughly to ensure they do not introduce compatibility issues or adverse effects.
5. Schedule Patching Maintenance Windows:
   - Identify suitable maintenance windows to apply patches to your Timestream resources. Consider the impact on system availability and plan the maintenance window accordingly. Coordinate with relevant teams and stakeholders to ensure minimal disruption during the patching process.
6. Apply Patches:
   - Once you have successfully tested the patches in the non-production environment and scheduled a maintenance window. Apply the patches to your production Timestream resources. Follow the recommended patching procedures provided by AWS in the documentation. Ensure you follow any specific instructions or requirements for applying patches to Timestream.
7. Verify Patch Deployment:
   - After applying patches, monitor the Timestream resources to ensure they function as expected. Conduct thorough testing to validate that the patched resources operate correctly and have not introduced any issues.
8. Regularly Monitor for Updates:
   - Continuously monitor for new updates, patches, and security bulletins related to Amazon Timestream. Stay informed about any vulnerabilities or critical patches that require immediate attention. Adjust your patch management process and schedule to incorporate new updates and releases.
9. Automate Patch Management (Optional):
   - Consider automating the patch management process using AWS tools or third-party solutions. Implement automation scripts or systems that handle patch deployments, testing, and monitoring.

## Expected Result
A patch management process should be established and regularly followed, with all Timestream-related components kept up to date with the latest security patches.

## Remediation

### Using AWS Console
Follow the audit steps above to establish and maintain a patch management process for your Amazon Timestream environment.

## Default Value
Amazon Timestream is a fully managed service; AWS handles underlying infrastructure patching. Client-side components and SDK updates are the user's responsibility.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 7 Continuous Vulnerability Management | | | |
| v7 | 3 Continuous Vulnerability Management | | | |

## Profile
Level 1 | Manual
