---
name: cis-apache24-1.3
description: "Ensure Apache Is Installed From the Appropriate Binaries"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, planning, installation]
cis_id: "1.3"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.3 Ensure Apache Is Installed From the Appropriate Binaries (Manual)

## Profile Applicability

- Level 1

## Description

The CIS Apache Benchmark recommends using the Apache binary provided by your vendor for most situations in order to reduce the effort and increase the effectiveness of maintenance and security patches. However, to keep the benchmark as generic and applicable to all Unix/Linux platforms as possible, a default source build has been used for this benchmark.

**Important Note**: There is a major difference between source builds and most vendor packages that is very important to highlight. The default source build of Apache is fairly conservative and minimalist in the modules included and therefore starts off in a fairly strong security state, while most vendor binaries are typically very well loaded with most of the functionality that one may be looking for. **Therefore, it is important that you don't assume the default value shown in the benchmark will match default values in your installation.** You should always test any new installation in your environment before putting it into production. Also keep in mind you can install and run a new version alongside the old one by using a different Apache prefix and a different IP address or port number in the Listen directive.

## Rationale

The benefits of using the vendor supplied binaries include:

- Ease of installation as it will just work, straight out of the box.
- It is customized for your OS environment.
- It will be tested and have gone through QA procedures.
- Everything you need is likely to be included, probably including some third-party modules. For example, many vendors ships Apache with mod_ssl and OpenSSL, PHP, mod_perl, and ModSecurity.
- Your vendor will tell you about security issues so you have to look in fewer places.
- Updates to fix security issues will be easy to apply. The vendor will have already verified the problem, checked the signature on the Apache download, worked out the impact and so on.
- You may be able to get the updates automatically, reducing the window of risk.

## Audit

Not applicable - this is documentation/planning guidance.

## Remediation

Installation depends on the operating system platform. For a source build, consult the Apache 2.4 documentation on compiling and installing https://httpd.apache.org/docs/2.4/install.html for a Red Hat Enterprise Linux 5 or 6, the following yum command could be used.

```bash
# yum install httpd
```

## References

1. Apache Compiling and Installation https://httpd.apache.org/docs/2.4/install.html

## CIS Controls

- v8: 1.2 Address Unauthorized Assets
- v8: 2.1 Maintain Inventory of Authorized Software
- v7: 2.2 Ensure Software is Supported by Vendor

## Profile

- Level 1
