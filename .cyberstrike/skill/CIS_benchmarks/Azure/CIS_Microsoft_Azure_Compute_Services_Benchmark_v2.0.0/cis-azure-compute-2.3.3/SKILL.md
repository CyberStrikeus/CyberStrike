---
name: cis-azure-compute-2.3.3
description: "Ensure 'Basic Authentication Publishing Credentials' are 'Disabled'"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, function-apps, basic-auth, publishing-credentials, authentication]
cis_id: "2.3.3"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'Basic Authentication Publishing Credentials' are 'Disabled'

## Description
Basic Authentication Publishing Credentials provides the ability to publish -- or deploy to -- a function app without a centralized Identity Provider. For a more effective, capable, and secure solution for Identity, Authentication, Authorization, and Accountability, a centralized Identity Provider such as Entra ID is strongly advised.

## Rationale
Basic Authentication introduces an identity silo for privileged access to a resource and produces logging which may not provide a full chain of accountability. This can be exploited in numerous ways and represents a significant vulnerability and attack vector.

## Impact
Disabling 'Basic Auth Publishing Credentials' will prevent the following deployment methods from working:

FTP Basic Auth Publishing Credentials:
- FTP
- FTPS

SCM Basic Auth Publishing Credentials:
- Local Git
- GitHub
- Azure Repos
- Bitbucket
- Visual Studio (Version 17.12 and earlier)

If this recommendation cannot be implemented because one of the above listed deployment methods is necessary and cannot be adapted, compensating controls (e.g. using FTPS Only and disabling only "SCM Basic Auth Publishing Credentials") are recommended to reduce potential attack surface.

An Identity Provider that can be used by the function app for authenticating users is required.

## Audit Procedure

### Using Azure Portal
1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` pane, under `Platform settings`, ensure that `SCM Basic Auth Publishing Credentials` and `FTP Basic Auth Publishing Credentials` are set to `Off`.
5. Repeat steps 1-4 for each function app.

### Using Azure CLI
Run the following command to list function apps:
```bash
az functionapp list
```

For each function app, run the following command to get the basic authentication for FTP setting:
```bash
az resource show --resource-group <resource-group-name> --name ftp --namespace Microsoft.Web --resource-type basicPublishingCredentialsPolicies --parent sites/<function-app-name> --query properties.allow
```

Ensure that `false` is returned.

For each function app, run the following command to get the basic authentication for SCM setting:
```bash
az resource show --resource-group <resource-group-name> --name scm --namespace Microsoft.Web --resource-type basicPublishingCredentialsPolicies --parent sites/<function-app-name> --query properties.allow
```

Ensure that `false` is returned.

## Expected Result
Both FTP and SCM basic authentication publishing credentials should return `false`.

## Remediation

**CAUTION:** Applying changes may cause your function app to restart.

### Using Azure Portal
1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` pane, under `Platform settings`, set `SCM Basic Auth Publishing Credentials` and `FTP Basic Auth Publishing Credentials` to `Off`.
5. Click `Save`.
6. Click `Continue`.
7. Repeat steps 1-6 for each function app requiring remediation.

### Using Azure CLI
For each function app requiring remediation, run the following command to disable basic authentication for FTP:
```bash
az resource update --resource-group <resource-group-name> --name ftp --namespace Microsoft.Web --resource-type basicPublishingCredentialsPolicies --parent sites/<function-app-name> --set properties.allow=false
```

For each function app requiring remediation, run the following command to disable basic authentication for SCM:
```bash
az resource update --resource-group <resource-group-name> --name scm --namespace Microsoft.Web --resource-type basicPublishingCredentialsPolicies --parent sites/<function-app-name> --set properties.allow=false
```

## Default Value
Basic authentication is disabled by default.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/configure-basic-auth-disable
2. https://learn.microsoft.com/en-us/cli/azure/functionapp
3. https://learn.microsoft.com/en-us/cli/azure/resource

## Profile
Level 1 | Automated
