---
name: cis-ubuntu2004-v300-3-3-1
description: "Ensure ip forwarding is disabled"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, kernel-parameter]
cis_id: "3.3.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.3.1 Ensure ip forwarding is disabled (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The `net.ipv4.ip_forward` and `net.ipv6.conf.all.forwarding` flags are used to tell the system whether it can forward packets or not.

## Rationale

Setting `net.ipv4.ip_forward` and `net.ipv6.conf.all.forwarding` to 0 ensures that a system with multiple interfaces (for example, a hard proxy), will never be able to forward packets, and therefore, never serve as a router.

## Impact

IP forwarding is required on systems configured to act as a router. If these parameters are disabled, the system will not be able to perform as a router.

Many Cloud Service Provider (CSP) hosted systems require IP forwarding to be enabled. If the system is running on a CSP platform, this requirement should be reviewed before disabling IP forwarding.

## Audit Procedure

### Command Line

Run the following script to verify the following kernel parameters are set in the running configuration and correctly loaded from a kernel parameter configuration file:

- `net.ipv4.ip_forward` is set to 0
- `net.ipv6.conf.all.forwarding` is set to 0

Note:

- kernel parameters are loaded by file and parameter order precedence. The following script observes this precedence as part of the auditing procedure. The parameters being checked may be set correctly in a file. If that file is superseded, the parameter is overridden by an incorrect setting later in that file, or in a canonically later file, that "correct" setting will be ignored both by the script and by the system during a normal kernel parameter load sequence.
- IPv6 kernel parameters only apply to systems where IPv6 is enabled

```bash
#!/usr/bin/env bash

{
  a_output=(); a_output2=(); l_ipv6_disabled=""
  l_systemdsysctl="$(readlink -f /lib/systemd/systemd-sysctl || readlink -f /usr/lib/systemd/systemd-sysctl)"
  a_parlist=("net.ipv4.ip_forward=0" "net.ipv6.conf.all.forwarding=0")
  l_ufwscf="$([ -f /etc/default/ufw ] && awk -F= '/^\s*IPT_SYSCTL=/ {print $2}' /etc/default/ufw)"
  f_ipv6_chk()
  {
      l_ipv6_disabled="no"
      ! grep -Pqs -- '^\h*0\b' /sys/module/ipv6/parameters/disable && l_ipv6_disabled="yes"
      if sysctl net.ipv6.conf.all.disable_ipv6 | grep -Pqs --
"^\h*net\.ipv6\.conf\.all\.disable_ipv6\h*=\h*1\b" && \
          sysctl net.ipv6.conf.default.disable_ipv6 | grep -Pqs --
"^\h*net\.ipv6\.conf\.default\.disable_ipv6\h*=\h*1\b"; then
          l_ipv6_disabled="yes"
      fi
  }
  f_kernel_parameter_chk()
  {
      l_running_parameter_value="$(sysctl "$l_parameter_name" | awk -F= '{print $2}' | xargs)" # Check running configuration
      if grep -Pq -- '\b'"$l_parameter_value"'\b' <<< "$l_running_parameter_value"; then
          a_output+=(" - \"$l_parameter_name\" is correctly set to \"$l_running_parameter_value\""
"    in the running configuration")
      else
          a_output2+=(" - \"$l_parameter_name\" is incorrectly set to \"$l_running_parameter_value\"" \
"    in the running configuration" \
"    and should have a value of: \"$l_value_out\"")
      fi
      unset A_out; declare -A A_out # Check durable setting (files)
      while read -r l_out; do
          if [ -n "$l_out" ]; then
              if [[ $l_out =~ ^\s*# ]]; then
                  l_file="${l_out// /}"
              else
                  l_kpar="$(awk -F= '{print $1}' <<< "$l_out" | xargs)"
                  [ "$l_kpar" = "$l_parameter_name" ] && A_out+=(["$l_kpar"]="$l_file")
              fi
          fi
      done < <("$l_systemdsysctl" --cat-config | grep -Po '^\h*([^#\n\r]+|#\h*\/[^#\n\r\h]+\.conf\b)')
      if [ -n "$l_ufwscf" ]; then # Account for systems with UFW (Not covered by systemd-sysctl --cat-config)
          l_kpar="$(grep -Po "^\h*$l_parameter_name\b" "$l_ufwscf" | xargs)"
          l_kpar="${l_kpar//\//.}"
          [ "$l_kpar" = "$l_parameter_name" ] && A_out+=(["$l_kpar"]="$l_ufwscf")
      fi
      if (( ${#A_out[@]} > 0 )); then # Assess output from files and generate output
          while IFS="=" read -r l_fkpname l_file_parameter_value; do
              l_fkpname="${l_fkpname// /}"; l_file_parameter_value="${l_file_parameter_value// /}"
              if grep -Pq -- '\b'"$l_parameter_value"'\b' <<< "$l_file_parameter_value"; then
                  a_output+=(" - \"$l_parameter_name\" is correctly set to \"$l_file_parameter_value\"" \
"    in \"$(printf '%s' "${A_out[@]}")\"")
              else
                  a_output2+=(" - \"$l_parameter_name\" is incorrectly set to \"$l_file_parameter_value\"" \
"    in \"$(printf '%s' "${A_out[@]}")\"" \
"    and should have a value of: \"$l_value_out\"")
              fi
          done < <(grep -Po -- "^\h*$l_parameter_name\h*=\h*\H+" "${A_out[@]}")
      else
          a_output2+=(" - \"$l_parameter_name\" is not set in an included file" \
"    ** Note: \"$l_parameter_name\" May be set in a file that's ignored by load procedure **")
      fi
  }
  while IFS="=" read -r l_parameter_name l_parameter_value; do # Assess and check parameters
      l_parameter_name="${l_parameter_name// /}"; l_parameter_value="${l_parameter_value// /}"
      l_value_out="${l_parameter_value//\-/ through }"; l_value_out="${l_value_out//|/ or }"
      l_value_out="$(tr -d '(){}' <<< "$l_value_out")"
      if grep -q '^net.ipv6.' <<< "$l_parameter_name"; then
          [ -z "$l_ipv6_disabled" ] && f_ipv6_chk
          if [ "$l_ipv6_disabled" = "yes" ]; then
              a_output+=(" - IPv6 is disabled on the system, \"$l_parameter_name\" is not applicable")
          else
              f_kernel_parameter_chk
          fi
      else
          f_kernel_parameter_chk
      fi
  done < <(printf '%s\n' "${a_parlist[@]}")
  if [ "${#a_output2[@]}" -le 0 ]; then
      printf '%s\n' "" "- Audit Result:" "  ** PASS **" "${a_output[@]}" ""
  else
      printf '%s\n' "" "- Audit Result:" "  ** FAIL **" " - Reason(s) for audit failure:" "${a_output2[@]}"
      [ "${#a_output[@]}" -gt 0 ] && printf '%s\n' "" "- Correctly set:" "${a_output[@]}" ""
  fi
}
```

