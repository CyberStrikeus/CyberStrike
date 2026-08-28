---
name: cis-azure-compute-2.1.21
description: "Ensure cross-origin resource sharing does not allow all origins"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, cors, cross-origin, web-security, csrf]
cis_id: "2.1.21"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure cross-origin resource sharing does not allow all origins

## Description

Cross-origin resource sharing (CORS) is a security feature that controls how applications interact with resources hosted on different domains.

## Rationale

Restrict CORS to only trusted origins to help enforce proper access control and reduce exposure to malicious cross-origin requests.

## Impact

Configuration is required to ensure that the appropriate origins have access.

Setting up a proper CORS policy can be fairly complex and an incorrect setting could permit Cross-Site Request Forgery (CSRF). The "caveat" is that if the app being deployed is a PUBLIC API, a wildcard "\*" CORS policy is absolutely necessary.

## Audit Procedure

### Using Azure Portal

1. Go to `App Service`.
2. Click the name of an app.
3. Under `API`, click `CORS`.
4. Ensure `Allowed Origins` does not include `*`.
5. Repeat steps 1-4 for each app.

### Using Azure CLI

Run the following command to list apps:

```
az webapp list
```

For each app, run the following command to get the CORS allowed origins setting:

```
az webapp show --resource-group <resource-group-name> --name <app-name> --query siteConfig.cors.allowedOrigins
```

Ensure that the response does not include `*`.

### Using Azure PowerShell

Run the following command to list apps:

```
Get-AzWebApp
```

Run the following command to get the app in a resource group with a given name:

```
$app = Get-AzWebapp -ResourceGroupName <resource-group-name> -Name <app-name>
```

Run the following command to get the CORS allowed origins setting:

```
$app.SiteConfig.Cors.AllowedOrigins
```

Ensure that the response does not include `*`. Repeat for each app.

## Expected Result

The CORS allowed origins should not include a wildcard `*` entry.

## Remediation

### Using Azure Portal

1. Go to `App Service`.
2. Click the name of an app.
3. Under `API`, click `CORS`.
4. Under `Allowed Origins`, delete the entry that equals `*`.
5. Specify the origins that should be allowed to make cross-origin calls.
6. Click `Save`.
7. Repeat steps 1-6 for each app requiring remediation.

### Using Azure CLI

For each app requiring remediation, run the following command:

```
az webapp cors remove --resource-group <resource-group-name> --name <app-name> --allowed-origins "*"
```

Use the following command to specify the origins that should be allowed:

```
az webapp cors add --resource-group <resource-group-name> --name <app-name> --allowed-origins <allowed-origins>
```

### Using Azure PowerShell

Not specifically documented for this control.

## Default Value

By default, CORS is not configured.

## References

1. https://learn.microsoft.com/en-gb/azure/app-service/app-service-web-tutorial-rest-api
2. https://learn.microsoft.com/en-us/cli/azure/webapp/cors
3. https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html
4. https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
5. https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

## Profile

Level 2 | Automated
