---
name: cis-gcp-foundations-4.10
description: "Ensure That App Engine Applications Enforce HTTPS Connections"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, compute, virtual-machines, app-engine]
cis_id: "4.10"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.10 Ensure That App Engine Applications Enforce HTTPS Connections (Manual)

## Profile Applicability

- Level 2

## Description

In order to maintain the highest level of security all connections to an application should be secure by default.

## Rationale

Insecure HTTP connections maybe subject to eavesdropping which can expose sensitive data.

## Impact

All connections to appengine will automatically be redirected to the HTTPS endpoint ensuring that all connections are secured by TLS.

## Audit

Verify that the app.yaml file controlling the application contains a line which enforces secure connections. For example:

```yaml
handlers:
  - url: /.*
    secure: always
    redirect_http_response_code: 301
    script: auto
```

Reference: https://cloud.google.com/appengine/docs/standard/python3/config/appref

## Remediation

Add a line to the app.yaml file controlling the application which enforces secure connections. For example:

```yaml
handlers:
- url: /.*
  **secure: always**
  redirect_http_response_code: 301
  script: auto
```

Reference: https://cloud.google.com/appengine/docs/standard/python3/config/appref

## Default Value

By default both HTTP and HTTP are supported.

## References

1. https://cloud.google.com/appengine/docs/standard/python3/config/appref
2. https://cloud.google.com/appengine/docs/flexible/nodejs/configuring-your-app-with-app-yaml

## CIS Controls

| Controls Version | Control                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit                                        |      | X    | X    |
| v8               | 16.11 Leverage Vetted Modules or Services for Application Security Components |      | X    | X    |
| v7               | 18.5 Use Only Standardized and Extensively Reviewed Encryption Algorithms     |      | X    | X    |
