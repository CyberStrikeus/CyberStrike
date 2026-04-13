---
name: cis-gcp-foundations-1.5
description: "Ensure That Service Account Has No Admin Privileges"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, iam, service-accounts, mfa, kms, api-keys]
cis_id: "1.5"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.5 Ensure That Service Account Has No Admin Privileges (Automated)

## Profile Applicability

- Level 1

## Description

A service account is a special Google account that belongs to an application or a VM, instead of to an individual end-user. The application uses the service account to call the service's Google API so that users aren't directly involved. It's recommended not to use admin access for ServiceAccount.

## Rationale

Service accounts represent service-level security of the Resources (application or a VM) which can be determined by the roles assigned to it. Enrolling ServiceAccount with Admin rights gives full access to an assigned application or a VM. A ServiceAccount Access holder can perform critical actions like delete, update change settings, etc. without user intervention. For this reason, it's recommended that service accounts not have Admin rights.

## Impact

Removing `*Admin` or `*admin` or `Editor` or `Owner` role assignments from service accounts may break functionality that uses impacted service accounts. Required role(s) should be assigned to impacted service accounts in order to restore broken functionalities.

## Audit Procedure

**From Google Cloud Console**

1. Go to `IAM & admin/IAM` using `https://console.cloud.google.com/iam-admin/iam`
2. Under the `IAM` Tab look for `VIEW BY PRINCIPALS`
3. Filter `PRINCIPALS` using `type : Service account`
4. Look for the Service Account with the nomenclature: `SERVICE_ACCOUNT_NAME@PROJECT_ID.iam.gserviceaccount.com`
5. Ensure that there are no such Service Accounts with roles containing `*Admin` or `*admin` or role matching `Editor` or role matching `Owner` under `Role` column.

**From Google Cloud CLI**

1. Get the policy that you want to modify, and write it to a JSON file:

```bash
gcloud projects get-iam-policy PROJECT_ID --format json > iam.json
```

2. The contents of the JSON file will look similar to the following. Note that `role` of members group associated with each `serviceaccount` does not contain `*Admin` or `*admin` or does not match `roles/editor` or does not match `roles/owner`.

This recommendation is only applicable to `User-Managed user-created` service accounts. These accounts have the nomenclature: `SERVICE_ACCOUNT_NAME@PROJECT_ID.iam.gserviceaccount.com`. Note that some Google-managed, Google-created service accounts have the same naming format, and should be excluded (e.g., `appsdev-apps-dev-script-auth@system.gserviceaccount.com` which needs the Owner role).

**Sample JSON output:**

```json
{
  "bindings": [
    {
      "members": ["serviceAccount:our-project-123@appspot.gserviceaccount.com"],
      "role": "roles/appengine.appAdmin"
    },
    {
      "members": ["user:email1@gmail.com"],
      "role": "roles/owner"
    },
    {
      "members": [
        "serviceAccount:our-project-123@appspot.gserviceaccount.com",
        "serviceAccount:123456789012-compute@developer.gserviceaccount.com"
      ],
      "role": "roles/editor"
    }
  ],
  "etag": "BwUjMhCsNvY=",
  "version": 1
}
```

## Expected Result

No user-managed service accounts should have `*Admin`, `*admin`, `Editor`, or `Owner` roles assigned.

## Remediation

**From Google Cloud Console**

1. Go to `IAM & admin/IAM` using `https://console.cloud.google.com/iam-admin/iam`
2. Under the `IAM` Tab look for `VIEW BY PRINCIPALS`
3. Filter `PRINCIPALS` using `type : Service account`
4. Look for the Service Account with the Principal nomenclature: `SERVICE_ACCOUNT_NAME@PROJECT_ID.iam.gserviceaccount.com`
5. Identify `User-Managed user created` service account with roles containing `*Admin` or `*admin` or role matching `Editor` or role matching `Owner` under `Role` Column.
6. Click on `Edit (Pencil Icon)` for the Service Account, it will open all the roles which are assigned to the Service Account.
7. Click the `Delete bin` icon to remove the role from the Principal (service account in this case).

**From Google Cloud CLI**

```bash
gcloud projects get-iam-policy PROJECT_ID --format json > iam.json
```

1. Using a text editor, Remove `Role` which contains `roles/*Admin` or `roles/*admin` or matched `roles/editor` or matches `roles/owner`. Add a role to the bindings array that defines the group members and the role for those members.

For example, to grant the role `roles/appengine.appViewer` to the `ServiceAccount` which is `roles/editor`, you would change the example shown below as follows:

```json
{
  "bindings": [
    {
      "members": ["serviceAccount:our-project-123@appspot.gserviceaccount.com"],
      "role": "roles/appengine.appViewer"
    },
    {
      "members": ["user:email1@gmail.com"],
      "role": "roles/owner"
    },
    {
      "members": [
        "serviceAccount:our-project-123@appspot.gserviceaccount.com",
        "serviceAccount:123456789012-compute@developer.gserviceaccount.com"
      ],
      "role": "roles/editor"
    }
  ],
  "etag": "BwUjMhCsNvY="
}
```

2. Update the project's IAM policy:

```bash
gcloud projects set-iam-policy PROJECT_ID iam.json
```

## Default Value

User Managed (and not user-created) default service accounts have the `Editor (roles/editor)` role assigned to them to support GCP services they offer.

By default, there are no roles assigned to `User Managed User created` service accounts.

## Additional Information

Default (user-managed but not user-created) service accounts have the `Editor (roles/editor)` role assigned to them to support GCP services they offer. Such Service accounts are: `PROJECT_NUMBER-compute@developer.gserviceaccount.com`, `PROJECT_ID@appspot.gserviceaccount.com`.

## References

1. https://cloud.google.com/sdk/gcloud/reference/iam/service-accounts/
2. https://cloud.google.com/iam/docs/understanding-roles
3. https://cloud.google.com/iam/docs/understanding-service-accounts

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                      | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts - Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | x    | x    | x    |
| v7               | 4.3 Ensure the Use of Dedicated Administrative Accounts - Ensure that all users with administrative account access use a dedicated or secondary account for elevated activities. This account should only be used for administrative activities and not internet browsing, email, or similar activities.                     | x    | x    | x    |
