---
name: cis-aws-database-5.7
description: "Ensure Security Configurations are Reviewed Regularly"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, elasticache, redis, security-review, configuration, compliance]
cis_id: "5.7"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-5.1, cis-aws-database-5.3, cis-aws-database-5.5]
prerequisites: []
severity_boost: {}
---

# 5.7 Ensure Security Configurations are Reviewed Regularly

## Description

Regularly updating and reviewing the security configuration of your Amazon ElastiCache clusters helps ensure that your clusters are protected against potential vulnerabilities and aligned with your security requirements.

## Rationale

This ensures that the clusters are being regularly updated and protected from any potential vulnerabilities as well as meeting the security requirements.

## Impact

Updating the system and being updated with security configurations keeps everything secure and prevents it from an attack.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console
   - Sign in to the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the ElastiCache Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/elasticache/.

3. Select the ElastiCache Cluster
   - Choose the ElastiCache cluster you want to update and review the security configuration. Click on the cluster name to access its details page.

4. Review IAM Policies
   - Navigate to the `Configuration` tab on the cluster details page.
   - Click on the `IAM Access` tab.
   - Review the IAM policies associated with the ElastiCache cluster and its resources.
   - Ensure that the IAM policies provide the least privileged access, granting only the necessary permissions to users and roles.
   - Update the IAM policies as required based on changes in access requirements or security best practices.

5. Review Security Groups
   - Navigate to the `Configuration` tab on the cluster details page.
   - Click on the `Security Groups` tab.
   - Review the security groups associated with the ElastiCache cluster.
   - Ensure that the inbound and outbound rules of the security groups are configured correctly and restrict access to necessary ports and IP ranges.
   - Update the security group rules as needed to align with your security requirements.

6. Review Encryption Settings
   - Navigate to the `Configuration` tab on the cluster details page.
   - Click on the `Encryption at Rest` tab.
   - Verify the encryption settings for the ElastiCache cluster.
   - Ensure that encryption at rest is enabled and using the appropriate encryption type (default AWS-managed key or customer-managed key).
   - Update the encryption settings if necessary to comply with your security policies.

7. Review Network Security
   - Navigate to the `Configuration` tab on the cluster details page.
   - Click on the `Network & Security` tab.
   - Review the VPC, subnets, security groups, and network ACLs associated with the ElastiCache cluster.
   - Ensure that the VPC and subnet configurations align with your security requirements.
   - Update the network security settings as needed to maintain a secure network architecture.

8. Review Access Control
   - Navigate to the `Configuration` tab on the cluster details page.
   - Click on the `Security` tab.
   - Review the authentication and access control settings for the ElastiCache cluster.
   - Ensure that the authentication method (no password, transit encryption, or encryption in transit) meets your security standards.
   - Update the access control settings as required to align with your security policies.

9. Regularly Monitor Security Bulletins
   - Stay updated with AWS security bulletins, advisories, and best practices.
   - Regularly review security-related announcements from AWS.
   - Take necessary actions based on security recommendations, such as applying patches or configuration changes.

## Expected Result

All ElastiCache security configurations (IAM policies, security groups, encryption settings, network security, access control) are regularly reviewed and aligned with security requirements.

## Remediation

### Using AWS Console

Follow the same steps as the audit procedure to review and update security configurations for ElastiCache clusters on a regular schedule.

## Default Value

N/A - This is a procedural control that requires regular manual review.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                                                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5 Account Management                                                                                  |      |      |      |
| v7               | 5 Secure Configuration for Hardware and Software on Mobile Devices, Laptops, Workstations and Servers |      |      |      |

## Profile

Level 1 | Manual
