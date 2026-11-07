import importlib.util
import struct
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('packet_oracle', Path(__file__).with_name('packet-oracle.py'))
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)


class PacketOracleTest(unittest.TestCase):
    def test_compression_pointer_preserves_question_cursor(self):
        message = b'\x03www\x07example\x03com\0' + b'\xc0\0' + b'\0\x01\0\x01'
        self.assertEqual(oracle.dns_name(message, 17), ('www.example.com', 19))

    def test_compression_cycle_and_missing_pointer_byte_fail(self):
        for message in (b'\xc0\0', b'\xc0', b'\xc0\x02\xc0\0'):
            with self.subTest(message=message), self.assertRaises(ValueError):
                oracle.dns_name(message, 0)

    def test_truncated_pcap_record_is_not_exhaustion(self):
        header = struct.pack('<IHHIIII', 0xa1b2c3d4, 2, 4, 0, 0, 65535, 1)
        with self.assertRaises(ValueError):
            list(oracle.packets(header + b'\0'))
        record = struct.pack('<IIII', 0, 0, 20, 20)
        with self.assertRaises(ValueError):
            list(oracle.packets(header + record + b'\0' * 19))

    def test_missing_dhcp_server_id_stays_omitted(self):
        payload = b'\0' * 236 + b'\x63\x82\x53\x63\x35\x01\x01\xff'
        self.assertEqual(oracle.dhcp_options(payload), {53: b'\x01'})

    def test_dhcp_duplicates_truncation_and_missing_end_fail(self):
        prefix = b'\0' * 236 + b'\x63\x82\x53\x63'
        for suffix in (b'\x35\x01\x01\x35\x01\x02\xff', b'\x36\x04\0', b'\x35\x01\x01'):
            with self.subTest(suffix=suffix), self.assertRaises(ValueError):
                oracle.dhcp_options(prefix + suffix)

    def test_fragmented_selected_traffic_cannot_pass_header_oracle(self):
        ip = bytearray(20)
        ip[0], ip[9] = 0x45, 17
        struct.pack_into('!H', ip, 2, 20)
        struct.pack_into('!H', ip, 6, 0x2000)
        with self.assertRaises(ValueError):
            oracle.transport(b'\0' * 12 + b'\x08\0' + ip)

    def test_declared_ip_length_and_tcp_options_cannot_be_truncated(self):
        ip = bytearray(40)
        ip[0], ip[9], ip[32] = 0x45, 6, 0xf0
        struct.pack_into('!H', ip, 2, 40)
        struct.pack_into('!HH', ip, 20, 12345, 5432)
        packet = b'\0' * 12 + b'\x08\0' + ip
        header = struct.pack('<IHHIIII', 0xa1b2c3d4, 2, 4, 0, 0, 65535, 1)
        record = struct.pack('<IIII', 0, 0, len(packet), len(packet))
        with self.assertRaisesRegex(ValueError, 'TCP header'):
            oracle.analyze(header + record + packet, 'postgres')
        struct.pack_into('!H', ip, 2, 60)
        with self.assertRaisesRegex(ValueError, 'truncated IPv4'):
            oracle.transport(b'\0' * 12 + b'\x08\0' + ip)

    def test_unknown_link_protocol_does_not_prove_tcp_absence(self):
        with self.assertRaisesRegex(ValueError, 'unsupported Ethernet'):
            oracle.transport(b'\0' * 12 + b'\x86\xdd' + b'\0' * 40)


if __name__ == '__main__':
    unittest.main()
