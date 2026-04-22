---
name: cis-gke-autopilot-v120-5.2.1
description: "Ensure GKE clusters are not running using the Compute Engine default service account (Automated)"
category: cis-gke-autopilot
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gke-autopilot, kubernetes, gcp, iam, identity, workload-identity]
cis_id: "5.2.1"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Autopilot Benchmark v1.2.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.1 Ensure GKE clusters are not running using the Compute Engine default service account (Automated)

## Profile Applicability

- Level 2

## Description

Create and use minimally privileged Service accounts to run GKE clusters instead of using the Compute Engine default Service account. Unnecessary permissions could be abused in the case of a node compromise.

## Rationale

A GCP service account (as distinct from a Kubernetes ServiceAccount) is an identity that an instance or an application can be used to run GCP API requests. This identity is used to identify virtual machine instances to other Google Cloud Platform services. By default, Kubernetes Engine nodes use the Compute Engine default service account. This account has broad access by default, as defined by access scopes, making it useful to a wide variety of applications on the VM, but it has more permissions than are required to run your Kubernetes Engine cluster.

A minimally privileged service account should be created and used to run the Kubernetes Engine cluster instead of using the Compute Engine default service account, and create separate service accounts for each Kubernetes Workload (See recommendation 5.2.2).

Kubernetes Engine requires, at a minimum, the node service account to have the `monitoring.viewer`, `monitoring.metricWriter`, and `logging.logWriter` roles. Additional roles may need to be added for the nodes to pull images from GCR.

## Impact

Instances are automatically granted the https://www.googleapis.com/auth/cloud-platform scope to allow full access to all Google Cloud APIs. This is so that the IAM permissions of the instance are completely determined by the IAM roles of the Service account. Thus if Kubernetes workloads were using cluster access scopes to perform actions using Google APIs, they may no longer be able to, if not permitted by the permissions of the Service account. To remediate, follow recommendation 5.2.2.

The Service account roles listed here are the minimum required to run the cluster. Additional roles may be required to pull from a private instance of Google Container Registry (GCR).

## Audit

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting https://console.cloud.google.com/kubernetes/list
2. Select the cluster under test and under Security ensure Service account is not set to default.

To check the permissions allocated to the service account are the minimum required for cluster operation:

1. Go to IAM by visiting https://console.cloud.google.com/iam-admin/iam
2. From the list of Service accounts, ensure each cluster Service account has only the following roles:
   - Logs Writer
   - Monitoring Metric Writer
   - Monitoring Viewer

**Using Command line:**
To check which Service account is set for an existing cluster, run the following command:

```bash
gcloud container clusters describe $CLUSTER_NAME --zone $COMPUTE_ZONE --format json | jq '.nodeConfig.serviceAccount'
```

The output of the above command will return default if default Service account is used for Project access.

To check that the permissions allocated to the service account are the minimum required for cluster operation:

```bash
gcloud projects get-iam-policy <project_id> \
  --flatten="bindings[].members" \
  --format='table(bindings.role)' \
  --filter="bindings.members:<service_account>"
```

Review the output to ensure that the service account only has the roles required to run the cluster:

- `roles/logging.logWriter`
- `roles/monitoring.metricWriter`
- `roles/monitoring.viewer`

## Remediation

**Using Google Cloud Console:**
To create a minimally privileged service account:

1. Go to Service Accounts by visiting: https://console.cloud.google.com/iam-admin/serviceaccounts.
2. Click on `CREATE SERVICE ACCOUNT`.
3. Enter Service Account Details.
4. Click `CREATE AND CONTINUE`.
5. Within Service Account permissions add the following roles:
   - `Logs Writer`.
   - `Monitoring Metric Writer`.
   - `Monitoring Viewer`.
6. Click `CONTINUE`.
7. Grant users access to this service account and create keys as required.
8. Click `DONE`.

Note: A new cluster will need to be created specifying the minimally privileged service account, and workloads will need to be migrated to the new cluster and the old cluster deleted.

**Using Command Line:**
To create a minimally privileged service account:

```bash
gcloud iam service-accounts create <node_sa_name> --display-name "GKE Node Service Account"
export NODE_SA_EMAIL=gcloud iam service-accounts list --format='value(email)' --filter='displayName:GKE Node Service Account'
```

Grant the following roles to the service account:

```bash
export PROJECT_ID=gcloud config get-value project
gcloud projects add-iam-policy-binding <project_id> --member serviceAccount:<node_sa_email> --role roles/monitoring.metricWriter
gcloud projects add-iam-policy-binding <project_id> --member serviceAccount:<node_sa_email> --role roles/monitoring.viewer
gcloud projects add-iam-policy-binding <project_id> --member serviceAccount:<node_sa_email> --role roles/logging.logWriter
```

Note: A new cluster will need to be created specifying the minimally privileged service account, and workloads will need to be migrated to the new cluster and the old cluster deleted.

## Default Value

By default, nodes use the Compute Engine default service account when you create a new cluster.

## References

1. https://cloud.google.com/compute/docs/access/service-accounts#compute_engine_default_service_account

## CIS Controls

| Controls Version | Control                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.7 Manage Default Accounts on Enterprise Assets and Software | x    | x    | x    |
| v7               | 4.3 Ensure the Use of Dedicated Administrative Accounts       | x    | x    | x    |