## Expected Result

Audit Result: ** PASS ** with `net.ipv4.ip_forward` set to 0 and `net.ipv6.conf.all.forwarding` set to 0 (or IPv6 disabled).

## Remediation

### Command Line

Set the following parameter in `/etc/sysctl.conf` or a file in `/etc/sysctl.d/` ending in `.conf`:

- `net.ipv4.ip_forward = 0`

Example:

```bash
# printf '%s\n' "net.ipv4.ip_forward = 0" >> /etc/sysctl.d/60-netipv4_sysctl.conf
```

Run the following script to set the active kernel parameters:

```bash
#!/usr/bin/env bash

{
  sysctl -w net.ipv4.ip_forward=0
  sysctl -w net.ipv4.route.flush=1
}
```

- IF - IPv6 is enabled on the system:
Set the following parameter in `/etc/sysctl.conf` or a file in `/etc/sysctl.d/` ending in `.conf`:

- `net.ipv6.conf.all.forwarding = 0`

Example:

```bash
# printf '%s\n' "net.ipv6.conf.all.forwarding = 0" >> /etc/sysctl.d/60-netipv6_sysctl.conf
```

Run the following script to set the active kernel parameters:

```bash
#!/usr/bin/env bash

{
  sysctl -w net.ipv6.conf.all.forwarding=0
  sysctl -w net.ipv6.route.flush=1
}
```

Note: If these settings appear in a canonically later file, or later in the same file, these settings will be overwritten.

## Default Value

net.ipv4.ip_forward = 0

net.ipv6.conf.all.forwarding = 0

## References

1. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5
2. NIST SP 800-53A :: CM-6.1 (iv)
3. RHEL 8 STIG Vul ID: V-230540
4. RHEL 8 STIG Rule ID: SV-230540r858810

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |
