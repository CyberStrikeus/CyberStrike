# Tech-Stack Coverage Gap — deterministic tech-specific testing

**Status:** analysis / planning (2026-09-19)
**Context:** We fingerprint tech stacks well, but a detected stack rarely turns into a
*deterministic* test. The IIS 8.3 short-name (tilde `~`) enumeration is the canonical example:
the IIS playbook literally says "Test IIS tilde (~) short-name enumeration", but **no code performs
it** — it is only an English directive handed to an LLM specialist. This document lists, per stack,
what deterministic checks *should* exist and what actually exists today.

## The two layers of coverage

1. **Fingerprint** — do we detect the stack? (Vortex `packages/vortex/src/rules/*.ts` + ingest
   `TechnologyDetector` + client `FrameworkFingerprinter`.) Mostly **yes**.
2. **Execution** — once detected, how is the stack-specific vuln actually tested?
   - 🟢 **TOOL** — a deterministic Vortex rule / attack-script / tool runs the check.
   - 🟡 **LLM-only** — a `TechPlaybook` directive is injected into the specialist prompt; execution
     depends entirely on LLM initiative (non-deterministic, may be skipped).
   - 🔴 **NONE** — fingerprinted but no playbook entry and no tool → detection produces *nothing*.

**Headline finding:** across every stack, the execution layer is 🟡 or 🔴. There is **not a single
deterministic tech-specific exploit/probe tool** in the pipeline. The only deterministic vuln rules
are *generic* (exposed-file misconfig catching `.env`/`.git`/`web.config`/`.bak`, IDOR, access,
CVE-fingerprint packs) — none are driven by the detected stack.

**Reference catalog:** the external `infra-security` MCP server already implements ~110 of exactly
these deterministic checks (grouped by provider). The CyberStrike codebase does **not** reference or
call it (`rg "infra-security" packages/` = 0). It is the natural "what good looks like" reference and
a candidate integration source. Tool names below in `code font` are the existing infra-security tool
that would cover the gap.

---

## A. Application frameworks — 🟡 have a playbook directive, 🔴 zero deterministic tools

All 14 have a `TechPlaybook` entry (`tech-playbook.ts`) = 🟡 LLM-only. None have a tool.

| Stack | Deterministic techniques that SHOULD be tools | Today | infra-security ref |
|-------|-----------------------------------------------|-------|--------------------|
| **Microsoft IIS** | 8.3 tilde/short-name enum (`/a*~1*/.aspx` diff), WebDAV methods (PROPFIND/PUT), web.config disclosure, ASP.NET debug | 🟡 directive only | `iis_tilde_enum`, `iis_webconfig_leak`, `iis_auth_bypass`, `iis_aspnet_debug`, `iis_version_detect` |
| **ASP.NET / .NET** | ViewState unsigned/known-MachineKey deserialization, `trace.axd`, `elmah.axd`, Telerik WebResource.axd, Blazor debug | 🟡 directive only | `dotnet_viewstate_check`, `dotnet_trace_enabled`, `dotnet_elmah_exposure`, `dotnet_blazor_debug` |
| **Spring Boot** | `/actuator/*` unauth probe (env/heapdump/mappings), SpEL injection, Cloud Gateway RCE, boot misconfig | 🟡 directive only | `spring_actuator_scan`, `spring_spel_injection`, `spring_cloud_gateway`, `spring_boot_misconfig` |
| **Apache Tomcat** | Manager/host-manager default creds → WAR-deploy RCE, Ghostcat (CVE-2020-1938 AJP), examples servlets | 🟡 directive only | `tomcat_manager_exposure`, `tomcat_war_deploy`, `tomcat_ghostcat`, `tomcat_examples` |
| **PHP** | Type juggling (`==`/magic hashes), LFI/RFI, phpinfo exposure, debug exposure, disable_functions bypass | 🟡 (no PHP playbook entry!) → really 🔴 | `php_type_juggle`, `php_file_inclusion`, `php_info_exposure`, `php_debug_exposure` |
| **Express / Node** | Prototype pollution (`__proto__` in JSON), env leak, `--inspect` debug port, path traversal, express misconfig | 🟡 directive only | `node_prototype_pollution`, `node_env_leak`, `node_debug_port`, `node_path_traversal`, `node_express_misconfig` |
| **Ruby on Rails** | Mass assignment, `/rails/info/*`, debug mode, secret_key_base leak, asset-path exposure, Marshal/YAML deser | 🟡 directive only | `rails_mass_assignment`, `rails_debug_mode`, `rails_secret_leak`, `rails_asset_exposure` |
| **Laravel** | `/_ignition` debug RCE (CVE-2021-3129), `/telescope`, `.env` exposure | 🟡 directive only | (via `php_*` + generic env rule) |
| **Django** | `DEBUG=True` error-page leak (SECRET_KEY/SQL), `/admin/`, debug toolbar | 🟡 directive only | — |
| **Flask / Werkzeug** | Werkzeug debugger PIN console RCE, SSTI (`{{7*7}}`), debug exposure | 🟡 directive only | — |
| **Next.js** | Middleware auth bypass (CVE-2025-29927 `x-middleware-subrequest`), `/api/*` enum, `_next/data` prop leak | 🟡 directive only | — |
| **WordPress** | User enum (`/?author=N`, `wp-json/wp/v2/users`), xmlrpc pingback SSRF + brute-amp, plugin/theme CVE inventory | 🟡 directive only | — |
| **Drupal** | `CHANGELOG.txt` version → Drupalgeddon RCE/SQLi map, REST/JSON:API probes | 🟡 directive only | — |
| **Joomla** | Version manifest read, API config leak (CVE-2023-23752 unauth secret) | 🟡 directive only | — |
| **GraphQL** | Introspection dump, field-level authz/IDOR, batching abuse, nested-query DoS | 🟡 directive only | — |

