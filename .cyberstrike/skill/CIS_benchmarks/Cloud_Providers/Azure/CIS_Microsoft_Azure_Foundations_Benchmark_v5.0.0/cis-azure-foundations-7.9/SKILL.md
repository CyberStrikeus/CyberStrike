---
name: cis-azure-foundations-7.9
description: "Ensure 'Authentication type' is set to 'Azure Active Directory' only for Azure VPN Gateway point-to-site"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, networking, vpn]
cis_id: "7.9"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'Authentication type' is set to 'Azure Active Directory' only for Azure VPN Gateway point-to-site configuration

## Description

Enable only 'Azure Active Directory' (Microsoft Entra ID) authentication for Azure VPN Gateway point-to-site connections.

## Rationale

Microsoft Entra ID authentication provides strong security and centralized identity management, and reduces risks associated with static credentials and certificate management.

## Impact

Azure VPN Gateways incur hourly charges, with additional costs for point-to-site connections and data transfer. Pricing varies by SKU and usage. Refer to https://azure.microsoft.com/en-us/pricing/details/vpn-gateway/ for details.

## Audit Procedure

### Using Azure Portal

1. Go to `Virtual network gateways`.
2. Under `VPN gateway`, click `VPN gateways`.
3. Click the name of a VPN gateway.
4. Under `Settings`, click `Point-to-site configuration`.
5. Ensure `Authentication type` is set to `Azure Active Directory` only.
6. Repeat steps 1-5 for each VPN gateway.

### Using Azure Policy

- **Policy ID:** 21a6bc25-125e-4d13-b82d-2e19b7208ab7 - **Name:** 'VPN gateways should use only Azure Active Directory (Azure AD) authentication for point-to-site users'

## Expected Result

All Azure VPN Gateway point-to-site configurations should have `Authentication type` set to `Azure Active Directory` only, with no other authentication methods (Azure certificate, RADIUS) enabled.

## Remediation

### Remediate from Azure Portal

1. Go to `Virtual network gateways`.
2. Under `VPN gateway`, click `VPN gateways`.
3. Click the name of a VPN gateway.
4. Under `Settings`, click `Point-to-site configuration`.
5. Ensure `Authentication type` click to expand the drop-down menu.
6. Check the box next to `Azure Active Directory`, and uncheck the boxes next to `Azure certificate` and `RADIUS authentication`.
7. Provide a `Tenant`, `Audience`, and `Issuer` for the `Azure Active Directory` configuration.
8. Click `Save`.
9. Repeat steps 1-8 for each VPN gateway requiring remediation.

## Default Value

'Authentication type' is selected during creation of point-to-site configuration.

## References

1. https://learn.microsoft.com/en-us/azure/vpn-gateway/vpn-gateway-about-vpngateways
2. https://learn.microsoft.com/en-us/azure/vpn-gateway/point-to-site-entra-gateway
3. https://learn.microsoft.com/en-us/azure/vpn-gateway/openvpn-azure-ad-tenant

## CIS Controls

| Controls Version | Control                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.6 Centralize Account Management                  |      | x    | x    |
| v7               | 16.2 Configure Centralized Point of Authentication |      | x    | x    |

## Profile

Level 2 | Manual
