"""Distinct framing, identity and admission failures in the sample-bit oracle."""

import importlib.util
from pathlib import Path
import struct
import tempfile
import tracemalloc
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location(
    'signal_oracle', Path(__file__).with_name('signal-oracle.py'))
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)


class SignalOracleTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)
        self.path = Path(self.root.name) / 'sample.sr'

    def recording(self, data, unit, channels, chunk='logic-1', extra=0):
        metadata = '[global]\nsigrok version=0.3.0\n[device 1]\ncapturefile=logic-1\n'
        metadata += f'total probes={len(channels)}\nsamplerate=1 MHz\nunitsize={unit}\n'
        metadata += ''.join(f'probe{index+1}={name}\n' for index, name in enumerate(channels))
        with zipfile.ZipFile(self.path, 'w') as archive:
            archive.writestr('version', '2')
            archive.writestr('metadata', metadata)
            archive.writestr(chunk, data)
            for index in range(extra):
                archive.writestr(f'extra-{index}', '')

    def test_uart_rearms_after_stop_sample_for_a_slightly_faster_sender(self):
        levels = [1] * 100
        for byte in [0x48, 0x65]:
            for bit in [0, *[(byte >> index) & 1 for index in range(8)], 1]:
                levels.extend([bit] * 17)
        levels.extend([1] * 100)
        data = b''.join(struct.pack('<H', (1-level) << 1) for level in levels)
        self.recording(data, 2, ['unused', 'MAX3232E DOUT1'])
        result = oracle.uart(self.path, True)
        self.assertEqual([row['byte'] for row in result['rows']], [0x48, 0x65])
        self.assertEqual(result['channels']['MAX3232E DOUT1'], 1)
        for row, start in zip(result['rows'], [100, 270]):
            self.assertEqual(row['first_data_sample'], start + 26)
            self.assertEqual(row['last_data_sample'], start + 147)

    def i2c_levels(self, incomplete=False):
        states = [(1, 1), (1, 0)]
        for byte, ack in [(0xA5, 0), (0x75, 1)]:
            values = [(byte >> index) & 1 for index in reversed(range(8))] + [ack]
            if incomplete and byte == 0x75:
                values = values[:4]
            for bit in values:
                states.extend([(0, bit), (1, bit)])
        states.extend([(0, 0), (1, 0), (1, 1)])
        return bytes(clock | data << 1 for clock, data in states)

    def test_i2c_stop_setup_is_distinct_from_another_data_byte(self):
        self.recording(self.i2c_levels(), 1, ['SCL', 'SDA'])
        result = oracle.i2c(self.path)
        self.assertEqual(len(result['reads']), 1)
        self.assertEqual([row['byte'] for row in result['reads'][0]['bytes']], [0xA5, 0x75])
        self.assertFalse(result['reads'][0]['bytes'][-1]['ack'])

    def test_incomplete_i2c_byte_is_not_invented_at_stop(self):
        self.recording(self.i2c_levels(incomplete=True), 1, ['SCL', 'SDA'])
        with self.assertRaisesRegex(ValueError, 'Incomplete I2C byte'):
            oracle.i2c(self.path)

    def test_channel_names_must_identify_one_stored_bit(self):
        self.recording(b'\x00', 1, ['SCL', 'SCL'])
        with self.assertRaisesRegex(ValueError, 'ambiguous'):
            oracle.read_edges(self.path, ['SCL'])

    def test_missing_chunk_is_not_renumbered(self):
        self.recording(b'\x00', 1, ['SCL', 'SDA'], chunk='logic-1-2')
        with self.assertRaisesRegex(ValueError, 'chunk order'):
            oracle.read_edges(self.path, ['SCL', 'SDA'])

    def test_partial_sample_word_is_rejected(self):
        self.recording(b'\x00', 2, ['unused', 'MAX3232E DOUT1'])
        with self.assertRaisesRegex(ValueError, 'incomplete digital samples'):
            oracle.read_edges(self.path, ['MAX3232E DOUT1'])

    def test_directory_budget_precedes_zip_object_allocation(self):
        self.recording(b'\x00', 1, ['SCL', 'SDA'], extra=62)
        with patch.object(oracle.zipfile, 'ZipFile', side_effect=AssertionError('Too late')):
            with self.assertRaisesRegex(ValueError, 'excessive ZIP directory'):
                oracle.read_edges(self.path, ['SCL', 'SDA'])

    def test_declared_expansion_is_rejected_before_decompression(self):
        self.recording(b'\x00', 1, ['SCL', 'SDA'])
        data = bytearray(self.path.read_bytes())
        directory = data.index(b'PK\x01\x02')
        struct.pack_into('<I', data, directory + 24, 32 * 1024 * 1024 + 1)
        self.path.write_bytes(data)
        with self.assertRaisesRegex(ValueError, 'Expanded SR input'):
            oracle.read_edges(self.path, ['SCL', 'SDA'])

    def test_forged_member_count_cannot_allocate_extra_zip_objects(self):
        self.recording(b'\x00', 1, ['SCL', 'SDA'], extra=62)
        data = bytearray(self.path.read_bytes())
        end = data.rfind(b'PK\x05\x06')
        struct.pack_into('<2H', data, end + 8, 1, 1)
        self.path.write_bytes(data)
        with patch.object(oracle.zipfile, 'ZipFile', side_effect=AssertionError('Too late')):
            with self.assertRaisesRegex(ValueError, 'actual ZIP directory'):
                oracle.read_edges(self.path, ['SCL', 'SDA'])

    def test_zip64_locator_cannot_override_the_classic_budget(self):
        self.recording(b'\x00', 1, ['SCL', 'SDA'])
        data = bytearray(self.path.read_bytes())
        end = data.rfind(b'PK\x05\x06')
        # Syntactically complete ZIP64 directory/locator before a classic EOCD.
        header = struct.unpack_from('<4s4H2IH', data, end)
        record = struct.pack('<4sQ2H2I4Q', b'PK\x06\x06', 44, 45, 45, 0, 0,
                             header[4], header[4], 100000000, header[6])
        locator = struct.pack('<4sIQI', b'PK\x06\x07', 0, end, 1)
        data[end:end] = record + locator
        self.path.write_bytes(data)
        with patch.object(oracle.zipfile, 'ZipFile', side_effect=AssertionError('Too late')):
            with self.assertRaisesRegex(ValueError, 'ZIP64 directory'):
                oracle.read_edges(self.path, ['SCL', 'SDA'])

    def test_forged_metadata_size_cannot_expand_past_its_output_budget(self):
        # Stream the malformed member so constructing the fixture is bounded.
        with zipfile.ZipFile(self.path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            with archive.open('metadata', 'w') as member:
                for _ in range(128):
                    member.write(b'X' * 65536)
        data = bytearray(self.path.read_bytes())
        directory = data.index(b'PK\x01\x02')
        struct.pack_into('<I', data, directory + 24, 8192)
        self.path.write_bytes(data)
        tracemalloc.start()
        try:
            with self.assertRaises(zipfile.BadZipFile):
                oracle.read_edges(self.path, ['SCL', 'SDA'])
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        self.assertLess(peak, 1024 * 1024, 'Metadata allocation followed forged ZIP expansion')


if __name__ == '__main__':
    unittest.main()
