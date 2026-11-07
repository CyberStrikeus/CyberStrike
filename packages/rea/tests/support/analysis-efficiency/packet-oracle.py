"""Independent, narrow oracle for the three pinned Ethernet/IPv4 PCAPs.

Reads header bytes, not TShark output. No PCAPNG, IP fragmentation or TCP
reassembly support is claimed. DNS compression follows RFC 1035; DHCP options
53/54 follow RFC 2132. Unsupported selected traffic fails rather than guessing.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def packets(data):
    require(len(data) >= 24, 'truncated PCAP header')
    magic = data[:4]
    require(magic in (b'\xd4\xc3\xb2\xa1', b'\xa1\xb2\xc3\xd4'),
            'oracle requires microsecond classic PCAP')
    endian = '<' if magic == b'\xd4\xc3\xb2\xa1' else '>'
    require(struct.unpack_from(endian + 'HH', data, 4) == (2, 4),
            'unsupported PCAP version')
    require(struct.unpack_from(endian + 'I', data, 20)[0] == 1,
            'oracle requires Ethernet')
    offset, frame = 24, 0
    while offset < len(data):
        require(offset + 16 <= len(data), 'truncated PCAP record header')
        captured, original = struct.unpack_from(endian + 'II', data, offset + 8)
        offset += 16
        require(captured <= original and offset + captured <= len(data),
                'invalid captured packet length')
        frame += 1
        yield frame, data[offset:offset + captured]
        offset += captured


def transport(packet):
    require(len(packet) >= 14, 'truncated Ethernet header')
    if packet[12:14] == b'\x08\x06':
        return None  # ARP cannot contain the selected TCP/UDP messages.
    require(packet[12:14] == b'\x08\x00', 'unsupported Ethernet protocol')
    ip = packet[14:]
    require(len(ip) >= 20 and ip[0] >> 4 == 4, 'invalid IPv4 header')
    header = (ip[0] & 15) * 4
    total = struct.unpack_from('!H', ip, 2)[0]
    require(20 <= header <= len(ip) and total >= header, 'invalid IPv4 lengths')
    require(total <= len(ip), 'truncated IPv4 packet')
    require(struct.unpack_from('!H', ip, 6)[0] & 0x3fff == 0,
            'fragmentation is outside oracle scope')
    return ip[9], ip[header:min(total, len(ip))]


def dns_name(message, offset):
    labels, visited, end = [], set(), None
    while True:
        require(offset < len(message) and offset not in visited,
                'invalid DNS name or compression cycle')
        visited.add(offset)
        size = message[offset]
        if size & 0xc0 == 0xc0:
            require(offset + 1 < len(message), 'truncated DNS compression pointer')
            if end is None:
                end = offset + 2
            offset = ((size & 0x3f) << 8) | message[offset + 1]
            continue
        require(size & 0xc0 == 0 and offset + 1 + size <= len(message),
                'invalid DNS label')
        offset += 1
        if size == 0:
            return '.'.join(labels), end if end is not None else offset
        labels.append(message[offset:offset + size].decode('ascii'))
        require(sum(len(label) + 1 for label in labels) <= 255,
                'DNS name exceeds protocol length')
        offset += size


def dhcp_options(payload):
    require(len(payload) >= 240 and payload[236:240] == b'\x63\x82\x53\x63',
            'invalid DHCP fixed header or cookie')
    options, offset = {}, 240
    while offset < len(payload):
        kind = payload[offset]
        offset += 1
        if kind == 255:
            return options
        if kind == 0:
            continue
        require(offset < len(payload), 'missing DHCP option length')
        size = payload[offset]
        offset += 1
        require(offset + size <= len(payload), 'truncated DHCP option')
        require(kind not in options, 'duplicate DHCP options outside oracle scope')
        options[kind] = payload[offset:offset + size]
        offset += size
    raise ValueError('DHCP end option missing')


def analyze(data, kind, row_limit=12):
    rows, matching, count = [], 0, 0
    for frame, packet in packets(data):
        count = frame
        decoded = transport(packet)
        if decoded is None:
            continue
        protocol, segment = decoded
        if kind == 'postgres' and protocol == 6 and frame <= 2000:
            require(len(segment) >= 20, 'truncated TCP header')
            tcp_header = (segment[12] >> 4) * 4
            require(20 <= tcp_header <= len(segment), 'invalid or truncated TCP header/options')
            source, destination = struct.unpack_from('!HH', segment)
            if 5432 not in (source, destination):
                continue
            matching += 1
            if len(rows) < row_limit:
                rows.append({'frame': frame, 'source_port': source,
                             'destination_port': destination,
                             'flags': struct.unpack_from('!H', segment, 12)[0] & 0xfff})
        elif kind in ('dns', 'dhcp') and protocol == 17:
            require(len(segment) >= 8, 'truncated UDP header')
            source, destination, length = struct.unpack_from('!HHH', segment)
            selected = 53 in (source, destination) if kind == 'dns' else (
                source, destination) in ((67, 68), (68, 67))
            if not selected:
                continue
            require(8 <= length <= len(segment), 'truncated selected UDP message')
            payload = segment[8:length]
            if kind == 'dns':
                require(len(payload) >= 12, 'truncated DNS header')
                identifier, flags, questions = struct.unpack_from('!HHH', payload)
                if not flags & 0x8000 or flags & 15 == 0:
                    continue
                matching += 1
                offset, names, types = 12, [], []
                for _ in range(questions):
                    name, offset = dns_name(payload, offset)
                    require(offset + 4 <= len(payload), 'truncated DNS question')
                    types.append(struct.unpack_from('!H', payload, offset)[0])
                    names.append(name)
                    offset += 4
                rows.append({'frame': frame, 'id': identifier, 'rcode': flags & 15,
                             'names': names, 'types': types})
            else:
                options = dhcp_options(payload)
                require(53 in options and len(options[53]) == 1,
                        'missing DHCP message type')
                server = options.get(54)
                require(server is None or len(server) == 4, 'invalid DHCP server ID')
                require(52 not in options, 'DHCP overload outside oracle scope')
                matching += 1
                row = {'frame': frame, 'id': struct.unpack_from('!I', payload, 4)[0],
                       'message_type': options[53][0],
                       'your_address': '.'.join(map(str, payload[16:20]))}
                if server is not None:
                    row['server_identifier'] = '.'.join(map(str, server))
                rows.append(row)
    return {'kind': kind, 'capture_frames': count, 'matching_packets': matching,
            'question_input_frames': min(2000, count) if kind == 'postgres' else count,
            'rows': rows, 'scope': 'selected recorded headers; no network completeness claim'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=['postgres', 'dns', 'dhcp'])
    parser.add_argument('path', type=Path)
    parser.add_argument('--row-limit', type=int, choices=[12, 24], default=12,
                        help='PostgreSQL rows; 24 independently checks the second page')
    args = parser.parse_args()
    with args.path.open('rb') as source:
        data = source.read(32 * 1024 * 1024 + 1)
    require(len(data) <= 32 * 1024 * 1024, 'oracle input budget exceeded')
    print(json.dumps({'sha256': hashlib.sha256(data).hexdigest(),
                      **analyze(data, args.kind, args.row_limit)}, indent=2))


if __name__ == '__main__':
    main()
