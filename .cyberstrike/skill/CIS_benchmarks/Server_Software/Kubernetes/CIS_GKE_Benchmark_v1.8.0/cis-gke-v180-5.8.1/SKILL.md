---
name: cis-gke-v180-5.8.1
description: "Ensure authentication using Client Certificates is Disabled (Automated)"
category: cis-gke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, authentication, authorization, client-certificates, rbac, abac, google-groups]
cis_id: "5.8.1"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.8.0"
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

Do not make use of client certificate authentication in GKE, as the credentials cannot be revoked. Instead, use another authentication method like OpenID Connect.

## Rationale

With Client Certificate authentication, a client presents a certificate that the API server verifies with the specified Certificate Authority. In GKE, Client Certificates are signed by the cluster root Certificate Authority. When retrieved, the Client Certificate is only base64 encoded and not encrypted.

GKE manages authentication via gcloud for you using the OpenID Connect token method, setting up the Kubernetes configuration, getting an access token, and keeping it up to date. This means Basic Authentication using static passwords and Client Certificate authentication, which both require additional management overhead of key management and rotation, are not necessary and should not be used where possible.

When Client Certificate creation is disabled GKE will not provide a client certificate on cluster creation, however users will still be able to use the Certificate Signing Request (CSR) API to create new client certificates, if they have access to it.

## Impact

Users will no longer be able to authenticate with the pre-provisioned x509 certificate. You should configure and use alternate authentication mechanisms, such as OpenID Connect tokens.

## Audit

Using Google Cloud Console

1. Go to Kubernetes Engine by visiting https://console.cloud.google.com/kubernetes/list.
2. From the list of clusters, click on the desired cluster. On the Details pane, make sure 'Client certificate' is set to 'Disabled'.

Using Command line
To check that the client certificate has not been issued, first define 2 variables for Cluster Name and Zone and then run the following command:

```
gcloud container clusters describe $CLUSTER_NAME --zone $COMPUTE_ZONE --format json | jq '.masterAuth.clientKey'
```

The output of the above command returns

```
null
```

if the client certificate has not been issued for the cluster (Client Certificate authentication is disabled).
Note. Depreciated as of v1.19. For Basic Authentication, Legacy authorization can be edited for standard clusters but cannot be edited in Autopilot clusters.

## Remediation

Currently, there is no way to remove a client certificate from an existing cluster. Thus a new cluster must be created.
Using Google Cloud Console

1. Go to Kubernetes Engine by visiting https://console.cloud.google.com/kubernetes/list.
2. Click CREATE CLUSTER
3. Configure as required and the click on 'Availability, networking, security, and additional features' section
4. Ensure that the 'Issue a client certificate' checkbox is not ticked
5. Click CREATE.

Using Command Line
Create a new cluster without a Client Certificate:

```
gcloud container clusters create [CLUSTER_NAME] \
  --no-issue-client-certificate
```

In addition it's important to restrict access to the CSR API in Kubernetes to prevent users from using it to issue new client certificate credentials.

## Default Value

Google Kubernetes Engine (GKE), both Basic Authentication and Client Certificate issuance are disabled by default for new clusters. This change was implemented starting with GKE version 1.12 to enhance security by reducing the attack surface associated with these authentication methods.

## References

1. https://cloud.google.com/kubernetes-engine/docs/how-to/hardening-your-cluster#restrict_authn_methods

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | x |
| v7 | 16 Account Monitoring and Control | | | |
