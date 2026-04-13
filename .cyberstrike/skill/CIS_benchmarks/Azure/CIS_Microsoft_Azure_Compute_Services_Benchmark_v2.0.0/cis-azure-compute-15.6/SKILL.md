---
name: cis-azure-compute-15.6
description: "Ensure private DNS zones for private endpoints that connect to Batch accounts are configured"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, batch]
cis_id: "15.6"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure private DNS zones for private endpoints that connect to Batch accounts are configured

## Description

Private DNS zones for Azure Batch private endpoints provide secure internal name resolution, preventing public internet exposure. When a private endpoint is created for a Batch account, Azure requires a private DNS zone (privatelink..batch.azure.com) to map the Batch service's domain name to a private IP address within your virtual network (VNet).

## Rationale

To enable secure and private access to Azure Batch accounts, private DNS zones must be properly configured for private endpoints so as not to expose them publicly and allow for internal name resolution. Proper configuration of DNS provides assurance that DNS resolves to private IPs, reducing data exposure risk and support for security policy adherence. In the absence of proper DNS configuration, Batch services are open to connectivity failure, job interruption, or misconfigured public internet routing. Well-meshed private DNS zones hold traffic within the virtual network as intended, as a Zero Trust architecture and regulatory standard would dictate. Organizations need to audit and automate the configurations for secure and stable Batch processing.

## Impact

**NOTE:** This recommendation assumes that a Private DNS Zone already exists. If one has not yet been created for Batch accounts [e.g. privatelink.batch.azure.com], that must be completed before it can be assigned to a Batch account's Private Endpoint.

Network architecture must be carefully considered when deploying Private DNS Zones. DNS Zones should be used to associate like services. Private DNS zones should not be used to resolve public endpoints.

## Audit Procedure

### Using Azure Portal

1. Login to Azure portal `https://portal.azure.com`
2. Navigate to `Batch accounts` in the Azure portal

For each batch account perform the following:

1. Expand `Settings` then click on `Networking`
2. Click the `Private access` tab

If no Private endpoints exist, the configuration fails this audit procedure.

For each Private endpoint perform the following:

1. Click the name of the Private Endpoint
2. Expand `Settings` then click on `DNS Configuration`
3. Scroll to the bottom where a table of `Configuration entries` is found

Ensure that there is an entry populated in the `Private DNS Zone` column (e.g. `privatelink.batch.azure.com`).

## Expected Result

Each Private Endpoint connected to a Batch account should have a Private DNS Zone configured (e.g. `privatelink.batch.azure.com`) with valid DNS entries.

## Remediation

### Using Azure Portal

**NOTE:** This instruction assumes a Private Endpoint already exists for the Batch Account, and that a Private DNS Zone has already been created.

1. Login to Azure portal `https://portal.azure.com`
2. Navigate to `Batch accounts` in the Azure portal

For each batch account perform the following:

1. Expand `Settings` then click on `Networking`
2. Click the `Private access` tab

*[If no Private Endpoints exist, one must be created before proceeding. Instructions for configuring Private Endpoints on Batch Accounts can be found in the recommendation titled "Ensure to Configure Batch accounts with private endpoints"]*

For each Private endpoint perform the following:

1. Click the name of the Private Endpoint
2. Expand `Settings` then click on `DNS Configuration`
3. Click the `+ Add Configuration` button
4. Select each field appropriately (e.g. Private DNS zone "privatelink.batch.azure.com" - other zone names in additional information below) and enter a custom Configuration Name if desired
5. Click the `Add` button then allow a moment for deployment

Refresh the DNS Configuration page, then scroll down and ensure an entry exists (e.g. "privatelink.batch.azure.com") under the `Private DNS zone` column in the Configuration entry table.

## Default Value

Azure DNS zones are not configured by default.

## References

1. https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns
2. https://learn.microsoft.com/en-us/azure/batch/private-connectivity
3. Commercial Zone Names: https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns#compute
4. Government Zone Names: https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns#compute-1
5. China Zone Names: https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns#compute-2

## Profile

Level 2 | Manual
