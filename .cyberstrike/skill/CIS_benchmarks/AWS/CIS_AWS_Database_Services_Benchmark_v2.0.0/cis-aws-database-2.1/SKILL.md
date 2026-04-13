---
name: cis-aws-database-2.1
description: "Ensure the Use of Security Groups"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, aurora, security-groups, vpc, network, firewall]
cis_id: "2.1"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-2.9]
prerequisites: []
severity_boost: {}
---

# 2.1 Ensure the Use of Security Groups (Manual)

## Description

Security groups act as a firewall for associated Amazon RDS DB instances, controlling both inbound and outbound traffic.

## Rationale

Creating your severity group either inbound or outbound rules. Inbound rules allow an individual to create a rule that permits the traffic to go to a specific port depending on which source it's coming from. Outbound rules enable your instances to connect with one another allow them to connect to the internet. If needed, you can limit the outgoing traffic.

## Impact

Without properly configured security groups, the Aurora database instance may be accessible from unintended sources or may not be able to communicate with required services.

## Audit Procedure

### Using AWS Console

1. Open the Amazon Console
2. Go to Aurora and RDS (https://console.aws.amazon.com/rds/)
3. Click on Databases
4. For each database instance click the name of the instance and check that there is at least one VPC security group under Connectivity & security -> Security -> VPC security groups

## Expected Result

Each Aurora DB instance should have at least one VPC security group associated with it, with appropriate inbound and outbound rules configured.

## Remediation

### Using AWS Console

Here is a step-by-step guide on how to create and use Security Groups for an Amazon Aurora instance:

1. **Sign in to AWS Management Console**
   - If you do not already have an AWS account, you'll need to create one at https://aws.amazon.com.

2. **Navigate to Amazon EC2 Dashboard**
   - Once you have logged in to the AWS Management Console, navigate to the EC2 service. You can find this under the `Compute` category.

3. **Create a New Security Group**
   - In the EC2 Dashboard, find the `Network & Security` section on the left-side navigation pane, then click `Security Groups`.
   - Click on the `Create Security Group` button.

4. **Configure the New Security Group**
   - In the `Create Security Group` panel, give your new security group a name and a description.
   - Select the VPC in which your Amazon Aurora instance will be deployed.
   - Then click `Create`.

5. **Add Rules to the Security Group**
   - After creating the Security Group, you can add inbound and outbound rules.
   - For Inbound Rules:
     - Click on the `Inbound rules` tab, then click `Edit inbound rules`.
     - Click `Add Rule`. For the type, select MYSQL/Aurora. For the source, you can specify the IP addresses allowed to access your Amazon Aurora instance.
   - For Outbound Rules:
     - Click on the `Outbound rules` tab, then click `Edit outbound rules`. Outbound rules allow your instances to communicate with other instances or access the internet. You can restrict outbound traffic if necessary. In most cases, you can leave the default setting, which allows all outbound traffic.

6. **Assign the Security Group to Amazon Aurora**
   - When launching a new Amazon Aurora instance (in the Amazon RDS dashboard), you can select your new security group in the `Configure advanced settings` step.
   - If your Aurora instance has already been launched, you can modify it to use the new security group by selecting the instance.
   - Click `Modify`, and then select the new security group.

## Default Value

When an Aurora DB instance is created, it is associated with the default VPC security group unless a custom security group is specified.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | x | x | x |

## Profile

Level 1 | Manual
