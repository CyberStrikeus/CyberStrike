---
name: cis-aws-database-10.1
description: "Ensure Data Ingestion is Secure"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, timestream, time-series, data-ingestion, security]
cis_id: "10.1"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-10.2, cis-aws-database-10.3, cis-aws-database-10.4]
prerequisites: []
severity_boost: {}
---

# 10.1 Ensure Data Ingestion is Secure (Manual)

## Description
Ensure that data ingestion into Amazon Timestream is performed securely, with proper authentication, encryption, and validation mechanisms in place.

## Rationale
This helps ensure that the system is updated with any potential vulnerabilities that might pose a threat to the organization. Helps authenticate the sources that are coming to the database and ensures that only authorized users have the credential to access the data.

## Impact
Secure data ingestion protects the integrity and confidentiality of time-series data being stored in Timestream.

## Audit Procedure

### Using AWS Console
1. Secure Data Sources:
   - Ensure that your data sources are protected with appropriate security measures. Implement secure network configurations, access controls, and authentication mechanisms for your data sources. Apply security patches and updates to your data source systems to prevent vulnerabilities.
2. Use HTTPS or AWS Direct Connect:
   - When ingesting data into Timestream, use secure communication protocols such as HTTPS. Encrypt data in transit to protect it from unauthorized interception. Consider using AWS Direct Connect for a dedicated private network connection to Timestream, ensuring data privacy.
3. Implement Client-Side Encryption:
   - Encrypt your data before sending it to Timestream using client-side encryption. Use industry-standard encryption algorithms and strong encryption keys to protect the confidentiality of your data. Store and manage the encryption keys securely using AWS Key Management Service (KMS).
4. Authenticate Data Sources:
   - Implement authentication mechanisms for your data sources to ensure only authorized sources can ingest data into Timestream. Use mechanisms such as API keys, access tokens, or client certificates to verify the authenticity of the data source. Consider integrating with AWS Identity and Access Management (IAM) for centralized authentication and access control.
5. Validate and Sanitize Data:
   - Implement data validation and sanitization mechanisms to prevent injection attacks or malformed data from being ingested into Timestream. Use input validation techniques and enforce data format requirements to ensure the integrity of the ingested data. Implement data quality checks to identify and handle anomalies or outliers.
6. Monitor Data Ingestion:
   - Implement monitoring and logging for data ingestion processes. Regularly review logs and metrics related to data ingestion to detect anomalies or suspicious activities. Set up alarms and notifications for data ingestion failures or unexpected patterns.
7. Regularly Update Data Ingestion Components:
   - Keep your data ingestion components, such as APIs, scripts, or connectors, up to date with the latest security patches and updates. Follow safe coding practices and stay informed about security vulnerabilities and fixes specific to your data ingestion tools.
8. Implement Network Security Controls:
   - Use network security controls such as security groups, network ACLs, and VPC configurations to restrict access to your Timestream resources. Configure inbound and outbound traffic rules to allow only necessary network connections for data ingestion. Follow the principle of least privilege, granting access only to the required IPs or networks.

## Expected Result
Data ingestion should use HTTPS/TLS, client-side encryption, proper authentication, input validation, and network security controls.

## Remediation

### Using AWS Console
Follow the audit steps above to implement secure data ingestion practices for your Amazon Timestream environment.

## Default Value
No default secure ingestion configuration. Users must implement security controls for data ingestion.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3 Data Protection | | | |
| v7 | 13 Data Protection | | | |

## Profile
Level 1 | Manual
