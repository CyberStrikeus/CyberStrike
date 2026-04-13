---
name: cis-azure-database-5.4
description: "Ensure Private Endpoints Are Used for Azure MySQL Databases"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, mysql, database]
cis_id: "5.4"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4 Ensure Private Endpoints Are Used for Azure MySQL Databases (Automated)

## Profile Applicability

- Level 2

## Description

Private links make resources available via a private endpoint to a network you select. Tunneling between subscriptions, resource groups, without the need for traditional network routing.

## Rationale

For sensitive data, private endpoints allow granular control of which services can communicate with Azure MySQL and ensure that this network traffic is private. This can be set this up on a case by case basis for each service to be connected.

## Impact

A private endpoint will expose your MySQL database to the network selected, where it can be accessed by either IP or FQDN.

## Audit

### Audit from Azure Portal

1. From `Azure Database for MySQL flexible servers` select a server to audit.
2. In the column expand `> Settings`.
3. Select `Networking`.
4. Scroll down to the bottom to determine if there are any private endpoints attached to the server.

## Expected Result

One or more private endpoints should be attached to the Azure Database for MySQL server under Settings > Networking.

## Remediation

### Remediate from Azure Portal

1. From `Azure Database for MySQL flexible servers` select a server to audit.
2. In the column expand `> Settings`.
3. Select `Networking`.
4. Scroll down to the bottom, and select `+ Create private endpoint`.
5. Select a subscription and resource group.
6. Enter an instance name, network interface name, and select the same region that your MySQL server is in.
7. Verify that the information on `Resource` is correct. Then select `Next`.
8. Select the virtual network, and subnet and select `Next`.
9. Choose whether to use a dynamic or static IP address and select `Next`.
10. Choose `Yes` or `No` on `Integrate with private DNS zone`.
11. If `Yes` then select the subscription and resource group, then select `Next`.
12. Enter any desired tags, then select `Next`.
13. Verify the information, then select `Create`.

## Default Value

Unless specified at resource creation, by default Azure MySQL does not have a private endpoint attached.

## References

1. https://learn.microsoft.com/en-us/azure/azure-sql/database/private-endpoint-overview?view=azuresql
2. https://learn.microsoft.com/en-us/azure/private-link/create-private-endpoint-powershell?tabs=dynamic-ip

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 12.2 Establish and Maintain a Secure Network Architecture | | X | X |
| v7 | 14.1 Segment the Network Based on Sensitivity | | X | X |
