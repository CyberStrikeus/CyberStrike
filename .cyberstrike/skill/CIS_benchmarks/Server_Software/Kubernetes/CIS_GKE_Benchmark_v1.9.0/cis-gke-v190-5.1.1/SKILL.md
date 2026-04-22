---
name: cis-gke-v190-5.1.1
description: "Ensure Image Vulnerability Scanning is enabled (Automated)"
category: cis-gke
version: "1.9.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, image-registry, image-scanning, artifact-registry, vulnerability-scanning, binary-authorization]
cis_id: "5.1.1"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.9.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.1 Ensure Image Vulnerability Scanning is enabled (Automated)

## Profile Applicability

- Level 2

## Description

Note: GCR is now deprecated, being superseded by Artifact Registry starting 15th May 2024. Runtime Vulnerability scanning is available via GKE Security Posture

Scan images stored in Google Container Registry (GCR) or Artifact Registry (AR) for vulnerabilities.

## Rationale

Vulnerabilities in software packages can be exploited by malicious users to obtain unauthorized access to local cloud resources. GCR Container Analysis API or Artifact Registry Container Scanning API allow images stored in GCR or AR respectively to be scanned for known vulnerabilities.

## Impact

None.

## Audit

### For Images Hosted in GCR:

**Using Google Cloud Console:**

1. Go to GCR by visiting https://console.cloud.google.com/gcr
2. Select Settings and check if `Vulnerability scanning` is Enabled.

**Using Command Line:**

```bash
gcloud services list --enabled
```

Ensure that the `Container Registry API` and `Container Analysis API` are listed in the output.

### For Images Hosted in AR:

**Using Google Cloud Console:**

1. Go to AR by visiting https://console.cloud.google.com/artifacts
2. Select Settings and check if `Vulnerability scanning` is Enabled.

**Using Command Line:**

```bash
gcloud services list --enabled
```

Ensure that the `Container Scanning API` and `Artifact Registry API` are listed in the output.

## Remediation

### For Images Hosted in GCR:

**Using Google Cloud Console**

1. Go to GCR by visiting: https://console.cloud.google.com/gcr
2. Select Settings and, under the Vulnerability Scanning heading, click the TURN ON button.

**Using Command Line**

```bash
gcloud services enable containeranalysis.googleapis.com
```

### For Images Hosted in AR:

**Using Google Cloud Console**

1. Go to GCR by visiting: https://console.cloud.google.com/artifacts
2. Select Settings and, under the Vulnerability Scanning heading, click the ENABLE button.

**Using Command Line**

```bash
gcloud services enable containerscanning.googleapis.com
```

## Default Value

By default, GCR Container Analysis and AR Container Scanning are disabled.

## References

1. https://cloud.google.com/artifact-registry/docs/analysis
2. https://cloud.google.com/artifact-analysis/docs/os-overview
3. https://console.cloud.google.com/marketplace/product/google/containerregistry.googleapis.com
4. https://cloud.google.com/kubernetes-engine/docs/concepts/about-configuration-scanning
5. https://containersecurity.googleapis.com

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 7.6 Perform Automated Vulnerability Scans of Externally-Exposed Enterprise Assets | | x | x |
| v7 | 3 Continuous Vulnerability Management | | | |
| v7 | 3.1 Run Automated Vulnerability Scanning Tools | | x | x |
| v7 | 3.2 Perform Authenticated Vulnerability Scanning | | x | x |