> **Nuxt** is fingerprinted (`tech-nuxt` in `tech.ts`) but has **no playbook entry** → 🔴 detection
> produces no directive at all. Same for **PHP** (fingerprinted via `languages.ts`, no playbook entry).

---

## B. Web servers / reverse proxies — 🔴 fingerprinted but NO playbook, NO tool

`LABEL_TO_SLUG` (`tech-playbook.ts:139`) explicitly returns `undefined` for "bare web servers like
Apache/Nginx" → **no signal, no playbook, no directive**. These are fingerprinted in
`web-servers.ts` / `reverse-proxies.ts` / `load-balancers.ts` but detection is a dead end.

| Stack | Deterministic techniques that SHOULD be tools | Today | infra-security ref |
|-------|-----------------------------------------------|-------|--------------------|
| **nginx** | alias traversal, off-by-slash, `merge_slashes` bypass, config/status exposure | 🔴 fingerprint dead-ends | `nginx_alias_traversal`, `nginx_off_by_slash`, `nginx_merge_slashes`, `nginx_config_leak`, `nginx_status_exposure` |
| **Apache httpd** | CVE-2021-41773/42013 path traversal + CGI RCE, `.htaccess` bypass, `mod_proxy` SSRF, server-status | 🔴 | `apache_path_traversal`, `apache_cgi_rce`, `apache_htaccess_bypass`, `apache_mod_proxy_ssrf`, `apache_server_status` |
| **HAProxy** | request smuggling, ACL bypass, stats page exposure | 🔴 | `haproxy_request_smuggling`, `haproxy_acl_bypass`, `haproxy_stats_exposure` |
| **Envoy** | admin interface exposure, ext_authz bypass, filter bypass, info leak | 🔴 | `envoy_admin_exposure`, `envoy_ext_authz_bypass`, `envoy_filter_bypass`, `envoy_info_leak` |
| **Traefik** | dashboard/API exposure, middleware bypass, entrypoint detect | 🔴 | `traefik_dashboard`, `traefik_api_exposure`, `traefik_middleware_bypass` |
| **Caddy** | admin API exposure, config leak, auto-HTTPS abuse | 🔴 | `caddy_admin_api`, `caddy_config_leak`, `caddy_auto_https` |
| **LiteSpeed** | admin exposure, cache poisoning, `.htaccess` compat quirks | 🔴 | `litespeed_admin_exposure`, `litespeed_cache_poison`, `litespeed_htaccess_compat` |

