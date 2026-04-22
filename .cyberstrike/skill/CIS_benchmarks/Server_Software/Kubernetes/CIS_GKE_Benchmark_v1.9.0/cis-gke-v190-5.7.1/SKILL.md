---
name: cis-gke-v190-5.7.1
description: "Ensure Logging and Cloud Monitoring is Enabled (Automated)"
category: cis-gke
version: "1.9.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, logging, monitoring, cloud-operations, stackdriver]
cis_id: "5.7.1"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.9.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.7.1 Ensure Logging and Cloud Monitoring is Enabled (Automated)

## Profile Applicability

- Level 1

## Description

Send logs and metrics to a remote aggregator to mitigate the risk of local tampering in the event of a breach.

## Rationale

Exporting logs and metrics to a dedicated, persistent datastore such as Cloud Operations for GKE ensures availability of audit data following a cluster security event, and provides a central location for analysis of log and metric data collated from multiple sources.

## Impact

None.

## Audit

**Using Google Cloud Console:**

LOGGING AND CLOUD MONITORING SUPPORT (PREFERRED):

1. Go to Kubernetes Engine by visiting https://console.cloud.google.com/kubernetes/list
2. From the list of clusters, click on the cluster of interest.
3. Under the details pane, within the Features section, ensure that `Logging` is `Enabled`.
4. Also ensure that `Cloud Monitoring` is `Enabled`.

LEGACY STACKDRIVER SUPPORT:

This option cannot be checked in the GCP console.

**Using Command Line:**

LOGGING AND CLOUD MONITORING SUPPORT (PREFERRED):

Run the following commands:

```bash
gcloud container clusters describe <cluster_name> --zone <compute_zone> --format json | jq '.loggingService'
gcloud container clusters describe <cluster_name> --zone <compute_zone> --format json | jq '.monitoringService'
```

The output of the above commands should return `logging.googleapis.com/kubernetes` and `monitoring.googleapis.com/kubernetes` respectively if Logging and Cloud Monitoring is Enabled.

LEGACY STACKDRIVER SUPPORT:

Note: This functionality was decommissioned on 31st March 2021, kept here for posterity (see: https://cloud.google.com/stackdriver/docs/deprecations/legacy for more information).

Both Logging and Monitoring support must be enabled.

For Logging, run the following command:

```bash
gcloud container clusters describe <cluster_name> --zone <compute_zone> --format json | jq '.loggingService'
```

The output should return `logging.googleapis.com` if Legacy Stackdriver Logging is Enabled.

For Monitoring, run the following command:

```bash
gcloud container clusters describe <cluster_name> --zone <compute_zone> --format json | jq '.monitoringService'
```

The output should return `monitoring.googleapis.com` if Legacy Stackdriver Monitoring is Enabled.

## Remediation

**Using Google Cloud Console:**

To enable Logging:

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. Select the cluster for which Logging is disabled.
3. Under the details pane, within the Features section, click on the pencil icon named `Edit logging`.
4. Check the box next to `Enable Logging`.
5. In the drop-down Components box, select the components to be logged.
6. Click `SAVE CHANGES`, and wait for the cluster to update.

To enable Cloud Monitoring:

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. Select the cluster for which Logging is disabled.
3. Under the details pane, within the Features section, click on the pencil icon named `Edit Cloud Monitoring`.
4. Check the box next to `Enable Cloud Monitoring`.
5. In the drop-down Components box, select the components to be logged.
6. Click `SAVE CHANGES`, and wait for the cluster to update.

**Using Command Line:**

To enable Logging for an existing cluster, run the following command:

```bash
gcloud container clusters update <cluster_name> --zone <compute_zone> --logging=<components_to_be_logged>
```

See https://cloud.google.com/sdk/gcloud/reference/container/clusters/update#--logging for a list of available components for logging.

To enable Cloud Monitoring for an existing cluster, run the following command:

```bash
gcloud container clusters update <cluster_name> --zone <compute_zone> --monitoring=<components_to_be_logged>
```

See https://cloud.google.com/sdk/gcloud/reference/container/clusters/update#--monitoring for a list of available components for Cloud Monitoring.

## Default Value

Logging and Cloud Monitoring is enabled by default starting in GKE version 1.14; Legacy Logging and Monitoring support is enabled by default for earlier versions.

## References

1. https://cloud.google.com/stackdriver/docs/solutions/gke/observing
2. https://cloud.google.com/stackdriver/docs/solutions/gke/managing-logs
3. https://cloud.google.com/stackdriver/docs/solutions/gke/installing
4. https://cloud.google.com/sdk/gcloud/reference/container/clusters/update#--logging
5. https://cloud.google.com/sdk/gcloud/reference/container/clusters/update#--monitoring

## CIS Controls

| Controls Version | Control                    | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs     | x    | x    | x    |
| v7               | 6.2 Activate audit logging | x    | x    | x    |
