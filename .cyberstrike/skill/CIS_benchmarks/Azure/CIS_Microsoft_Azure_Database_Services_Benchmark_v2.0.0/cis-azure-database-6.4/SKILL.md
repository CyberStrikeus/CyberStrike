---
name: cis-azure-database-6.4
description: "Ensure Private Endpoints Are Used for Azure Database for PostgreSQL"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, postgresql, database]
cis_id: "6.4"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.4 Ensure Private Endpoints Are Used for Azure Database for PostgreSQL (Automated)

## Profile Applicability

- Level 2

## Description

Private links make resources available via a private endpoint to a network you select. Tunneling between subscriptions, resource groups, without the need for traditional network routing.

## Rationale

For sensitive data, private endpoints allow granular control of which services can communicate with PostgreSQL Servers and ensure that this network traffic is private. This can be set this up on a case by case basis for each service to be connected.

## Impact

A private endpoint will expose your PostgreSQL database to the network selected, where it can be accessed by either IP or FQDN.

## Audit Procedure

### Audit from Azure Portal

1. From `Azure Database for PostgreSQL servers` select a server to audit.
2. In the column expand `> Settings`.
3. Select `Networking`.
4. Scroll down to the bottom to determine if there are any private endpoints attached to the server.

### Audit from Azure Policy

Policy ID: `5375a5bb-22c6-46d7-8a43-83417cfb4460`
Name: 'Private endpoint should be enabled for PostgreSQL flexible servers'

## Expected Result

At least one private endpoint should be attached to the PostgreSQL server.

## Remediation

### Remediate from Azure Portal

1. From `Azure Database for PostgreSQL flexible servers` select a server to audit.
2. In the column expand `> Settings`.
3. Select `Networking`.
4. Scroll down to the bottom, and select `+ Create private endpoint`.
5. Select a subscription and resource group.
6. Enter an instance name, network interface name, and select the same region that your PostgreSQL server is in.
7. Verify that the information on `Resource` is correct. Then select `Next`.
8. Select the virtual network, and subnet and select `Next`.
9. Choose whether to use a dynamic or static IP address and select `Next`.
10. Choose `Yes` or `No` on `Integreate with private DNS zone`.
11. If `Yes` then select the subscription and resource group, then select `Next`.
12. Enter any desired tags, then select `Next`.
13. Verify the information, then select `Create`.

## Default Value

Unless specified at resource creation, by default Azure Database for PostgreSQL does not have a private endpoint attached.

## References

1. https://learn.microsoft.com/en-us/azure/postgresql/network/concepts-networking-private-link

## Profile

- Level 2
