---
name: cis-apache24-5.9
description: "Ensure Old HTTP Protocol Versions Are Disallowed"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, content, options]
cis_id: "5.9"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.9 Ensure Old HTTP Protocol Versions Are Disallowed

## Profile Applicability

- Level 1

## Description

The Apache modules `mod_rewrite` or `mod_security` can be used to disallow old and invalid HTTP protocols versions. The HTTP version 1.1 RFC is dated June 1999 and has been supported by Apache since version 1.2. It should no longer be necessary to allow ancient versions of HTTP such as 1.0 and prior.

## Rationale

Many malicious automated programs, vulnerability scanners and fingerprinting tools will send abnormal HTTP protocol versions to see how the web server responds. These requests are usually part of the attacker's enumeration process and therefore it is important that we respond by denying these requests.

## Audit

Perform the following to determine if the recommended state is implemented:

1. Locate the Apache configuration files and included configuration files.
2. Verify there is a rewrite condition within the global server context that disallows requests that do not include the HTTP/1.1 as shown below.
3. `RewriteEngine On`
4. `RewriteCond %{THE_REQUEST} !(HTTP/1\.1|HTTP/2\.0)$`
5. `RewriteRule .* - [F]`
6. Verify the following directives are included in each section so that the main server settings will be inherited.
7. `RewriteEngine On`
8. `RewriteOptions Inherit`

## Remediation

Perform the following to implement the recommended state:

1. Load the `mod_rewrite` module for Apache by doing either one of the following:
   - Build Apache with `mod_rewrite` statically loaded during the build, by adding the `--enable-rewrite` option to the `./configure` script.
   - `./configure --enable-rewrite.`
   - Or, dynamically loading the module with the `LoadModule` directive in the `httpd.conf` configuration file.
   - `LoadModule rewrite_module modules/mod_rewrite.so`
2. Set the apache2 profile to enforce mode, reload AppArmor, and then test the web site functionality again.
3. `# aa-enforce /usr/sbin/apache2`
4. `# /etc/init.d/apparmor reload`

## Default Value

The default Apache profile is very permissive.

## References

No external references provided in the PDF for this control.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 2.5 Allowlist Authorized Software<br>Use technical controls, such as application allowlisting, to ensure that only authorized software can execute or be accessed. Reassess bi-annually, or more frequently.          |      | ●    | ●    |
| v7               | 2.7 Utilize Application Whitelisting<br>Utilize application whitelisting technology on all assets to ensure that only authorized software executes and all unauthorized software is blocked from executing on assets. |      |      | ●    |

## Profile

- Level 1 | Automated
