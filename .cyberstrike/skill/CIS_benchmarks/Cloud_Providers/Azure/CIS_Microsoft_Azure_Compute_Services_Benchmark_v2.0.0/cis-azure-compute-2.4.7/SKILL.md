---
name: cis-azure-compute-2.4.7
description: "Ensure 'Minimum Inbound TLS Version' is set to '1.2' or higher"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, functions, deployment-slots]
cis_id: "2.4.7"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'Minimum Inbound TLS Version' is set to '1.2' or higher

## Description

The TLS (Transport Layer Security) protocol secures the transmission of data over the internet using standard encryption technology. Function app deployment slots use TLS 1.2 for the `Minimum Inbound TLS Version` by default and allow for the use of TLS versions 1.0, 1.1, and 1.3. NIST strongly suggests the use of TLS 1.2 and recommends the adoption of TLS 1.3.

## Rationale

TLS 1.0 and 1.1 are outdated and vulnerable to security risks. Since TLS 1.2 and TLS 1.3 provide enhanced security and improved performance, it is highly recommended to use TLS 1.2 or higher whenever possible.

## Impact

Using the latest TLS version may affect compatibility with clients and backend services.

## Audit Procedure

### Using Azure Portal

1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Configuration`.
6. In the `General settings` pane, under `Platform settings`, ensure that `Minimum Inbound TLS Version` is set to `1.2` or higher.
7. Repeat steps 1-6 for each function app and deployment slot.

### Using Azure CLI

Run the following command to list function apps:

```bash
az functionapp list
```

For each function app, run the following command to list deployment slots:

```bash
az functionapp deployment slot list --resource-group <resource-group-name> --name <app-name>
```

For each deployment slot, run the following command to get the TLS version setting:

```bash
az resource show --name web --resource-group <resource-group-name> --namespace Microsoft.Web --resource-type config --parent sites/<function-app-name>/slots/<deployment-slot-name> --query properties.minTlsVersion
```

Ensure that `"1.2"` or higher is returned.

## Expected Result

The `minTlsVersion` property should return `"1.2"` or higher.

## Remediation

### Using Azure Portal

1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Configuration`.
6. In the `General settings` pane, under `Platform settings`, click the drop-down next to `Minimum Inbound TLS Version` and select `1.2` or higher.
7. Click `Save`.
8. Click `Continue`.
9. Repeat steps 1-8 for each function app and deployment slot requiring remediation.

### Using Azure CLI

For each deployment slot requiring remediation, run the following command to update the TLS version:

```bash
az resource update --name web --resource-group <resource-group-name> --namespace Microsoft.Web --resource-type config --parent sites/<function-app-name>/slots/<deployment-slot-name> --set properties.minTlsVersion=<1.2|1.3>
```

## Default Value

By default, TLS version is set to 1.2.

## References

1. https://learn.microsoft.com/en-us/azure/app-service/configure-ssl-bindings#how-can-i-change-the-minimum-tls-versions-for-the-app
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-data-protection#dp-3-encrypt-sensitive-data-in-transit
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-network-security#ns-8-detect-and-disable-insecure-services-and-protocols
4. https://learn.microsoft.com/en-us/cli/azure/functionapp
5. https://learn.microsoft.com/en-us/cli/azure/resource
6. https://csrc.nist.gov/news/2019/nist-publishes-sp-800-52-revision-2

## Profile

Level 1 | Automated
