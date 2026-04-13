---
name: cis-azure-compute-4.1
description: "Ensure SSL is configured for CycleCloud"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, cyclecloud]
cis_id: "4.1"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure SSL is configured for CycleCloud

## Description

The use of SSL ensures that data in transit to and from the Azure CycleCloud server is encrypted.

## Rationale

Encryption of data in transit provides integrity and confidentiality of that data. If unencrypted data is intercepted in transit it is highly vulnerable to exposure and exploitation.

## Impact

If using self-signed certificates, users accessing CycleCloud will receive a warning that the SSL certificate is untrusted; they will need to accept the certificate to access the web console. Depending on your environment and use of CycleCloud, you may wish to procure a signed and trusted certificate from a Certificate Authority.

## Audit Procedure

### From SSH

1. Establish a secure shell session with the Azure CycleCloud server.
2. Navigate to the CycleCloud installation directory.
3. Use a text editor (e.g. Vim, Nano, Emacs) to open the `cycle_server.properties` file.
4. Review the file for the following properties:

```
webServerEnableHttps=true
webServerRedirectHttp=true
```

Note that if these properties are defined in the file multiple times, only the **last** instance of that property definition will be in effect.

If either property is set to `false`, SSL is NOT configured for the CycleCloud server.

## Expected Result

Both `webServerEnableHttps` and `webServerRedirectHttp` should be set to `true` in the `cycle_server.properties` file.

## Remediation

### From SSH

1. Establish a secure shell session with the Azure CycleCloud server.
2. Navigate to the CycleCloud installation directory.
3. Use a text editor (e.g. Vim, Nano, Emacs) to open the `cycle_server.properties` file.
4. Edit the following properties to reflect `true`:

```
webServerEnableHttps=true
webServerRedirectHttp=true
```

5. Save and exit from the text editor.
6. Restart the CycleCloud service to enable the new property definitions:

```bash
/opt/cycle_server/cycle_server restart
```

## Default Value

By default, CycleCloud is configured to use Java IO HTTPS with a Let's Encrypt SSL certificate, or self-signed certificate.

## References

1. https://learn.microsoft.com/en-us/azure/cyclecloud/how-to/ssl-configuration?view=cyclecloud-8
2. https://learn.microsoft.com/en-us/azure/cyclecloud/concepts/security-best-practices?view=cyclecloud-8

## Profile

Level 1 | Manual
