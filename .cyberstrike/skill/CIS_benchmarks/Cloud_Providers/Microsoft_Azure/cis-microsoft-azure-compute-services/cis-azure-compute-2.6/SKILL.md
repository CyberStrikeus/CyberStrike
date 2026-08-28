---
name: cis-azure-compute-2.6
description: "Ensure App Service Environment is deployed with an internal load balancer"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service-environment, ase]
cis_id: "2.6"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure App Service Environment is deployed with an internal load balancer

## Description

App Service Environment apps should not be reachable over public internet. To ensure apps deployed in an App Service Environment are not accessible over public internet, one should deploy App Service Environment with an IP address in virtual network. To set the IP address to a virtual network IP, the App Service Environment must be deployed with an internal load balancer.

## Rationale

Disabling public network access improves security by ensuring that a service is not exposed on the public internet.

## Impact

Disabling public network access restricts access to the service. This enhances security but may require the configuration of private endpoints for any services or users needing access within trusted networks.

## Audit Procedure

### Using Azure Portal

1. Go to `App Service Environments`.
2. For each App Service Environment, ensure that `Virtual IP Type` is set to `Internal`.

### Using Azure CLI

Run the following command to list App Service Environments:

```bash
az appservice ase list
```

For each App Service Environment, ensure that `internalLoadBalancingMode` is not set to `None`.

## Expected Result

The `internalLoadBalancingMode` should not be set to `None`. The `Virtual IP Type` should be `Internal`.

## Remediation

It is not possible to change the virtual IP configuration of a deployed App Service Environment.

When deploying an App Service Environment, next to `Virtual IP`, select `Internal: The endpoint is an internal load balancer (ILB ASE)`.

## Default Value

When deploying an App Service Environment, `Internal: The endpoint is an internal load balancer (ILB ASE)` is the default selected option for `Virtual IP`.

## References

1. https://learn.microsoft.com/en-us/azure/app-service/environment/creation

## Profile

Level 2 | Automated
