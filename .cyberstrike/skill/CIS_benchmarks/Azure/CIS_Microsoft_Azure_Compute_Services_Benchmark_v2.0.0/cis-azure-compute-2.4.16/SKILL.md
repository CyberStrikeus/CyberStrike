---
name: cis-azure-compute-2.4.16
description: "Ensure cross-origin resource sharing does not allow all origins"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, functions, deployment-slots]
cis_id: "2.4.16"
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

This recommendation applies to function apps using the Consumption, Premium, or Dedicated (App Service) plans, which support deployment slots.

## Rationale

Restrict CORS to only trusted origins to help enforce proper access control and reduce exposure to malicious cross-origin requests.

## Impact

Configuration is required to ensure that the appropriate origins have access.

Setting up a proper CORS policy can be fairly complex and an incorrect setting could permit Cross-Site Request Forgery (CSRF). The "caveat" is that if the app being deployed is a PUBLIC API, a wildcard "\*" CORS policy is absolutely necessary.

## Audit Procedure

### Using Azure Portal

1. Go to `App Service` or `Function App`.
2. Click the name of a function app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of deployment slot.
5. Under `API`, click `CORS`.
6. Ensure `Allowed Origins` does not include `*`.
7. Repeat steps 1-6 for each function app and deployment slot.

### Using Azure CLI

Run the following command to list function apps:

```bash
az functionapp list
```

For each function app, run the following command to list deployment slots:

```bash
az functionapp deployment slot list --resource-group <resource-group-name> --name <function-app-name>
```

For each deployment slot, run the following command to get the CORS allowed origins setting:

```bash
az resource show --name web --resource-group <resource-group-name> --namespace Microsoft.Web --resource-type config --parent sites/<function-app-name>/slots/<deployment-slot-name> --query properties.cors.allowedOrigins
```

Ensure that the response does not include `*`.

## Expected Result

The `allowedOrigins` array should not contain `*` (wildcard).

## Remediation

### Using Azure Portal

1. Go to `App Service` or `Function App`.
2. Click the name of a function app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of deployment slot.
5. Under `API`, click `CORS`.
6. Under `Allowed Origins`, delete the entry that equals `*`.
7. Specify the origins that should be allowed to make cross-origin calls.
8. Click `Save`.
9. Repeat steps 1-8 for each function app and deployment slot requiring remediation.

### Using Azure CLI

For each deployment slot requiring remediation, run the following command to update the allowed origins array to contain only the origins that should be allowed:

```bash
az resource update --name web --resource-group <resource-group-name> --namespace Microsoft.Web --resource-type config --parent sites/<function-app-name>/slots/<deployment-slot-name> --set properties.cors.allowedOrigins="['<allowed-origin>']"
```

## Default Value

By default, `Allowed Origins` is set to `https://portal.azure.com`.

## References

1. https://learn.microsoft.com/en-gb/azure/app-service/app-service-web-tutorial-rest-api
2. https://learn.microsoft.com/en-us/cli/azure/functionapp
3. https://learn.microsoft.com/en-us/cli/azure/resource
4. https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html
5. https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
6. https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

## Profile

Level 2 | Automated
