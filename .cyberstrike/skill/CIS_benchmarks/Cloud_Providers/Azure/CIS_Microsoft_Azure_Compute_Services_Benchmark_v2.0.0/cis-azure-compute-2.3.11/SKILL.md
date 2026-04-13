---
name: cis-azure-compute-2.3.11
description: "Ensure 'App Service authentication' is set to 'Enabled'"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, function-apps, app-service-auth, authentication, identity]
cis_id: "2.3.11"
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

1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Settings`, click `Authentication`.
4. Ensure that `App Service authentication` is set to `Enabled`.
5. Repeat steps 1-4 for each function app.

### Using Azure CLI

Run the following command to list function apps:

```bash
az functionapp list
```

For each function app, run the following command to get the authentication setting:

For v1 auth commands:

```bash
az webapp auth show --resource-group <resource-group-name> --name <function-app-name> --query enabled
```

For v2 auth commands:

```bash
az webapp auth show --resource-group <resource-group-name> --name <function-app-name> --query properties.platform.enabled
```

Ensure that `true` is returned.

## Expected Result

App Service authentication should be `enabled` (return `true`).

## Remediation

### Using Azure Portal

1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Settings`, click `Authentication`.
4. If an identity provider is not configured:
   1. Click `Add identity provider`.
   2. Provide appropriate configuration for an identity provider and click `Add`.
5. If `App Service authentication` is set to `Disabled`:
   1. Click `Enable authentication`.
6. Repeat steps 1-5 for each function app requiring remediation.

### Using Azure CLI

For each function app requiring remediation, run the following command to enable authentication:

```bash
az webapp auth update --resource-group <resource-group-name> --name <function-app-name> --enabled true
```

**Note:** In order to access `App Service authentication` settings for an app using the Microsoft API, the `Website Contributor` permission at the subscription level is required. A custom role can be created instead of `Website Contributor` to provide more specific permissions and maintain the principle of least privileged access.

## Default Value

By default, `App Service authentication` is set to `Disabled`.

## Additional Information

You're not required to use App Service for authentication and authorization. Many web frameworks come with security features built in, and you can use them if you like. If you need more flexibility than App Service provides, you can also write your own utilities. Secure authentication and authorization require a deep understanding of security, including federation, encryption, JSON Web Token (JWT) management, grant types, and so on.

## References

1. https://learn.microsoft.com/en-us/azure/app-service/overview-authentication-authorization
2. https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles#website-contributor
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-3-manage-lifecycle-of-identities-and-entitlements
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-6-define-and-implement-identity-and-privileged-access-strategy
5. https://learn.microsoft.com/en-us/cli/azure/webapp/auth

## Profile

Level 2 | Automated
