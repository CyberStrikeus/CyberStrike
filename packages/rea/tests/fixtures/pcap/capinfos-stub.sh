#!/bin/sh
# POSIX capinfos stub (mirrors capinfos-stub.cmd for Windows parity).
if [ "$1" = "--version" ]; then printf 'Capinfos (Wireshark) 4.6.6-posix-stub\n'; exit 0; fi
[ "$1" = "-M" ] && [ "$2" = "-S" ] && [ "$3" = "--" ] && [ "$#" = "4" ] || exit 2
printf '%s\n' 'File name:           capture.pcap'
printf '%s\n' 'File type:           Wireshark/tcpdump/... - pcap'
printf '%s\n' 'File encapsulation:  Ethernet'
printf '%s\n' 'Packet size limit:   file hdr: 262144 bytes'
printf '%s\n' 'Number of packets:   3'
printf '%s\n' 'Capture duration:    0.123 seconds'
printf '%s\n' 'Earliest packet time: 1791728020.608505'
printf '%s\n' 'Latest packet time:   1791728020.981978'
exit 0
