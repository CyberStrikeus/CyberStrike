---
name: cis-gke-autopilot-v130-5.1.3
description: "Minimize cluster access to read-only for Container Image repositories (Manual)"
category: cis-gke-autopilot
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gke-autopilot, kubernetes, gcp, image-registry, image-scanning, artifact-registry, vulnerability-scanning]
cis_id: "5.1.3"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Autopilot Benchmark v1.3.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.3 Minimize cluster access to read-only for Container Image repositories (Manual)

## Profile Applicability

- Level 2

## Description

Note: GCR is now deprecated, see the references for more details.

Configure the Cluster Service Account with Artifact Registry Viewer Role to only allow read-only access to AR repositories. Configure the Cluster Service Account with Storage Object Viewer Role to only allow read-only access to GCR.

## Rationale

The Cluster Service Account does not require administrative access to GCR or AR, only requiring pull access to containers to deploy onto GKE. Restricting permissions follows the principles of least privilege and prevents credentials from being abused beyond the required role.

## Impact

A separate dedicated service account may be required for use by build servers and other robot users pushing or managing container images.

Any account granted the Storage Object Viewer role at the project level can view all objects stored in GCS for the project.

## Audit

### For Images Hosted in AR:

**Using Google Cloud Console:**

1. Go to Artifacts Browser by visiting https://console.cloud.google.com/artifacts
2. From the list of repositories, for each repository with Format Docker
3. Under the Permissions tab, review the role for GKE Service account and ensure that only the Artifact Registry Viewer role is set.

**Using Command Line:**

```bash
gcloud artifacts repositories get-iam-policy <repository-name> --location <repository-location>
```

The output of the command will return roles associated with the AR repository. If listed, ensure the GKE Service account is set to `"role": "roles/artifactregistry.reader"`.

### For Images Hosted in GCR:

**Using Google Cloud Console:**

1. Go to Storage Browser by visiting https://console.cloud.google.com/storage/browser
2. From the list of storage buckets, select `artifacts.<project_id>.appspot.com` for the GCR bucket
3. Under the Permissions tab, review the role for GKE Service account and ensure that only the Storage Object Viewer role is set.

**Using Command Line:**
GCR bucket permissions:

```bash
gsutil iam get gs://artifacts.<project_id>.appspot.com
```

The output of the command will return roles associated with the GCR bucket. If listed, ensure the GKE Service account is set to `"role": "roles/storage.objectViewer"`. If the GKE Service Account has project level permissions that are inherited within the bucket, ensure that these are not privileged:

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

Your GKE Service Account should not be output when this command is run.

## Remediation

### For Images Hosted in AR:

**Using Google Cloud Console:**

1. Go to Artifacts Browser by visiting https://console.cloud.google.com/artifacts
2. From the list of repositories, for each repository with Format Docker
3. Under the Permissions tab, modify the permissions for GKE Service account and ensure that only the Artifact Registry Viewer role is set.

**Using Command Line:**
Add artifactregistry.reader role:

```bash
gcloud artifacts repositories add-iam-policy-binding <repository> \
--location=<repository-location> \
--member='serviceAccount:<email-address>' \
--role='roles/artifactregistry.reader'
```

Remove any roles other than `artifactregistry.reader`:

```bash
gcloud artifacts repositories remove-iam-policy-binding <repository> \
--location <repository-location> \
--member='serviceAccount:<email-address>' \
--role='<role-name>'
```

### For Images Hosted in GCR:

**Using Google Cloud Console:**
For an account explicitly granted access to the bucket:

1. Go to Storage Browser by visiting: https://console.cloud.google.com/storage/browser.
2. From the list of storage buckets, select `artifacts.<project_id>.appspot.com` for the GCR bucket.
3. Under the Permissions tab, modify permissions of the identified GKE Service Account via the drop-down role menu and change to the Role to `Storage Object Viewer` for read-only access.

For an account that inherits access to the bucket through Project level permissions:

1. Go to IAM console by visiting: https://console.cloud.google.com/iam-admin.
2. From the list of accounts, identify the required service account and select the corresponding pencil icon.
3. Remove the `Storage Admin` / `Storage Object Admin` / `Storage Object Creator` roles.
4. Add the `Storage Object Viewer` role - note with caution that this permits the account to view all objects stored in GCS for the project.
5. Click `SAVE`.

**Using Command Line:**
For an account explicitly granted to the bucket:
Firstly add read access to the Kubernetes Service Account:

```bash
gsutil iam ch <type>:<email_address>:objectViewer gs://artifacts.<project_id>.appspot.com
```

where:

- `<type>` can be one of the following:
  - `user`, if the `<email_address>` is a Google account.
  - `serviceAccount`, if `<email_address>` specifies a Service account.
- `<email_address>` can be one of the following:
  - a Google account (for example, `someone@example.com`).
  - a Cloud IAM service account.

Then remove the excessively privileged role (`Storage Admin` / `Storage Object Admin` / `Storage Object Creator`) using:

```bash
gsutil iam ch -d <type>:<email_address>:<role> gs://artifacts.<project_id>.appspot.com
```

For an account that inherits access to the GCR Bucket through Project level permissions, modify the Projects IAM policy file accordingly, then upload it using:

```bash
gcloud projects set-iam-policy <project_id> <policy_file>
```

## Default Value

The default permissions for the cluster Service account is dependent on the initial configuration and IAM policy.

## References

1. https://cloud.google.com/container-registry/docs/
2. https://cloud.google.com/kubernetes-engine/docs/how-to/service-accounts
3. https://cloud.google.com/kubernetes-engine/docs/how-to/iam

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 3.2 Perform Authenticated Vulnerability Scanning | | x | x |