---

## C. CDN / edge — 🔴 mostly fingerprinted, NO playbook, NO tool

| Stack | Deterministic techniques that SHOULD be tools | Today | infra-security ref |
|-------|-----------------------------------------------|-------|--------------------|
| **Cloudflare** | origin IP leak, WAF bypass, security-level probe, Workers/Turnstile detect | 🔴 | `cf_origin_leak`, `cf_waf_bypass`, `cf_security_level`, `cf_workers_detect` |
| **CloudFront** | S3 origin misconfig, origin-access bypass, signed-URL bypass, Lambda@Edge | 🔴 | `cloudfront_s3_misconfig`, `cloudfront_origin_access`, `cloudfront_signed_url_bypass`, `cloudfront_lambda_edge` |
| **Fastly** | cache poisoning, origin bypass, VCL error leak, shield detect | 🔴 | `fastly_cache_poison`, `fastly_origin_bypass`, `fastly_vcl_error` |
| **Akamai** | cache poisoning, debug headers (`Pragma: akamai-x-*`), edge config, WAF bypass | 🔴 | `akamai_cache_poison`, `akamai_debug_headers`, `akamai_waf_bypass` |

## D. Network services (out of current web scope) — 🔴 no coverage

SSH (`ssh_algo_audit`, `ssh_auth_methods`, `ssh_key_enum`), RDP (`rdp_bluekeep_check`,
`rdp_nla_check`), OpenVPN, WireGuard — infra-security has probes; CyberStrike web pipeline has none.
Lower priority for a web-first product, listed for completeness.

---

## Why this matters (detection guarantee)

Most of these are **deterministic, low-false-positive** techniques (send a crafted request, diff the
response). Leaving them to LLM prompt initiative means:
- The check may silently not run on any given assessment → **missed vulnerabilities**, the exact
  failure mode we refuse to accept.
- Results are **non-reproducible** — two runs of the same target can differ.

The 🟢 target state: a detected stack deterministically triggers its tech-specific probes; the LLM
specialist reasons over the *results* instead of being the thing that must remember to run them.

## Integration options (to be decided)

1. **Wire infra-security MCP into the pipeline.** Map `TechPlaybook` slug → infra-security tool set;
   have the inspection dispatcher (`web-router.ts`) invoke the tools deterministically on a
   `technology` signal, feed structured results to the specialist. Fastest path to ~110 checks.
   Trade-off: adds an external MCP dependency to the core flow (free-tier fork-risk per tier policy).
2. **Native deterministic tools/rules in-repo.** Implement the highest-value probes as Vortex rules
   or attack-scripts (`packages/cyberstrike/data/scripts/`) / hackbrowser tools. Fully ownable, no
   external dep, but 110 checks is a large build — prioritize.
3. **Hybrid.** Native for the top-value, always-safe probes (IIS tilde, actuator, ViewState, nginx
   traversal, exposed admin panels); MCP for the long tail. Recommended.

## Priority (proposed, by prevalence × impact × determinism)

1. **IIS tilde/short-name enum** — the original gap; pure diff-based, high signal.
2. **Spring `/actuator/*`** — heapdump/env = instant secret leak, trivial to probe.
3. **ASP.NET ViewState / trace.axd / elmah.axd** — RCE + request-log disclosure.
4. **nginx alias traversal / off-by-slash** — extremely common, deterministic.
5. **Tomcat manager + Ghostcat** — RCE, default-cred + AJP.
6. **Apache CVE-2021-41773 path traversal + CGI RCE.**
7. **Exposed admin/dashboards** — Traefik/Envoy/Caddy/HAProxy stats, generic-izable.
8. **PHP type-juggling / LFI** (and add a PHP playbook entry — currently missing).
9. **Laravel `_ignition` / Next.js middleware bypass** — recent high-impact CVEs.
10. CDN cache-poisoning / origin-leak — higher FP, needs care.

## Immediate correctness fixes (independent of the big build)

- Add **Nuxt** and **PHP** `TechPlaybook` entries (fingerprinted but no directive today).
- Restore a **signal for bare web servers** (nginx/apache/…) so their detection isn't a dead end.
