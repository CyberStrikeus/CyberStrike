---
name: cis-gcp-foundations-2.1
description: "Ensure That Cloud Audit Logging Is Configured Properly"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, logging, monitoring, cloud-audit, data-access]
cis_id: "2.1"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure That Cloud Audit Logging Is Configured Properly (Automated)

## Description

It is recommended that Cloud Audit Logging is configured to track all admin activities and read, write access to user data.

## Rationale

Cloud Audit Logging maintains two audit logs for each project, folder, and organization: Admin Activity and Data Access.

1. Admin Activity logs contain log entries for API calls or other administrative actions that modify the configuration or metadata of resources. Admin Activity audit logs are enabled for all services and cannot be configured.
2. Data Access audit logs record API calls that create, modify, or read user-provided data. These are disabled by default and should be enabled.

There are three kinds of Data Access audit log information:

- Admin read: Records operations that read metadata or configuration information. Admin Activity audit logs record writes of metadata and configuration information that cannot be disabled.
- Data read: Records operations that read user-provided data.
- Data write: Records operations that write user-provided data.

It is recommended to have an effective default audit config configured in such a way that:

1. logtype is set to DATA_READ (to log user activity tracking) and DATA_WRITES (to log changes/tampering to user data).
2. audit config is enabled for all the services supported by the Data Access audit logs feature.
3. Logs should be captured for all users, i.e., there are no exempted users in any of the audit config sections. This will ensure overriding the audit config will not contradict the requirement.

## Impact

There is no charge for Admin Activity audit logs. Enabling the Data Access audit logs might result in your project being charged for the additional logs usage.

## Audit Procedure

### Using Google Cloud Console

1. Go to `Audit Logs` by visiting https://console.cloud.google.com/iam-admin/audit.
2. Ensure that Admin Read, Data Write, and Data Read are enabled for all Google Cloud services and that no exemptions are allowed.

### Using Google Cloud CLI

1. List the Identity and Access Management (IAM) policies for the project, folder, or organization:

```bash
gcloud organizations get-iam-policy ORGANIZATION_ID
gcloud resource-manager folders get-iam-policy FOLDER_ID
gcloud projects get-iam-policy PROJECT_ID
```

2. Policy should have a default `auditConfigs` section which has the logtype set to `DATA_WRITES` and `DATA_READ` for all services. Note that projects inherit settings from folders, which in turn inherit settings from the organization. When called, `projects get-iam-policy`, the result shows only the policies set in the project, not the policies inherited from the parent folder or organization. Nevertheless, if the parent folder has Cloud Audit Logging enabled, the project does as well.

### Expected Result

Sample output for default audit configs may look like this:

```
auditConfigs:
- auditLogConfigs:
  - logType: ADMIN_READ
  - logType: DATA_WRITE
  - logType: DATA_READ
    service: allServices
```

3. Any of the `auditConfigs` sections should not have parameter `exemptedMembers:` set, which will ensure that Logging is enabled for all users and no user is exempted.

## Remediation

### Using Google Cloud Console

1. Go to `Audit Logs` by visiting https://console.cloud.google.com/iam-admin/audit.
2. Follow the steps at https://cloud.google.com/logging/docs/audit/configure-data-access to enable audit logs for all Google Cloud services. Ensure that no exemptions are allowed.

### Using Google Cloud CLI

1. To read the project's IAM policy and store it in a file run a command:

```bash
gcloud projects get-iam-policy PROJECT_ID > /tmp/project_policy.yaml
```

Alternatively, the policy can be set at the organization or folder level. If setting the policy at the organization level, it is not necessary to also set it for each folder or project.

```bash
gcloud organizations get-iam-policy ORGANIZATION_ID > /tmp/org_policy.yaml
gcloud resource-manager folders get-iam-policy FOLDER_ID > /tmp/folder_policy.yaml
```

2. Edit policy in /tmp/policy.yaml, adding or changing only the audit logs configuration to:

Note: Admin Activity Logs are enabled by default, and cannot be disabled. So they are not listed in these configuration changes.

```yaml
auditConfigs:
  - auditLogConfigs:
      - logType: DATA_WRITE
      - logType: DATA_READ
    service: allServices
```

Note: `exemptedMembers:` is not set as audit logging should be enabled for all the users.

3. To write new IAM policy run command:

```bash
gcloud organizations set-iam-policy ORGANIZATION_ID /tmp/org_policy.yaml
gcloud resource-manager folders set-iam-policy FOLDER_ID /tmp/folder_policy.yaml
gcloud projects set-iam-policy PROJECT_ID /tmp/project_policy.yaml
```

If the preceding command reports a conflict with another change, then repeat these steps, starting with the first step.

## Default Value

Admin Activity logs are always enabled. They cannot be disabled. Data Access audit logs are disabled by default because they can be quite large.

## References

1. https://cloud.google.com/logging/docs/audit/
2. https://cloud.google.com/logging/docs/audit/configure-data-access

## Additional Information

- Log type `DATA_READ` is equally important to that of `DATA_WRITE` to track detailed user activities.
- BigQuery Data Access logs are handled differently from other data access logs. BigQuery logs are enabled by default and cannot be disabled. They do not count against logs allotment and cannot result in extra logs charges.

## CIS Controls

| Controls Version | Control                        | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------ | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs         | x    | x    | x    |
| v8               | 8.11 Conduct Audit Log Reviews |      | x    | x    |
| v7               | 6.2 Activate audit logging     | x    | x    | x    |
| v7               | 6.7 Regularly Review Logs      |      | x    | x    |

## Profile

Level 1
