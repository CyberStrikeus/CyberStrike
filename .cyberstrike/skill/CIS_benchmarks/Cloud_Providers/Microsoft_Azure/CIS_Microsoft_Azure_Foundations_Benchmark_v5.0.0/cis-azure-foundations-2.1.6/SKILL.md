---
name: cis-azure-foundations-2.1.6
description: "Ensure usage is restricted and expiry is enforced for Databricks personal access tokens"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, databricks, analytics]
cis_id: "2.1.6"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-2.1.4]
prerequisites: []
severity_boost: {}
---

# Ensure usage is restricted and expiry is enforced for Databricks personal access tokens

## Description

Databricks personal access tokens (PATs) provide API-based authentication for users and applications. By default, users can generate API tokens without expiration, leading to potential security risks if tokens are leaked, improperly stored, or not rotated regularly.

To mitigate these risks, administrators should:

- Restrict token creation to approved users and service principals.
- Enforce expiration policies to prevent long-lived tokens.
- Monitor token usage and revoke unused or compromised tokens.

## Rationale

Restricting usage and enforcing expiry for personal access tokens reduces exposure to long-lived tokens, minimizes the risk of API abuse if compromised, and aligns with security best practices through controlled issuance and enforced expiry.

## Impact

If revoked improperly, applications relying on these tokens may fail, requiring a remediation plan for token rotation. Increased administrative effort is required to track and manage API tokens effectively.

## Audit Procedure

Azure Databricks administrators can monitor and revoke personal access tokens within their workspace. Detailed instructions are available in the "Monitor and Revoke Personal Access Tokens" section of the Microsoft documentation: https://learn.microsoft.com/en-us/azure/databricks/admin/access-control/tokens.

To evaluate the usage of personal access tokens in your Azure Databricks account, you can utilize the provided notebook that lists all PATs not rotated or updated in the last 90 days, allowing you to identify tokens that may require revocation. This process is detailed here: https://learn.microsoft.com/en-us/azure/databricks/admin/access-control/tokens.

Implementing diagnostic logging provides a comprehensive reference of audit log services and events, enabling you to track activities related to personal access tokens. More information can be found in the diagnostic log reference section: https://learn.microsoft.com/en-us/azure/databricks/admin/account-settings/audit-logs.

## Expected Result

Personal access tokens should either be disabled or have maximum lifetime policies enforced. Token creation should be restricted to approved users and service principals only. No tokens older than 90 days without rotation should exist.

## Remediation

### Remediate from Azure Portal

Disable personal access tokens:

If your workspace does not require PATs, you can disable them entirely to prevent their use.

1. Navigate to your Azure Databricks workspace.
2. Click the `Settings` icon and select `Admin Console`.
3. Go to the `Advanced` tab.
4. Under `Personal Access Tokens`, toggle the setting to `Disabled`.

Databricks CLI:

```bash
databricks workspace-conf set-status --json '{"enableTokens": "false"}'
```

Control who can create and use personal access tokens:

Define which users or groups are authorized to create and utilize PATs.

1. Navigate to your Azure Databricks workspace.
2. Click the `Settings` icon and select `Admin Console`.
3. Go to the `Advanced` tab.
4. Click on `Personal Access Tokens` and then `Permissions`.
5. Assign the appropriate permissions (e.g. No Permissions, Can Use, Can Manage) to users or groups.

Set maximum lifetime for new personal access tokens:

Limit the validity period of new tokens to reduce potential misuse.

Databricks CLI:

```bash
databricks workspace-conf set-status --json '{"maxTokenLifetimeDays": "90"}'
```

Monitor and revoke personal access tokens:

Periodically review active tokens and revoke any that are unnecessary or potentially compromised.

Databricks CLI:

```bash
databricks token list
databricks token delete --token-id <token-id>
```

Transition to OAuth for enhanced security:

Utilize OAuth tokens for authentication, offering improved security features over PATs.

## Default Value

By default, personal access tokens are enabled and users can create the Personal access token and their expiry time.

## References

1. https://learn.microsoft.com/en-us/azure/databricks/administration-guide/access-control/tokens
2. https://learn.microsoft.com/en-us/azure/databricks/dev-tools/auth/

## CIS Controls

| Controls Version | Control                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------ | ---- | ---- | ---- |
| v8               | 6.2 Establish an Access Revoking Process   | x    | x    | x    |
| v7               | 16.7 Establish Process for Revoking Access |      | x    | x    |

## Profile

Level 1 | Manual
