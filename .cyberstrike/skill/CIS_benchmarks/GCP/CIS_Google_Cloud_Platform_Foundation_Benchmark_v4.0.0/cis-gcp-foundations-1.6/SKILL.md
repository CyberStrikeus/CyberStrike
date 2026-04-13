---
name: cis-gcp-foundations-1.6
description: "Ensure That IAM Users Are Not Assigned the Service Account User or Service Account Token Creator Roles at Project Level"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, iam, service-accounts, mfa, kms, api-keys]
cis_id: "1.6"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.6 Ensure That IAM Users Are Not Assigned the Service Account User or Service Account Token Creator Roles at Project Level (Automated)

## Profile Applicability

- Level 1

## Description

It is recommended to assign the `Service Account User (iam.serviceAccountUser)` and `Service Account Token Creator (iam.serviceAccountTokenCreator)` roles to a user for a specific service account rather than assigning the role to a user at project level.

## Rationale

A service account is a special Google account that belongs to an application or a virtual machine (VM), instead of to an individual end-user. Application/VM-Instance uses the service account to call the service's Google API so that users aren't directly involved. In addition to being an identity, a service account is a resource that has IAM policies attached to it. These policies determine who can use the service account.

Users with IAM roles to update the App Engine and Compute Engine instances (such as App Engine Deployer or Compute Instance Admin) can effectively run code as the service accounts used to run these instances, and indirectly gain access to all the resources for which the service accounts have access. Similarly, SSH access to a Compute Engine instance may also provide the ability to execute code as that instance/Service account.

Based on business needs, there could be multiple user-managed service accounts configured for a project. Granting the `iam.serviceAccountUser` or `iam.serviceAccountTokenCreator` roles to a user for a project gives the user access to all service accounts in the project, including service accounts that may be created in the future. This can result in elevation of privileges by using service accounts and corresponding `Compute Engine instances`.

In order to implement `least privileges` best practices, IAM users should not be assigned the `Service Account User` or `Service Account Token Creator` roles at the project level. Instead, these roles should be assigned to a user for a specific service account, giving that user access to the service account. The `Service Account User` allows a user to bind a service account to a long-running job service, whereas the `Service Account Token Creator` role allows a user to directly impersonate (or assert) the identity of a service account.

## Impact

After revoking `Service Account User` or `Service Account Token Creator` roles at the project level from all impacted user account(s), these roles should be assigned to a user(s) for specific service account(s) according to business needs.

## Audit Procedure

**From Google Cloud Console**

1. Go to the IAM page in the GCP Console by visiting `https://console.cloud.google.com/iam-admin/iam`
2. Click on the filter table text bar, Type `Role: Service Account User`.
3. Ensure no user is listed as a result of the filter.
4. Click on the filter table text bar, Type `Role: Service Account Token Creator`.
5. Ensure no user is listed as a result of the filter.

**From Google Cloud CLI**

To ensure IAM users are not assigned Service Account User role at the project level:

```bash
gcloud projects get-iam-policy PROJECT_ID --format json | jq '.bindings[].role' | grep "roles/iam.serviceAccountUser"

gcloud projects get-iam-policy PROJECT_ID --format json | jq '.bindings[].role' | grep "roles/iam.serviceAccountTokenCreator"
```

## Expected Result

These commands should not return any output.

## Remediation

**From Google Cloud Console**

1. Go to the IAM page in the GCP Console by visiting: `https://console.cloud.google.com/iam-admin/iam`.
2. Click on the filter table text bar. Type `Role: Service Account User`
3. Click the `Delete Bin` icon in front of the role `Service Account User` for every user listed as a result of a filter.
4. Click on the filter table text bar. Type `Role: Service Account Token Creator`
5. Click the `Delete Bin` icon in front of the role `Service Account Token Creator` for every user listed as a result of a filter.

**From Google Cloud CLI**

1. Using a text editor, remove the bindings with the `roles/iam.serviceAccountUser` or `roles/iam.serviceAccountTokenCreator`.

For example, you can use the iam.json file shown below as follows:

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

By default, users do not have the Service Account User or Service Account Token Creator role assigned at project level.

## Additional Information

To assign the role `roles/iam.serviceAccountUser` or `roles/iam.serviceAccountTokenCreator` to a user role on a service account instead of a project:

1. Go to `https://console.cloud.google.com/projectselector/iam-admin/serviceaccounts`
2. Select `Target Project`
3. Select `target service account`. Click `Permissions` on the top bar. It will open permission pane on right side of the page.
4. Add desired members with `Service Account User` or `Service Account Token Creator` role.

## References

1. https://cloud.google.com/iam/docs/service-accounts
2. https://cloud.google.com/iam/docs/granting-roles-to-service-accounts
3. https://cloud.google.com/iam/docs/understanding-roles
4. https://cloud.google.com/iam/docs/granting-changing-revoking-access
5. https://console.cloud.google.com/iam-admin/iam

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | x    | x    | x    |
