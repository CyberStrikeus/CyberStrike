#!/bin/sh
# POSIX pcap tool stub (mirrors tshark-stub.cmd for Windows parity).
if [ "$1" = "--version" ]; then printf 'TShark (Wireshark) 4.6.6-posix-stub\n'; exit 0; fi
[ "$1" = "-n" ] && [ "$2" = "-r" ] && [ "$4" = "-T" ] && [ "$5" = "json" ] || exit 2
case " $* " in *" -x "*) printf '%s' '[{"_source":{"layers":{"frame":{"frame.number":"1"},"dns_raw":["00018180000100010000000003617069076578616d706c6503636f6d0000010001c00c000100010000003c00045db8d822",42,49,0,1],"dns":{"dns.id_raw":["0001",42,2,0,5],"Queries":{"dns.qry.name":"api.example.com"},"Answers":{"dns.a":"93.184.216.34"}}}}}]'; exit 0 ;; esac
printf '%s' '[{"_source":{"layers":{"frame.number":["1"],"frame.protocols":["eth:ethertype:ip:udp:dns"],"ip.src":["192.168.1.100"],"ip.dst":["8.8.8.8"],"dns.qry.name":["api.example.com"],"dns.flags.response":["1"],"dns.a":["93.184.216.34"]}}},{"_source":{"layers":{"frame.number":["2"],"frame.protocols":["eth:ethertype:ip:tcp:tls"],"ip.src":["192.168.1.100"],"ip.dst":["93.184.216.34"],"tls.handshake.extensions_server_name":["api.example.com"]}}},{"_source":{"layers":{"frame.number":["3"],"frame.protocols":["eth:ethertype:ip:tcp:http"],"ip.src":["192.168.1.100"],"ip.dst":["93.184.216.34"],"http.request.full_uri":["http://api.example.com/v1/data"]}}}]'
exit 0
