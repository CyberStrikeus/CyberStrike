---
name: cis-gke-v180-5.10.1
description: "Ensure Kubernetes Web UI is Disabled (Automated)"
category: cis-gke
version: "1.8.0"
author: cyberstrike-official
tags:
  [cis, gke, kubernetes, gcp, other-cluster-config, web-ui, dashboard, alpha-clusters, gke-sandbox, security-posture]
cis_id: "5.10.1"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.8.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.10.1 Ensure Kubernetes Web UI is Disabled (Automated)

## Profile Applicability

- Level 1

## Description

Note: The Kubernetes web UI (Dashboard) does not have admin access by default in GKE 1.7 and higher. The Kubernetes web UI is disabled by default in GKE 1.10 and higher. In GKE 1.15 and higher, the Kubernetes web UI add-on KubernetesDashboard is no longer supported as a managed add-on.

The Kubernetes Web UI (Dashboard) has been a historical source of vulnerability and should only be deployed when necessary.

## Rationale

You should disable the Kubernetes Web UI (Dashboard) when running on Kubernetes Engine. The Kubernetes Web UI is backed by a highly privileged Kubernetes Service Account.

The Google Cloud Console provides all the required functionality of the Kubernetes Web UI and leverages Cloud IAM to restrict user access to sensitive cluster controls and settings.

## Impact

Users will be required to manage cluster resources using the Google Cloud Console or the command line. These require appropriate permissions. To use the command line, this requires the installation of the command line client, `kubectl`, on the user's device (this is already included in Cloud Shell) and knowledge of command line operations.

## Audit

Using Google Cloud Console:
Currently not possible, due to the add-on having been removed. Must use the command line.
Using Command Line:
First define 2 variables for Cluster Name and Zone and then run the following command:

```
gcloud container clusters describe $CLUSTER_NAME --zone $COMPUTE_ZONE  --format json | jq '.addonsConfig.kubernetesDashboard'
```

Ensure the output of the above command has JSON key attribute disabled set to `true`:

```json
{
  "disabled": true
}
```

## Remediation

Using Google Cloud Console:
Currently not possible, due to the add-on having been removed. Must use the command line.
Using Command Line:
To disable the Kubernetes Dashboard on an existing cluster, run the following command:

```
gcloud container clusters update <cluster_name> --zone <zone> --update-addons=KubernetesDashboard=DISABLED
```

## Default Value

The Kubernetes web UI (Dashboard) does not have admin access by default in GKE 1.7 and higher. The Kubernetes web UI is disabled by default in GKE 1.10 and higher. In GKE 1.15 and higher, the Kubernetes web UI add-on `KubernetesDashboard` is no longer supported as a managed add-on.

## References

1. https://cloud.google.com/kubernetes-engine/docs/how-to/hardening-your-cluster#disable_kubernetes_dashboard

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |
| v7               | 2.2 Ensure Software is Supported by Vendor                                      | x    | x    | x    |
| v7               | 18.4 Only Use Up-to-date And Trusted Third-Party Components                     |      | x    | x    |
