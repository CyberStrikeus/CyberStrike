---
name: cis-gke-v170-5.8.1
description: "Ensure authentication using Client Certificates is Disabled (Automated)"
category: cis-gke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, authentication, client-certificates, x509, openid-connect]
cis_id: "5.8.1"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.7.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.8.1 Ensure authentication using Client Certificates is Disabled (Automated)

## Profile Applicability

- Level 1

## Description

Disable Client Certificates, which require certificate rotation, for authentication. Instead, use another authentication method like OpenID Connect.

## Rationale

With Client Certificate authentication, a client presents a certificate that the API server verifies with the specified Certificate Authority. In GKE, Client Certificates are signed by the cluster root Certificate Authority. When retrieved, the Client Certificate is only base64 encoded and not encrypted.

GKE manages authentication via gcloud for you using the OpenID Connect token method, setting up the Kubernetes configuration, getting an access token, and keeping it up to date. This means Basic Authentication using static passwords and Client Certificate authentication, which both require additional management overhead of key management and rotation, are not necessary and should be disabled.

When Client Certificate authentication is disabled, you will still be able to authenticate to the cluster with other authentication methods, such as OpenID Connect tokens. See also Recommendation 6.8.1 to disable authentication using static passwords, known as Basic Authentication.

## Impact

Users will no longer be able to authenticate with the pre-provisioned x509 certificate. You will have to configure and use alternate authentication mechanisms, such as OpenID Connect tokens.

## Audit

The audit script for this recommendation utilizes 3 variables:
$CLUSTER_NAME
$COMPUTE_ZONE
Please set these parameters on the system where you will be executing your gcloud audit script or command.

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting https://console.cloud.google.com/kubernetes/list
2. From the list of clusters, click on the desired cluster. On the Details pane, make sure 'Client certificate' is set to 'Disabled'.

**Using Command Line:**

To check that the client certificate has not been issued, run the following command:

```bash
gcloud container clusters describe $CLUSTER_NAME \
  --zone $COMPUTE_ZONE \
  --format json | jq '.masterAuth.clientKey'
```

The output of the above command returns null (`{ }`) if the client certificate has not been issued for the cluster (Client Certificate authentication is disabled).

Note. Depreciated as of v1.19. For Basic Authentication, Legacy authorization can be edited for standard clusters but cannot be edited in Autopilot clusters.

## Remediation

Currently, there is no way to remove a client certificate from an existing cluster. Thus a new cluster must be created.

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting https://console.cloud.google.com/kubernetes/list
2. Click CREATE CLUSTER
3. Configure as required and the click on 'Availability, networking, security, and additional features' section
4. Ensure that the 'Issue a client certificate' checkbox is not ticked
5. Click CREATE.

**Using Command Line:**

Create a new cluster without a Client Certificate:

```bash
gcloud container clusters create [CLUSTER_NAME] \
  --no-issue-client-certificate
```

## Default Value

Google Kubernetes Engine (GKE), both Basic Authentication and Client Certificate issuance are disabled by default for new clusters. This change was implemented starting with GKE version 1.12 to enhance security by reducing the attack surface associated with these authentication methods.

## References

1. https://cloud.google.com/kubernetes-engine/docs/how-to/hardening-your-cluster#restrict_authn_methods

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | x |
| v7 | 16 Account Monitoring and Control | | | |
