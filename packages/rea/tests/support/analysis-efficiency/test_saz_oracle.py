"""Stored-byte semantics and fail-before-allocation admission, not providers."""

import base64
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('saz_oracle', Path(__file__).with_name('saz-oracle.py'))
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)


class SazOracleTests(unittest.TestCase):
    def test_duplicate_spelling_and_folding_are_source_facts(self):
        result = oracle.stored_http(b'HTTP/1.1 200 OK\r\nX-Case: first\r\nx-case:second\r\n continuation\r\n\r\n', False)
        self.assertEqual(result['headers'], [{'name': 'X-Case', 'value': ' first'},
                                            {'name': 'x-case', 'value': 'second\r\n continuation'}])
        self.assertEqual(result['body']['bytes'], 0)
        self.assertEqual(result['body']['text'], '')

    def test_body_keeps_encoded_bytes_and_internal_separators(self):
        body = b'\x1f\x8b\xff\n\n\r\n\r\n'
        result = oracle.stored_http(b'HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\n\r\n' + body, False)
        self.assertEqual(base64.b64decode(result['body']['content_base64']), body)
        self.assertIsNone(result['body']['text'])

    def test_first_lf_separator_owns_body_with_later_crlf_separator(self):
        result = oracle.stored_http(b'GET / HTTP/1.1\nHost: example.com\n\nbody\r\n\r\n', True)
        self.assertEqual(result['body']['text'], 'body\r\n\r\n')

    def test_malformed_start_and_unowned_continuation_fail(self):
        for data in [b'garbage\r\n\r\n', b'HTTP/1.1 200 OK\r\n orphan\r\n\r\n']:
            with self.assertRaises(ValueError):
                oracle.stored_http(data, False)

    def test_wrong_digest_cannot_allocate_zip_objects(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root)/'wrong.saz'
            path.write_bytes(b'X'*43515)
            with patch.object(oracle.zipfile, 'ZipFile', side_effect=AssertionError('Too late')):
                with self.assertRaisesRegex(ValueError, 'pinned SAZ corpus'):
                    oracle.read_saz('xbox-clear_nomp.saz', path)


if __name__ == '__main__':
    unittest.main()
