---
name: cis-gcp-foundations-2.16
description: "Ensure Logging is enabled for HTTP(S) Load Balancer"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, logging, monitoring, load-balancer, networking]
cis_id: "2.16"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.16 Ensure Logging is enabled for HTTP(S) Load Balancer (Automated)

## Profile Applicability

- Level 2

## Description

Logging enabled on a HTTPS Load Balancer will show all network traffic and its destination.

## Rationale

Logging will allow you to view HTTPS network traffic to your web applications.

## Impact

On high use systems with a high percentage sample rate, the logging file may grow to high capacity in a short amount of time. Ensure that the sample rate is set appropriately so that storage costs are not exorbitant.

## Audit

### From Google Cloud Console

1. From Google Cloud home open the Navigation Menu in the top left.
2. Under the `Networking` heading select `Network services`.
3. Select the HTTPS load-balancer you wish to audit.
4. Select `Edit` then `Backend Configuration`.
5. Select `Edit` on the corresponding backend service.
6. Ensure that `Enable Logging` is selected. Also ensure that `Sample Rate` is set to an appropriate level for your needs.

### From Google Cloud CLI

1. Run the following command:

```bash
gcloud compute backend-services describe <serviceName>
```

2. Ensure that `enable-logging` is enabled and `sample rate` is set to your desired level.

## Remediation

### From Google Cloud Console

1. From Google Cloud home open the Navigation Menu in the top left.
2. Under the `Networking` heading select `Network services`.
3. Select the HTTPS load-balancer you wish to audit.
4. Select `Edit` then `Backend Configuration`.
5. Select `Edit` on the corresponding backend service.
6. Click `Enable Logging`.
7. Set `Sample Rate` to a desired value. This is a percentage as a decimal point. 1.0 is 100%.

### From Google Cloud CLI

1. Run the following command:

```bash
gcloud compute backend-services update <serviceName> --region=REGION --enable-logging --logging-sample-rate=<percentageAsADecimal>
```

## Default Value

By default logging for https load balancing is disabled. When logging is enabled it sets the default sample rate as 1.0 or 100%. Ensure this value fits the need of your organization to avoid high storage costs.

## References

1. https://cloud.google.com/load-balancing/
2. https://cloud.google.com/load-balancing/docs/https/https-logging-monitoring#gcloud:-global-mode
3. https://cloud.google.com/sdk/gcloud/reference/compute/backend-services/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 8.2 Collect Audit Logs | x | x | x |
| v7 | 6.2 Activate audit logging | x | x | x |
