---
name: cis-apache24-2.9
description: "Ensure the Basic and Digest Authentication Modules are Disabled"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, modules, authentication]
cis_id: "2.9"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.9 Ensure the Basic and Digest Authentication Modules are Disabled (Automated)

## Profile Applicability

- Level 1

## Description

The Apache `mod_auth_basic` and `mod_auth_digest` modules support HTTP Basic Authentication and HTTP Digest Authentication respectively. The two authentication protocols are used to restrict access to users who provide a valid user name and password.

## Rationale

Neither HTTP Basic nor HTTP Digest authentication should be used as the protocols are out dated and no longer considered secure. Disabling the modules will improve the security posture of the web server by reducing the amount of potentially vulnerable code paths exposed to the network and reducing potential for unauthorized access to files via misconfigured access controls.

In the early days of the web, Basic HTTP Authentication was considered adequate if it was only used over HTTPS, so that the credentials would not be sent in the clear. Basic authentication uses Base64 to encode the credentials which are sent with every request. Base64 encoding is of course easily reversed, and is no more secure than clear text. The issues with using Basic Auth over HTTPS is that it does not meet current security standards for protecting the login credentials and protecting the authenticated session. The following security issues plague the Basic Authentication protocol.

- The authenticated session has an indefinite length (as long as any browser window is open) and is not timed-out on the server when the session is idle.
- Application logout is required to invalidate the session on the server to limit, but in the case of Basic Authentication, there is no server-side session that can be invalidated.
- The credentials are remembered by the browser and stored in memory.
- There is no way to disable auto-complete, where the browser offers to store the passwords. Passwords in the browser can be accessed if the client system or browser become compromised.
- The credentials are more likely to be exposed since they are automatically sent with every request.
- Administrators may at times have access to the HTTP headers sent in request for the purposes of diagnosing problems and detecting attacks. Having a user's credentials in the clear in the HTTP headers, may allow a user to repudiate actions performed, because the web or system administrators also had access to the user's password.

The HTTP Digest Authentication is considered even worse than Basic Authentication because it stores the password in the clear on the server, and has the same session management issues as Basic Authentication.

## Audit

Perform the following to determine if the HTTP Basic or HTTP Digest authentication modules are enabled.

Run the `httpd` server with the `-M` option to list enabled modules:

```bash
# httpd -M | grep auth_basic_module
# httpd -M | grep auth_digest_module
```

**Note**: If the modules are correctly disabled, there will be no output when executing either of the above commands.

## Remediation

Perform either one of the following to disable the HTTP Basic or HTTP Digest authentication modules:

1. For source builds with static modules run the Apache `./configure` script without including the `mod_auth_basic` and `mod_auth_digest` in the `--enable-modules=configure` script options.
   - `$ cd $DOWNLOAD_HTTPD`
   - `$ ./configure`
2. For dynamically loaded modules comment out or remove the LoadModule directive for `mod_auth_basic`, and `mod_auth_digest` modules from the `httpd.conf` file.
   - `##LoadModule mod_auth_basic modules/mod_auth_basic.so`
   - `##LoadModule mod_auth_digest modules/mod_auth_digest.so`

## Default Value

The `mod_auth_basic` and `mod_auth_digest` modules are not enabled with a default source build.

## References

1. https://httpd.apache.org/docs/2.4/mod/mod_auth_basic.html
2. https://httpd.apache.org/docs/2.4/mod/mod_auth_digest.html

## CIS Controls

- v8: 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
- v7: 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile

- Level 1
