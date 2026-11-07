# DNS producer recordings

`dns-raw-tree.json` and `dns-family-tree.json` retain protocol trees from
actual official Wireshark 4.4.19 TShark output on generated, offline captures.
They contain no external network traffic. The projection keeps `frame`, the
DNS-family protocol tree and its corresponding raw tuple unchanged.

The first capture has two UDP responses whose displayed `a.b.example` names
have different wire labels (`a.b` / `example` versus `a` / `b` / `example`),
the same two responses in one TCP frame, and one response reassembled from two
TCP segments. Each response contains one compressed-owner IN A answer,
`192.0.2.9`.

The family capture has three IPv4 UDP responses, using source and destination
ports 53, 5353 and 5355 respectively. Each has ID 1, 2 or 3, flags `0x8180`,
one IN A question for `a.example`, and one compressed-owner IN A answer with
TTL 60 and address `192.0.2.9`. The mDNS answer class is `0x8001` (cache flush);
the other classes are `0x0001`.

The verified family acquisition command is:

```sh
tshark -n -r dns-family.pcap -T json -x --no-duplicate-keys \
  -Y 'dns || mdns || llmnr' -J 'frame dns mdns llmnr'
```

The three family names identify separate protocol trees and raw tuples;
all three trees expose child fields named `dns.*`. Filtering only `dns`
omits mDNS and LLMNR. Lowercase `-j` filters nested question/answer trees;
uppercase `-J` includes them.
