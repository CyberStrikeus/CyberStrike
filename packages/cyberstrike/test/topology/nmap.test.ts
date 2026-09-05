import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { NmapScan } from "../../src/topology/nmap"
import { tmpdir } from "../fixture/fixture"

const xml = (ports: string, version = "9.90") => `<?xml version="1.0"?>
<nmaprun scanner="nmap" args="nmap -sV -oX - 192.0.2.10" start="1788210000" version="${version}">
  <host starttime="1788210000" endtime="1788210002">
    <status state="up" reason="syn-ack"/>
    <address addr="192.0.2.10" addrtype="ipv4"/>
    <address addr="00:11:22:33:44:55" addrtype="mac" vendor="Example"/>
    <hostnames><hostname name="api.example.test" type="PTR"/></hostnames>
    <ports>${ports}</ports>
    <os>
      <osmatch name="Linux 5.X" accuracy="96" line="1">
        <osclass type="general purpose" vendor="Linux" osfamily="Linux" osgen="5.X" accuracy="96">
          <cpe>cpe:/o:linux:linux_kernel:5</cpe>
        </osclass>
      </osmatch>
    </os>
    <trace><hop ttl="1" ipaddr="192.0.2.1" rtt="1.2" host="gateway.example.test"/></trace>
  </host>
  <runstats>
    <finished time="1788210002" elapsed="2.0" summary="done"/>
    <hosts up="1" down="0" total="1"/>
  </runstats>
</nmaprun>`

const ssh = (version = "9.0") => `
<port protocol="tcp" portid="22">
  <state state="open" reason="syn-ack"/>
  <service name="ssh" product="OpenSSH" version="${version}" method="probed" conf="10">
    <cpe>cpe:/a:openbsd:openssh:${version}</cpe>
  </service>
  <script id="ssh-hostkey" output="fixture"/>
</port>`

const http = `
<port protocol="tcp" portid="80">
  <state state="open" reason="syn-ack"/>
  <service name="http" product="nginx" version="1.24" method="probed" conf="10"/>
</port>`

const https = `
<port protocol="tcp" portid="443">
  <state state="open" reason="syn-ack"/>
  <service name="https" product="nginx" version="1.26" method="probed" conf="10"/>
</port>`

describe("Nmap XML", () => {
  test("parses hosts, services, OS guesses, scripts, and trace", () => {
    const scan = NmapScan.parse(xml(ssh() + http))
    expect(scan.summary).toMatchObject({ scanner: "nmap", up: 1, total: 1, elapsed: 2 })
    expect(scan.hosts).toHaveLength(1)
    expect(scan.hosts[0]).toMatchObject({
      id: "192.0.2.10",
      status: "up",
      hostnames: ["api.example.test"],
    })
    expect(scan.hosts[0]?.ports.map((port) => `${port.port}/${port.protocol}`)).toEqual(["22/tcp", "80/tcp"])
    expect(scan.hosts[0]?.ports[0]?.service).toMatchObject({ name: "ssh", product: "OpenSSH", version: "9.0" })
    expect(scan.hosts[0]?.ports[0]?.scripts).toEqual([{ id: "ssh-hostkey", output: "fixture" }])
    expect(scan.hosts[0]?.os[0]).toMatchObject({ name: "Linux 5.X", accuracy: 96 })
    expect(scan.hosts[0]?.trace[0]).toMatchObject({ ttl: 1, address: "192.0.2.1", rtt: 1.2 })
  })

  test("rejects non-Nmap XML", () => {
    expect(() => NmapScan.parse("<root/>")).toThrow("not an Nmap")
  })

  test("diffs ports and service versions", () => {
    const before = {
      id: "nms_before",
      sessionID: "ses_test",
      name: "Before",
      source: "test",
      xmlHash: "before",
      time: 1,
      ...NmapScan.parse(xml(ssh() + http)),
    }
    const after = {
      id: "nms_after",
      sessionID: "ses_test",
      name: "After",
      source: "test",
      xmlHash: "after",
      time: 2,
      ...NmapScan.parse(xml(ssh("9.1") + https)),
    }
    expect(NmapScan.diff(before, after)).toEqual({
      from: "nms_before",
      to: "nms_after",
      addedHosts: [],
      removedHosts: [],
      changedHosts: [
        {
          host: "api.example.test",
          addedPorts: ["443/tcp"],
          removedPorts: ["80/tcp"],
          changedServices: ["22/tcp"],
        },
      ],
    })
  })

  test("persists scans and deduplicates identical XML", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Nmap import" })
        const first = NmapScan.add({
          sessionID: session.id,
          name: "Baseline",
          xml: xml(ssh()),
          profile: "service",
        })
        const duplicate = NmapScan.add({
          sessionID: session.id,
          name: "Duplicate",
          xml: xml(ssh()),
        })
        expect(duplicate.id).toBe(first.id)
        expect(NmapScan.scans(session.id)).toHaveLength(1)
        await Session.remove(session.id)
        await Instance.dispose()
      },
    })
  })
})
