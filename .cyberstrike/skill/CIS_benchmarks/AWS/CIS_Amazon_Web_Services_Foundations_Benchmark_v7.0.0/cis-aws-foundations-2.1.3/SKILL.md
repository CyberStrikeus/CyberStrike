---
name: cis-aws-foundations-2.1.3
description: "Ensure Organizations management account is not used for workloads"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, organizations, management-account, workload-isolation]
cis_id: "2.1.3"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.1.1, cis-aws-foundations-2.1.4]
prerequisites: []
severity_boost: {}
---

# Ensure Organizations management account is not used for workloads

## Description

Ensure that the AWS Organizations management account is used only for organizational governance tasks and does not host production workloads, applications, or business data. The management account is the most privileged account in an AWS Organization and performs sensitive administrative functions such as creating and managing member accounts, applying service control policies (SCPs), and managing consolidated billing. Workloads, applications, and associated data should be deployed in dedicated member accounts, not in the management account.

## Rationale

The management account has unique privileges that cannot be restricted by SCPs, making it the highest-risk account in an organization. Deploying workloads or storing business data in the management account increases the attack surface and blast radius of a compromise. If a workload vulnerability or misconfiguration occurs in the management account, it could grant attackers access to organization-wide administrative capabilities.

## Impact

Restricting the management account to governance-only use may require creating new member accounts, redesigning existing account boundaries, and migrating workloads and data out of the management account. This can introduce short-term complexity and operational overhead. However, it reduces the blast radius of a compromise, simplifies security controls in the most privileged account, and aligns the environment with AWS multi-account and workload-isolation best practices.

## Audit Procedure

### Using AWS CLI

1. Confirm which AWS account is the management account for the organization (for example, via AWS Organizations "Overview" page or organizational documentation).
2. Ensure you have read-only access to review resources in this account.
3. Use your organization's standard discovery methods (for example, AWS Config, CMDB/asset inventory, or CSPM) to obtain a list of services and resources running in the management account.
4. At a minimum, identify compute, storage, database, and application services (for example, EC2, Lambda, ECS, S3, RDS, DynamoDB, API Gateway, load balancers).

```bash
# List EC2 instances in the management account
aws ec2 describe-instances --query 'Reservations[*].Instances[*].[InstanceId,State.Name,Tags[?Key==`Name`].Value|[0]]' --output table

# List Lambda functions
aws lambda list-functions --query 'Functions[*].[FunctionName,Runtime]' --output table

# List RDS instances
aws rds describe-db-instances --query 'DBInstances[*].[DBInstanceIdentifier,Engine,DBInstanceStatus]' --output table

# List ECS clusters
aws ecs list-clusters

# List S3 buckets
aws s3api list-buckets --query 'Buckets[*].Name' --output table
```

5. For each identified resource, determine whether it is:
   - Governance/security: resources that support centralized management, logging, audit, or security (for example, org-wide CloudTrail, Config aggregator, Security Hub or GuardDuty delegated admin, billing/cost tooling).
   - Workload/business: resources that support business applications, production or non-production workloads, or customer-facing systems.

6. If any workload/business resources are present in the management account, record this as a gap and document the affected services and resource types.

## Expected Result

The management account contains only governance and security resources. No workload or business application resources are present.

## Remediation

1. Inventory all workload resources currently in the management account (compute, storage, databases, application services).
2. For each class of workload resource (for example, production, non-production, shared services), create or confirm dedicated member accounts within the organization and place them into the appropriate OUs.
3. For each workload resource, design a migration plan to the appropriate member account.
4. Execute the migrations in phases, starting with lower-risk environments (for example, development/test) before production.
5. Review and adjust IAM roles and permissions in the management account so that only personnel responsible for organization governance and security have access.
6. Update architecture diagrams, runbooks, and onboarding processes to state that new workloads must be deployed only into designated workload accounts, not the management account.

## Default Value

AWS does not restrict the management account from hosting workloads. By default, any AWS services can be deployed in any account including the management account.

## References

- [AWS Documentation - AWS Organizations Best Practices](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_best-practices.html)
- [AWS Well-Architected Framework - Multi-Account Strategy](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/aws-account-management-and-separation.html)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.12 Segment Data Processing and Storage Based on Sensitivity | | * | * |

## Profile

Level 2 | Manual
