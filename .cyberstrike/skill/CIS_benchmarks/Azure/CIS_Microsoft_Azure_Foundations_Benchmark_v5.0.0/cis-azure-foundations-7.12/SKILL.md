---
name: cis-azure-foundations-7.12
description: "Ensure the SSL policy's 'Min protocol version' is set to 'TLSv1_2' or higher on Azure Application Gateway"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, networking, application-gateway]
cis_id: "7.12"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-7.10, cis-azure-foundations-7.13]
prerequisites: []
severity_boost: {}
---

# Ensure the SSL policy's 'Min protocol version' is set to 'TLSv1_2' or higher on Azure Application Gateway

## Description

The TLS (Transport Layer Security) protocol secures the transmission of data over the internet using standard encryption technology. Application gateways use TLS 1.2 for the `Min protocol version` by default and allow for the use of TLS versions 1.0, 1.1, and 1.3. NIST strongly suggests the use of TLS 1.2 and recommends the adoption of TLS 1.3.

## Rationale

TLS 1.0 and 1.1 are outdated and vulnerable to security risks. Since TLS 1.2 and TLS 1.3 provide enhanced security and improved performance, it is highly recommended to use TLS 1.2 or higher whenever possible.

## Impact

Using the latest TLS version may affect compatibility with clients and backend services.

## Audit Procedure

### Using Azure Portal

1. Go to `Application gateways`.
2. Click the name of an application gateway.
3. Under `Settings`, click `Listeners`.
4. Under `SSL Policy`, ensure `Min protocol version` is set to `TLSv1_2` or higher.
5. Repeat steps 1-4 for each application gateway.

### Using Azure CLI

Run the following command to list application gateways:

```bash
az network application-gateway list
```

For each application gateway, run the following command to get the SSL policy:

```bash
az network application-gateway ssl-policy show --resource-group <resource-group> --gateway-name <application-gateway>
```

For each SSL policy, run the following command to get the `minProtocolVersion`:

```bash
az network application-gateway ssl-policy predefined show --name <ssl-policy> --query minProtocolVersion
```

Ensure `"TLSv1_2"` or higher is returned.

## Expected Result

All Application Gateways should have `Min protocol version` set to `TLSv1_2` or higher in their SSL policy configuration.

## Remediation

### Remediate from Azure Portal

1. Go to `Application gateways`.
2. Click the name of an application gateway.
3. Under `Settings`, click `Listeners`.
4. Under `SSL Policy`, next to the `Selected SSL Policy` name, click `change`.
5. Select an appropriate SSL policy with a `Min protocol version` of `TLSv1_2` or higher.
6. Click `Save`.
7. Repeat steps 1-6 for each application gateway requiring remediation.

### Remediate from Azure CLI

Run the following command to list available SSL policy options:

```bash
az network application-gateway ssl-policy list-options
```

Run the following command to list available predefined SSL policies:

```bash
az network application-gateway ssl-policy predefined list
```

For each application gateway requiring remediation, run the following command to set a predefined SSL policy:

```bash
az network application-gateway ssl-policy set --resource-group <resource-group> --gateway-name <application-gateway> --name <ssl-policy> --policy-type Predefined
```

Alternatively, run the following command to set a custom SSL policy:

```bash
az network application-gateway ssl-policy set --resource-group <resource-group> --gateway-name <application-gateway> --policy-type Custom --min-protocol-version <min-protocol-version> --cipher-suites <cipher-suites>
```

## Default Value

`Min protocol version` is set to `TLSv1_2` by default.

## References

1. https://learn.microsoft.com/en-us/azure/application-gateway/application-gateway-ssl-policy-overview
2. https://learn.microsoft.com/en-us/cli/azure/network/application-gateway

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
| ---------------- | ------- | ---- | ---- | ---- |
| v8 | 3.10 Encrypt Sensitive Data in Transit | | x | x |
| v7 | 14.4 Encrypt All Sensitive Information in Transit | | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1040 | TA0007 | M1041 |

## Profile

Level 1 | Automated
