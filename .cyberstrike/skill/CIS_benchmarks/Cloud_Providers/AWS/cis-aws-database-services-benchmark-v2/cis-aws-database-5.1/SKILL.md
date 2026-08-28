---
name: cis-aws-database-5.1
description: "Ensure Secure Access to ElastiCache"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, elasticache, redis, iam, access-control, security]
cis_id: "5.1"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-5.2, cis-aws-database-5.8]
prerequisites: []
severity_boost: {}
---

# 5.1 Ensure Secure Access to ElastiCache

## Description

Securing access to Amazon ElastiCache involves implementing appropriate authentication and authorization mechanisms.

## Rationale

N/A

## Impact

N/A

## Audit Procedure

### Using AWS Console

1. Use AWS Identity and Access Management (IAM)
   - Sign in to the AWS Management Console and open the IAM console at https://console.aws.amazon.com/iam/.
   - Create IAM users or roles for individuals or applications needing ElastiCache access.
   - Define fine-grained permissions using IAM policies to allow only necessary actions on ElastiCache resources.
   - Assign IAM policies to the IAM users or roles to grant access.

2. Implement Secure Network Access
   - Place your ElastiCache cluster within a Virtual Private Cloud (VPC) to control network access.
   - Create and configure security groups to allow access only from trusted networks or specific IP ranges.
   - Ensure your VPC's network ACLs (Access Control Lists) are properly configured to restrict inbound and outbound traffic.

3. Enable Encryption in Transit
   - Configure your ElastiCache cluster to use SSL/TLS encryption for client connections.
   - Use the `--transit-encryption-enabled` parameter when creating or modifying the cluster to enable encryption in transit.
   - Update your client applications to connect to the ElastiCache cluster using SSL/TLS.

4. Protect ElastiCache Credentials
   - Avoid sharing access keys, secret keys, or IAM user credentials between individuals.
   - Use IAM roles for Amazon EC2 instances or other AWS services to securely access ElastiCache without needing credentials.
   - Rotate your access keys regularly and disable or remove unnecessary IAM users or roles.

5. Enable Event Logging and Monitoring
   - Enable CloudWatch Logs for your ElastiCache clusters to capture logs and monitor activities.
   - Configure CloudWatch Alarms to be notified of any unusual or suspicious behavior.
   - Set up CloudTrail to log API calls made to ElastiCache for auditing and compliance purposes.

6. Regularly Review and Update Access Controls
   - Perform regular reviews of IAM policies, security groups, and network ACLs to ensure they align with your security requirements.
   - Remove any unnecessary or excessive privileges from IAM policies.
   - Stay updated with AWS security best practices and recommendations to improve access controls.

## Expected Result

IAM policies are configured with least privilege access, ElastiCache clusters are in VPCs with proper security groups, encryption in transit is enabled, and logging/monitoring is active.

## Remediation

### Using AWS Console

Follow the same steps as the audit procedure to secure access to ElastiCache clusters.

## Default Value

By default, ElastiCache clusters are accessible within the VPC they are created in, but detailed IAM policies, encryption in transit, and monitoring need to be configured.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

Level 1 | Manual
