---
name: cis-azure-compute-2.1.4
description: "Ensure 'Basic Authentication Publishing Credentials' are 'Disabled'"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, authentication, basic-auth, publishing-credentials, identity]
cis_id: "2.1.4"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'Basic Authentication Publishing Credentials' are 'Disabled'

## Description

Basic Authentication Publishing Credentials provides the ability to publish -- or deploy to -- an App Service app without a centralized Identity Provider. For a more effective, capable, and secure solution for Identity, Authentication, Authorization, and Accountability, a centralized Identity Provider such as Entra ID is strongly advised.

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

An Identity Provider that can be used by the App Service app for authenticating users is required.

## Audit Procedure

### Using Azure Portal

1. Search for, and open `App Services` from the search bar.
2. For each App Service listed:
3. Click on the App Service name.
4. Under the `Settings` menu item, click on `Configuration`
5. Under the `General settings` tab, scroll down to locate the two Basic Auth settings:
   - `SCM Basic Auth Publishing Credentials`
   - `FTP Basic Auth Publishing Credentials`

Both radio buttons should indicate a status of `Off`.
Repeat this procedure for each App Service.

### Using Azure CLI

Run the following command to list apps:

```
az webapp list
```

For each app, run the following command to get the basic authentication for FTP setting:

```
az resource show --resource-group <resource-group-name> --name ftp --namespace Microsoft.Web --resource-type basicPublishingCredentialsPolicies --parent sites/<app-name> --query properties.allow
```

Ensure that `false` is returned.

For each app, run the following command to get the basic authentication for SCM setting:

```
az resource show --resource-group <resource-group-name> --name scm --namespace Microsoft.Web --resource-type basicPublishingCredentialsPolicies --parent sites/<app-name> --query properties.allow
```

Ensure that `false` is returned.

### Using Azure PowerShell

Not specifically documented for this control.

## Expected Result

Both FTP and SCM basic authentication publishing credentials should return `false` (disabled).

## Remediation

### Using Azure Portal

1. Search for, and open `App Services` from the search bar.
2. For each App Service listed:
3. Click on the App Service name.
4. Under the `Settings` menu item, click on `Configuration`
5. Under the `General settings` tab, scroll down to locate the two Basic Auth settings:
   - Set the `SCM Basic Auth Publishing Credentials` radio button to `Off`
   - Set the `FTP Basic Auth Publishing Credentials` radio button to `Off`

**CAUTION:** The new settings are not yet applied. Applying them may cause your App Service resource to restart - proceed with caution. Click the `Save` button, then click `Continue` to apply the updated configuration.
Repeat this procedure for each App Service.

### Using Azure CLI

For each app requiring remediation, run the following command to disable basic authentication for FTP:

```
az resource update --resource-group <resource-group-name> --name ftp --namespace Microsoft.Web --resource-type basicPublishingCredentialsPolicies --parent sites/<app-name> --set properties.allow=false
```

For each app requiring remediation, run the following command to disable basic authentication for SCM:

```
az resource update --resource-group <resource-group-name> --name scm --namespace Microsoft.Web --resource-type basicPublishingCredentialsPolicies --parent sites/<app-name> --set properties.allow=false
```

### Using Azure PowerShell

Not specifically documented for this control.

## Default Value

Basic authentication is disabled by default.

## References

1. https://learn.microsoft.com/en-us/azure/app-service/configure-basic-auth-disable
2. https://learn.microsoft.com/en-us/cli/azure/webapp
3. https://learn.microsoft.com/en-us/cli/azure/resource

## Profile

Level 1 | Automated
