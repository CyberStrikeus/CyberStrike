---
name: cis-azure-compute-2.10
description: "Ensure App Service Environment has TLS cipher suite ordering configured"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service-environment, ase]
cis_id: "2.10"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure App Service Environment has TLS cipher suite ordering configured

## Description

App Service Environment supports changing the cipher suite from the default. The default set of ciphers is the same set that is used in the multi-tenant App Service. Changing the cipher suite is only possible with App Service Environment, the single-tenant offering, not the multi-tenant offering, because changing it affects the entire App Service deployment.

There are two cipher suites that are required for an App Service Environment: `TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384` and `TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256`. Additionally, you should include the following cipher suites, which are required for TLS 1.3: `TLS_AES_256_GCM_SHA384` and `TLS_AES_128_GCM_SHA256`.

## Rationale

Configuring your App Service Environment to use only the ciphers it requires helps to keep the environment secure.

## Impact

If incorrect values are set for the cipher suite that SChannel cannot understand, all TLS communication to your server might stop functioning.

## Audit Procedure

### Using Azure Portal

1. Go to `Resource Explorer`.
2. Locate an App Service Environment from the left pane.
3. Ensure the `clusterSettings` attribute includes:

```json
{
  "name": "FrontEndSSLCipherSuiteOrder",
  "value": "TLS_AES_256_GCM_SHA384,TLS_AES_128_GCM_SHA256,TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256"
}
```

4. Repeat steps 1-3 for each App Service Environment.

### Using Azure CLI

Run the following command to list App Service Environments:

```bash
az appservice ase list
```

For each App Service Environment, ensure that `clusterSettings` includes:

```json
{
  "name": "FrontEndSSLCipherSuiteOrder",
  "value": "TLS_AES_256_GCM_SHA384,TLS_AES_128_GCM_SHA256,TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256"
}
```

## Expected Result

The `clusterSettings` should include a `FrontEndSSLCipherSuiteOrder` entry with the appropriate strong cipher suites listed.

## Remediation

### Using Azure Portal

1. Go to `Resource Explorer`.
2. Locate an App Service Environment from the left pane.
3. In the right pane, click `Read/Write` to allow editing.
4. Click `Edit` to edit the resource.
5. Update the `clusterSettings` attribute to include:

```json
{
  "name": "FrontEndSSLCipherSuiteOrder",
  "value": "TLS_AES_256_GCM_SHA384,TLS_AES_128_GCM_SHA256,TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256"
}
```

6. Click `PUT` to commit the change.
7. Repeat steps 1-7 for each App Service Environment requiring remediation.

## Default Value

TLS cipher suite ordering is not configured by default.

## References

1. https://learn.microsoft.com/en-us/azure/app-service/environment/app-service-app-service-environment-custom-settings
2. https://learn.microsoft.com/en-us/cli/azure/appservice/ase

## Profile

Level 1 | Automated
