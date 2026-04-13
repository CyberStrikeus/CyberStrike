---
name: cis-azure-compute-2.1.12
description: "Ensure 'App Service authentication' is set to 'Enabled'"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, authentication, identity, access-control]
cis_id: "2.1.12"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'App Service authentication' is set to 'Enabled'

## Description
App Service authentication can prevent anonymous HTTP requests from reaching an app, or authenticate those with tokens before they reach the app. If an anonymous request is received from a browser, App Service will redirect to a login page. To handle the login process, a choice from a set of identity providers can be made, or a custom authentication mechanism can be implemented.

## Rationale
By enabling authentication, every incoming HTTP request passes through it before being handled by the application code. It also handles authentication of users with the specified provider (Entra ID, Facebook, Google, Microsoft Account, and Twitter), validation, storage and refreshing of tokens, managing the authenticated sessions, and injecting identity information into request headers.

## Impact
This is only required for apps that require authentication. Enabling it on a site like a marketing or support website will prevent unauthenticated access, which would be undesirable.

Adding an authentication requirement will increase costs and require additional security components to facilitate the authentication.

## Audit Procedure

### Using Azure Portal
1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Authentication`.
4. Ensure that `App Service authentication` is set to `Enabled`.
5. Repeat steps 1-4 for each app.

### Using Azure CLI
Run the following command to list apps:
```
az webapp list
```

For each app, run the following command to get the authentication setting:

For v1 auth commands:
```
az webapp auth show --resource-group <resource-group-name> --name <app-name> --query enabled
```

For v2 auth commands:
```
az webapp auth show --resource-group <resource-group-name> --name <app-name> --query properties.platform.enabled
```

Ensure that `true` is returned.

### Using Azure PowerShell
Not specifically documented for this control.

## Expected Result
App Service authentication should be enabled (`true`).

## Remediation

### Using Azure Portal
1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Authentication`.
4. If an identity provider is not configured:
   1. Click `Add identity provider`.
   2. Provide appropriate configuration for an identity provider and click `Add`.
5. If `App Service authentication` is set to `Disabled`:
   1. Click `Enable authentication`.
6. Repeat steps 1-5 for each app requiring remediation.

### Using Azure CLI
For each app requiring remediation, run the following command to enable authentication:
```
az webapp auth update --resource-group <resource-group-name> --name <app-name> --enabled true
```

**Note**: In order to access `App Service authentication` settings for an app using the Microsoft API, the `Website Contributor` permission at the subscription level is required. A custom role can be created instead of `Website Contributor` to provide more specific permissions and maintain the principle of least privilege access.

### Using Azure PowerShell
Not specifically documented for this control.

## Default Value
By default, `App Service authentication` is set to `Disabled`.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/overview-authentication-authorization
2. https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles#website-contributor
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-3-manage-lifecycle-of-identities-and-entitlements
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-6-define-and-implement-identity-and-privileged-access-strategy
5. https://learn.microsoft.com/en-us/cli/azure/webapp/auth

## Profile
Level 2 | Automated
