---
name: cis-azure-compute-2.1.17
description: "Ensure private endpoints used to access App Service apps use private DNS zones"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, private-endpoint, private-dns, dns, network-security]
cis_id: "2.1.17"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure private endpoints used to access App Service apps use private DNS zones

## Description
Use private DNS zones to override DNS resolution for a private endpoint. A private DNS zone links a virtual network to an App Service app.

This recommendation assumes application of, and should be applied in conjunction with, the recommendation titled "Ensure private endpoints are used to access App Service apps."

## Rationale
It's important to correctly configure DNS settings to ensure that the fully qualified domain name (FQDN) of the App Service app resolves to the private endpoint IP address.

## Impact
Incorrectly configured DNS settings may result in unintentional exposure of traffic to the public internet.

## Audit Procedure

### Using Azure Portal
1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Networking`.
4. Under `Inbound traffic configuration`, click the link next to `Private endpoints`.
5. Click the name of a private endpoint.
6. Under `Settings`, click `DNS configuration`.
7. Ensure a configuration is displayed with a value for `Private DNS zone`.
8. Repeat steps 1-7 for each app and private endpoint.

### Using Azure CLI
Not specifically documented for this control.

### Using Azure PowerShell
Not specifically documented for this control.

## Expected Result
Each private endpoint should have a private DNS zone configured.

## Remediation

### Using Azure Portal
1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Networking`.
4. Under `Inbound traffic configuration`, click the link next to `Private endpoints`.
5. Click the name of a private endpoint.
6. Under `Settings`, click `DNS configuration`.
7. Click `+ Add configuration`.
8. Select a `Subscription`, `Private DNS zone`, and provide a `DNS zone group` and `Configuration name`.
9. Click `Add`.
10. Repeat steps 1-9 for each app and private endpoint requiring remediation.

### Using Azure CLI
Not specifically documented for this control.

### Using Azure PowerShell
Not specifically documented for this control.

## Default Value
Not configured by default.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/overview-private-endpoint#dns
2. https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns

## Profile
Level 2 | Manual
