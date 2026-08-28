---
name: cis-aws-database-3.2
description: "Ensure to Create The Appropriate Deployment Configuration"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, rds, deployment, multi-az, high-availability]
cis_id: "3.2"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-3.1, cis-aws-database-3.3, cis-aws-database-3.10]
prerequisites: []
severity_boost: {}
---

# 3.2 Ensure to Create The Appropriate Deployment Configuration (Manual)

## Description

This control is important and helps businesses to choose from two deployment options, either single or multi-AZ deployment. Depending on the business factor and their security needs the organization is then encouraged to make a decision that would benefit them.

## Rationale

Selecting the appropriate deployment configuration ensures high availability, data durability, and minimal downtime based on business requirements.

## Impact

Choosing the wrong deployment configuration could lead to unnecessary downtime, data loss during failures, or excessive costs for over-provisioned infrastructure.

## Audit Procedure

### Using AWS Console

1. Evaluate High Availability Requirements
   - Assess the high availability needs of your application. Consider factors such as uptime requirements, business continuity, and disaster recovery.
   - Determine if your application requires automatic failover, data durability, and minimal downtime during maintenance or outages.

2. Understand RDS Deployment Options
   - Familiarize yourself with the deployment options available on Amazon RDS. These include single-AZ (Availability Zone) and multi-AZ deployments.
   - Understand the differences between these options regarding availability, durability, and cost.

3. Single-AZ Deployment
   - Consider a single-AZ deployment if high availability is not a critical requirement for your application.
   - In a single-AZ deployment, your database runs in a single Availability Zone, providing basic durability and availability.

4. Multi-AZ Deployment
   - Choose a multi-AZ deployment if high availability and automatic failover are crucial for your application.
   - In a multi-AZ deployment, your database is replicated synchronously to a standby replica in a different Availability Zone, providing automatic failover in the event of a primary database failure.
   - Multi-AZ deployments provide enhanced availability and durability, ensuring minimal downtime during maintenance or outages.

5. Evaluate Cost Implications
   - Consider the cost implications of your deployment choice.
   - Multi-AZ deployments incur additional costs than single-AZ deployments due to the replication and standby infrastructure.

6. Make a Deployment Decision
   - Based on your evaluation of high availability requirements, consider the trade-offs between single-AZ and multi-AZ deployments.
   - Choose the appropriate deployment configuration that meets your application's availability, durability, and cost requirements.

7. Configure RDS Deployment
   - Once you have determined the deployment configuration, go to the Amazon RDS console.
   - Create a new database instance or modify an existing one to match your chosen deployment configuration.
   - Follow the prompts and configure the deployment options, selecting the desired AZs and replication settings.
   - Adjust other configuration settings, such as instance type, storage, and backup options, based on your application's needs.

8. Test and Monitor
   - After the deployment is set up, thoroughly test your application's functionality and performance.
   - Monitor the RDS instance and replication status using the Amazon RDS console or CloudWatch metrics.
   - Ensure that the database failover and automatic maintenance operations work as expected.

## Expected Result

The deployment configuration should match the application's high availability and durability requirements. Production databases handling critical workloads should use multi-AZ deployments.

## Remediation

### Using AWS Console

Review the current deployment configuration and modify to multi-AZ if high availability is required. In the Amazon RDS console, select the instance, click Modify, and enable Multi-AZ deployment.

## Default Value

Single-AZ deployment is the default when creating a new RDS instance.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------- | ---- | ---- | ---- |
| v8               | 0.0 Explicitly Not Mapped |      |      |      |
| v7               | 0.0 Explicitly Not Mapped |      |      |      |

## Profile

Level 1 | Manual
