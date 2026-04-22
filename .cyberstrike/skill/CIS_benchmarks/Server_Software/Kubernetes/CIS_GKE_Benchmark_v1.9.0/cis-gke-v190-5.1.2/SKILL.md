---
name: cis-gke-v190-5.1.2
description: "Minimize user access to Container Image repositories (Manual)"
category: cis-gke
version: "1.9.0"
author: cyberstrike-official
tags:
  [
    cis,
    gke,
    kubernetes,
    gcp,
    image-registry,
    image-scanning,
    artifact-registry,
    vulnerability-scanning,
    binary-authorization,
  ]
cis_id: "5.1.2"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.9.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.2 Minimize user access to Container Image repositories (Manual)

## Profile Applicability

- Level 2

## Description

Note: GCR is now deprecated, see the references for more details.

Restrict user access to GCR or AR, limiting interaction with build images to only authorized personnel and service accounts.

## Rationale

Weak access control to GCR or AR may allow malicious users to replace built images with vulnerable or back-doored containers.

## Impact

Care should be taken not to remove access to GCR or AR for accounts that require this for their operation. Any account granted the Storage Object Viewer role at the project level can view all objects stored in GCS for the project.

## Audit

### For Images Hosted in AR:

1. Go to Artifacts Browser by visiting https://console.cloud.google.com/artifacts
2. From the list of artifacts select each repository with format `Docker`
3. Under the Permissions tab, review the roles for each member and ensure only authorized users have the Artifact Registry Administrator, Artifact Registry Reader, Artifact Registry Repository Administrator and Artifact Registry Writer roles.

Users may have permissions to use Service Accounts and thus Users could inherit privileges on the AR repositories. To check the accounts that could do this:

1. Go to IAM by visiting https://console.cloud.google.com/iam-admin/iam
2. Apply the filter `Role: Service Account User`.

**Using Command Line:**

```bash
gcloud artifacts repositories get-iam-policy <repository-name> --location <repository-location>
```

The output of the command will return roles associated with the AR repository and which members have those roles.

### For Images Hosted in GCR:

**Using Google Cloud Console:**
GCR bucket permissions

1. Go to Storage Browser by visiting https://console.cloud.google.com/storage/browser
2. From the list of storage buckets, select `artifacts.<project_id>.appspot.com` for the GCR bucket
3. Under the Permissions tab, review the roles for each member and ensure only authorized users have the Storage Admin, Storage Object Admin, Storage Object Creator, Storage Legacy Bucket Owner, Storage Legacy Bucket Writer and Storage Legacy Object Owner roles.

Users may have permissions to use Service Accounts and thus Users could inherit privileges on the GCR Bucket. To check the accounts that could do this:

1. Go to IAM by visiting https://console.cloud.google.com/iam-admin/iam
2. Apply the filter `Role: Service Account User`.

**Using Command Line:**
To check GCR bucket specific permissions:

```bash
gsutil iam get gs://artifacts.<project_id>.appspot.com
```

Additionally, run the following to identify users and service accounts that hold privileged roles at the project level, and thus inherit these privileges within the GCR bucket:

```bash
gcloud projects get-iam-policy <project_id> \
--flatten="bindings[].members" \
--format='table(bindings.members,bindings.role)' \
--filter="bindings.role:roles/storage.admin OR
bindings.role:roles/storage.objectAdmin OR
bindings.role:roles/storage.objectCreator OR
bindings.role:roles/storage.legacyBucketOwner OR
bindings.role:roles/storage.legacyBucketWriter OR
bindings.role:roles/storage.legacyObjectOwner"
```

The output from the command lists the service accounts that have create/modify permissions.

Users may have permissions to use Service Accounts and thus Users could inherit privileges on the GCR Bucket. To check the accounts that could do this:

```bash
gcloud projects get-iam-policy <project_id>  \
--flatten="bindings[].members" \
--format='table(bindings.members)' \
--filter="bindings.role:roles/iam.serviceAccountUser"
```

## Remediation

### For Images Hosted in AR:

**Using Google Cloud Console:**

1. Go to Artifacts Browser by visiting https://console.cloud.google.com/artifacts
2. From the list of artifacts select each repository with format `Docker`
3. Under the Permissions tab, modify the roles for each member and ensure only authorized users have the Artifact Registry Administrator, Artifact Registry Reader, Artifact Registry Repository Administrator and Artifact Registry Writer roles.

**Using Command Line:**

```bash
gcloud artifacts repositories set-iam-policy <repository-name> <path-to-policy-file> --location <repository-location>
```

To learn how to configure policy files see: https://cloud.google.com/artifact-registry/docs/access-control#grant

### For Images Hosted in GCR:

**Using Google Cloud Console:**
To modify roles granted at the GCR bucket level:

1. Go to Storage Browser by visiting: https://console.cloud.google.com/storage/browser.
2. From the list of storage buckets, select `artifacts.<project_id>.appspot.com` for the GCR bucket
3. Under the Permissions tab, modify permissions of the identified member via the drop-down role menu and change the Role to `Storage Object Viewer` for read-only access.

For a User or Service account with Project level permissions inherited by the GCR bucket, or the `Service Account User Role`:

1. Go to IAM by visiting: https://console.cloud.google.com/iam-admin/iam
2. Find the User or Service account to be modified and click on the corresponding pencil icon.
3. Remove the `create/modify` role (`Storage Admin`/`Storage Object Admin`/`Storage Object Creator`/`Service Account User`) on the user or service account.
4. If required add the `Storage Object Viewer` role - note with caution that this permits the account to view all objects stored in GCS for the project.

**Using Command Line:**
To change roles at the GCR bucket level:
Firstly, run the following if read permissions are required:

```bash
gsutil iam ch <type>:<email_address>:objectViewer gs://artifacts.<project_id>.appspot.com
```

Then remove the excessively privileged role (`Storage Admin`/`Storage Object Admin`/`Storage Object Creator`) using:

```bash
gsutil iam ch -d <type>:<email_address>:<role> gs://artifacts.<project_id>.appspot.com
```

To modify roles defined at the project level and subsequently inherited within the GCR bucket, or the Service Account User role, extract the IAM policy file, modify it accordingly and apply it using:

```bash
gcloud projects set-iam-policy <project_id> <policy_file>
```

## Default Value

By default, GCR is disabled and access controls are set during initialisation.

## References

1. https://cloud.google.com/container-registry/docs/
2. https://cloud.google.com/kubernetes-engine/docs/how-to/service-accounts
3. https://cloud.google.com/kubernetes-engine/docs/how-to/iam
4. https://cloud.google.com/artifact-registry/docs/access-control#grant

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |
