---
name: cis-tomcat101-10.1
description: "Ensure Web content directory is on a separate partition from the Tomcat system files (Manual)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, hardening]
cis_id: "10.1"
cis_benchmark: "CIS Apache Tomcat 10.1 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.1 Ensure Web content directory is on a separate partition from the Tomcat system files (Manual)

## Description

Store web content on a separate partition from Tomcat system files.

## Rationale

The web document directory is where the files which are served to the end user reside. In the past, directory traversal exploits have allowed malicious users to wreak havoc on a web server including executing code, uploading files, and reading sensitive data. Even if you do not have any directory traversal exploits in your server or code at this time, that doesn't mean they won't be introduced in the future. Moving your web document directory onto a different partition will prevent these kinds of attacks from doing more damage to other parts of the file system.

## Audit Procedure

Locate the Tomcat system files and web content directory. Review the system partitions and ensure the system files and web content directory are on separate partitions.

```
# df $CATALINA_HOME/webapps
# df $CATALINA_HOME
```

Note: Use the default value `webapps` which is defined by `appBase` attribute here.

## Remediation

Move the web content files to a separate partition from the tomcat system files and update your configuration.

## Default Value

Not Applicable

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4.6 Securely Manage Enterprise Assets and Software<br>Securely manage enterprise assets and software. Example implementations include managing configuration through version-controlled-infrastructure-as-code and accessing administrative interfaces over secure network protocols, such as Secure Shell (SSH) and Hypertext Transfer Protocol Secure (HTTPS). Do not use insecure management protocols, such as Telnet (Teletype Network) and HTTP, unless operationally essential. | ● | ● | ● |
| v7 | 2.10 Physically or Logically Segregate High Risk Applications<br>Physically or logically segregated systems should be used to isolate and run software that is required for business operations but incur higher risk for the organization. | | | ● |

## Profile

Level 1
