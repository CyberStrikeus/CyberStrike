---
name: cis-aws-database-3.1
description: "Ensure to Choose the Appropriate Database Engine"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, rds, engine-selection, architecture]
cis_id: "3.1"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-3.2, cis-aws-database-3.3]
prerequisites: []
severity_boost: {}
---

# 3.1 Ensure to Choose the Appropriate Database Engine (Manual)

## Description

This control ensures that the appropriate database engine is selected for the application's requirements on Amazon RDS.

## Rationale

Choosing the right database engine is critical for application performance, scalability, and security. Amazon RDS supports several popular relational database engines, including MySQL, PostgreSQL, MariaDB, Oracle Database, and Microsoft SQL Server.

## Impact

Selecting an inappropriate database engine may lead to performance issues, compatibility problems, higher costs, and security vulnerabilities.

## Audit Procedure

### Using AWS Console

1. Evaluate Your Requirements
   - Understand your application's specific requirements, such as performance, scalability, data volume, and compatibility with existing systems.
   - Consider factors like data structure, workload type (OLTP or OLAP), and specific features required by your application.

2. Research Available Database Engines
   - Familiarize yourself with the available database engine options supported by Amazon RDS.
   - Research each database engine's capabilities, features, performance characteristics, and licensing models.

3. Compare Features and Compatibility
   - Compare the features and capabilities of each database engine with your application's requirements.
   - Evaluate data types, indexing options, query optimization, high availability, replication, and backup and restore capabilities.
   - Consider compatibility with your existing applications, frameworks, and tools.

4. Evaluate Performance and Scalability
   - Consider the performance characteristics of each database engine, including throughput, latency, and concurrency capabilities.
   - Evaluate scalability options, such as horizontal scaling or vertical scaling.
   - Analyze benchmarks, customer reviews, and case studies to gain insights into the performance of each database engine.

5. Consider Managed Database Services
   - Assess the benefits of Amazon RDS managed database services, such as Amazon Aurora, which offers high performance, scalability, and built-in fault tolerance.
   - Evaluate the additional features and optimizations Amazon Aurora provides compared to traditional database engines.

6. Evaluate Licensing and Costs
   - Consider the licensing models and costs associated with each database engine, including license fees and support costs.
   - Evaluate the pricing structure of the database engines in terms of instance types, storage, data transfer, and other factors.

7. Determine Vendor Support
   - Evaluate the level of support the database engine vendors provide, including documentation, forums, community support, and enterprise support options.
   - Consider the vendor's reputation, track record, and commitment to security and compliance.

8. Make an Informed Decision
   - Select the database engine that best aligns with your application requirements, performance needs, scalability goals, compatibility, and budget based on your evaluation and analysis.
   - Consider long-term considerations such as potential future growth, flexibility, and ease of migration to other database engines if needed.

## Expected Result

The selected database engine should align with the application's specific requirements for performance, scalability, compatibility, and cost.

## Remediation

Review and evaluate the current database engine selection against the audit criteria above. If the current engine does not meet requirements, plan a migration to a more appropriate engine.

### Using AWS Console

Follow the audit steps above to evaluate and select the appropriate database engine. Create a new RDS instance with the chosen engine or plan migration from the existing engine.

## Default Value

No default database engine is pre-selected; users must choose during RDS instance creation.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 2.2 Ensure Authorized Software is Currently Supported | x    | x    | x    |
| v7               | 2.2 Ensure Software is Supported by Vendor            | x    | x    | x    |

## Profile

Level 1 | Manual
