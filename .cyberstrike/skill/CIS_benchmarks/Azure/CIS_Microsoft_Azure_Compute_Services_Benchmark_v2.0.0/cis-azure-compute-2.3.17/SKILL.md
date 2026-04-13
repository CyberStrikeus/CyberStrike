---
name: cis-azure-compute-2.3.17
description: "Ensure cross-origin resource sharing does not allow all origins"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, function-apps, cors, cross-origin, web-security, csrf]
cis_id: "2.3.17"
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

Setting up a proper CORS policy can be fairly complex and an incorrect setting could permit Cross-Site Request Forgery (CSRF). The "caveat" is that if the app being deployed is a PUBLIC API, a wildcard "*" CORS policy is absolutely necessary.

## Audit Procedure

### Using Azure Portal
1. Go to `App Service` or `Function App`.
2. Click the name of a function app.
3. Under `API`, click `CORS`.
4. Ensure `Allowed Origins` does not include `*`.
5. Repeat steps 1-4 for each function app.

### Using Azure CLI
Run the following command to list function apps:
```bash
az functionapp list
```

For each function app, run the following command to get the CORS allowed origins setting:
```bash
az functionapp show --resource-group <resource-group-name> --name <function-app-name> --query siteConfig.cors.allowedOrigins
```

Ensure that the response does not include `*`.

## Expected Result
The CORS allowed origins should not include a wildcard `*` entry.

## Remediation

### Using Azure Portal
1. Go to `App Service` or `Function App`.
2. Click the name of a function app.
3. Under `API`, click `CORS`.
4. Under `Allowed Origins`, delete the entry that equals `*`.
5. Specify the origins that should be allowed to make cross-origin calls.
6. Click `Save`.
7. Repeat steps 1-6 for each function app requiring remediation.

### Using Azure CLI
For each function app requiring remediation, run the following command to remove the wildcard origin:
```bash
az functionapp cors remove --resource-group <resource-group-name> --name <function-app-name> --allowed-origins "*"
```

Use the following command to specify the origins that should be allowed:
```bash
az functionapp cors add --resource-group <resource-group-name> --name <function-app-name> --allowed-origins <allowed-origins>
```

## Default Value
By default, `Allowed Origins` is set to `https://portal.azure.com`.

## References
1. https://learn.microsoft.com/en-gb/azure/app-service/app-service-web-tutorial-rest-api
2. https://learn.microsoft.com/en-us/cli/azure/functionapp/cors
3. https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html
4. https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
5. https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

## Profile
Level 2 | Automated
