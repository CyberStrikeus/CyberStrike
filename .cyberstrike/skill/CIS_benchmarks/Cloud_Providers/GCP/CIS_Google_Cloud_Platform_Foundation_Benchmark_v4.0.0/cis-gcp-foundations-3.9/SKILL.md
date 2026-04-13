---
name: cis-gcp-foundations-3.9
description: "Ensure No HTTPS or SSL Proxy Load Balancers Permit SSL Policies With Weak Cipher Suites"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, networking, ssl, load-balancer]
cis_id: "3.9"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.9 Ensure No HTTPS or SSL Proxy Load Balancers Permit SSL Policies With Weak Cipher Suites (Manual)

## Profile Applicability

- Level 1

## Description

Secure Sockets Layer (SSL) policies determine what port Transport Layer Security (TLS) features clients are permitted to use when connecting to load balancers. To prevent usage of insecure features, SSL policies should use (a) at least TLS 1.2 with the MODERN profile; or (b) the RESTRICTED profile, because it effectively requires clients to use TLS 1.2 regardless of the chosen minimum TLS version; or (3) a CUSTOM profile that does not support any of the following features:

```
TLS_RSA_WITH_AES_128_GCM_SHA256
TLS_RSA_WITH_AES_256_GCM_SHA384
TLS_RSA_WITH_AES_128_CBC_SHA
TLS_RSA_WITH_AES_256_CBC_SHA
TLS_RSA_WITH_3DES_EDE_CBC_SHA
```

## Rationale

Load balancers are used to efficiently distribute traffic across multiple servers. Both SSL proxy and HTTPS load balancers are external load balancers, meaning they distribute traffic from the Internet to a GCP network. GCP customers can configure load balancer SSL policies with a minimum TLS version (1.0, 1.1, or 1.2) that clients can use to establish a connection, along with a profile (Compatible, Modern, Restricted, or Custom) that specifies permissible cipher suites. To comply with users using outdated protocols, GCP load balancers can be configured to permit insecure cipher suites. In fact, the GCP default SSL policy uses a minimum TLS version of 1.0 and a Compatible profile, which allows the widest range of insecure cipher suites. As a result, it is easy for customers to configure a load balancer without even knowing that they are permitting outdated cipher suites.

## Impact

Creating more secure SSL policies can prevent clients using older TLS versions from establishing a connection.

## Audit

### From Google Cloud Console

1. See all load balancers by visiting https://console.cloud.google.com/net-services/loadbalancing/loadBalancers/list.
2. For each load balancer for `SSL (Proxy)` or `HTTPS`, click on its name to go the `Load balancer details` page.
3. Ensure that each target proxy entry in the `Frontend` table has an `SSL Policy` configured.
4. Click on each SSL policy to go to its `SSL policy details` page.
5. Ensure that the SSL policy satisfies one of the following conditions:
   - has a `Min TLS` set to `TLS 1.2` and `Profile` set to `Modern` profile, or
   - has `Profile` set to `Restricted`. Note that a Restricted profile effectively requires clients to use TLS 1.2 regardless of the chosen minimum TLS version, or
   - has `Profile` set to `Custom` and the following features are all disabled:
     ```
     TLS_RSA_WITH_AES_128_GCM_SHA256
     TLS_RSA_WITH_AES_256_GCM_SHA384
     TLS_RSA_WITH_AES_128_CBC_SHA
     TLS_RSA_WITH_AES_256_CBC_SHA
     TLS_RSA_WITH_3DES_EDE_CBC_SHA
     ```

### From Google Cloud CLI

1. List all TargetHttpsProxies and TargetSslProxies.

```bash
gcloud compute target-https-proxies list
gcloud compute target-ssl-proxies list
```

2. For each target proxy, list its properties:

```bash
gcloud compute target-https-proxies describe TARGET_HTTPS_PROXY_NAME
gcloud compute target-ssl-proxies describe TARGET_SSL_PROXY_NAME
```

3. Ensure that the `sslPolicy` field is present and identifies the name of the SSL policy:

```
sslPolicy:
https://www.googleapis.com/compute/v1/projects/PROJECT_ID/global/sslPolicies/SSL_POLICY_NAME
```

If the `sslPolicy` field is missing from the configuration, it means that the GCP default policy is used, which is insecure.

4. Describe the SSL policy:

```bash
gcloud compute ssl-policies describe SSL_POLICY_NAME
```

5. Ensure that the policy satisfies one of the following conditions:
   - has `Profile` set to `Modern` and `minTlsVersion` set to `TLS_1_2`, or
   - has `Profile` set to `Restricted`, or
   - has `Profile` set to `Custom` and `enabledFeatures` does not contain any of the following values:
     ```
     TLS_RSA_WITH_AES_128_GCM_SHA256
     TLS_RSA_WITH_AES_256_GCM_SHA384
     TLS_RSA_WITH_AES_128_CBC_SHA
     TLS_RSA_WITH_AES_256_CBC_SHA
     TLS_RSA_WITH_3DES_EDE_CBC_SHA
     ```

## Remediation

### From Google Cloud Console

If the TargetSSLProxy or TargetHttpsProxy does not have an SSL policy configured, create a new SSL policy. Otherwise, modify the existing insecure policy.

1. Navigate to the `SSL Policies` page by visiting: https://console.cloud.google.com/net-security/sslpolicies
2. Click on the name of the insecure policy to go to its `SSL policy details` page.
3. Click `EDIT`.
4. Set `Minimum TLS version` to `TLS 1.2`.
5. Set `Profile` to `Modern` or `Restricted`.
6. Alternatively, if the user selects the profile `Custom`, make sure that the following features are disabled:
   ```
   TLS_RSA_WITH_AES_128_GCM_SHA256
   TLS_RSA_WITH_AES_256_GCM_SHA384
   TLS_RSA_WITH_AES_128_CBC_SHA
   TLS_RSA_WITH_AES_256_CBC_SHA
   TLS_RSA_WITH_3DES_EDE_CBC_SHA
   ```

### From Google Cloud CLI

1. For each insecure SSL policy, update it to use secure cyphers:

```bash
gcloud compute ssl-policies update NAME [--profile COMPATIBLE|MODERN|RESTRICTED|CUSTOM] --min-tls-version 1.2 [--custom-features FEATURES]
```

2. If the target proxy has a GCP default SSL policy, use the following command corresponding to the proxy type to update it.

```bash
gcloud compute target-ssl-proxies update TARGET_SSL_PROXY_NAME --ssl-policy SSL_POLICY_NAME
gcloud compute target-https-proxies update TARGET_HTTPS_POLICY_NAME --ssl-policy SSL_POLICY_NAME
```

## Default Value

The GCP default SSL policy is the least secure setting: Min TLS 1.0 and Compatible profile.

## References

1. https://cloud.google.com/load-balancing/docs/use-ssl-policies
2. https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-52r2.pdf

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            |      | x    | x    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit |      | x    | x    |
