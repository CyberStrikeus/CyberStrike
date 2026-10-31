"""Independent stored-HTTP facts for two immutable public Fiddler archives.

Only digest-pinned inputs are admitted before ZIP object allocation. Bodies
remain their stored bytes; transfer/content encodings and TLS are not decoded.
"""

import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import zipfile


def stored_http(data, request):
    boundaries = [(data.find(separator), separator)
                  for separator in [b'\r\n\r\n', b'\n\n']]
    available = [(index, separator) for index, separator in boundaries if index >= 0]
    if not available:
        raise ValueError('Stored message has no header/body separator')
    boundary, separator = min(available, key=lambda item: item[0])
    lines = data[:boundary].split(b'\r\n' if separator.startswith(b'\r') else b'\n')
    start = lines[0].decode('latin1')
    fields = start.split(' ')
    if request:
        if len(fields) != 3 or fields[2] not in ['HTTP/1.0', 'HTTP/1.1']:
            raise ValueError('Unsupported stored request line')
        result = dict(zip(['method', 'url', 'http_version'], fields))
    else:
        fields = start.split(' ', 2)
        if len(fields) < 2 or fields[0] not in ['HTTP/1.0', 'HTTP/1.1'] or not re.fullmatch(r'[0-9]{3}', fields[1]):
            raise ValueError('Unsupported stored response line')
        result = {'http_version': fields[0], 'status': fields[1],
                  'reason': fields[2] if len(fields) == 3 else ''}
    headers = []
    newline = '\r\n' if separator.startswith(b'\r') else '\n'
    for raw in lines[1:]:
        line = raw.decode('latin1')
        if line.startswith((' ', '\t')):
            if not headers:
                raise ValueError('Header continuation has no owning field')
            headers[-1]['value'] += newline + line
            continue
        name, delimiter, value = line.partition(':')
        if not delimiter or not name:
            raise ValueError('Stored header has no field delimiter')
        headers.append({'name': name, 'value': value})
    body = data[boundary + len(separator):]
    try:
        body_text = body.decode('utf8', errors='strict')
    except UnicodeDecodeError:
        body_text = None
    return result | {'headers': headers, 'body': {
        'content_base64': base64.b64encode(body).decode('ascii'),
        'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest(),
        'text': body_text,
    }}


def read_saz(artifact, path):
    corpus = json.loads(Path(__file__).with_name('corpus.json').read_text())
    entry = next((item for item in corpus['artifacts']
                  if item['id'] == artifact and 'saz_question' in item), None)
    if entry is None:
        raise ValueError('Select a pinned SAZ artifact')
    # Real source sizes bound the snapshot; size/digest gate ZIP allocation.
    if path.stat().st_size != entry['bytes']:
        raise ValueError('Selected file size differs from pinned SAZ corpus')
    with path.open('rb') as source:
        data = source.read(entry['bytes'] + 1)
    digest = hashlib.sha256(data).hexdigest()
    if len(data) != entry['bytes'] or digest != entry['sha256']:
        raise ValueError('Selected bytes differ from pinned SAZ corpus')
    question = entry['saz_question']
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        inventory = archive.infolist()
        if (len(inventory) != question['members'] or
                sum(item.file_size for item in inventory) != question['expanded_bytes']):
            raise ValueError('Pinned directory coverage differs')
        groups = {}
        for item in inventory:
            match = re.fullmatch(r'raw/(\d+)_(c\.txt|s\.txt|m\.xml|w\.txt|g\.txt)', item.filename)
            if match:
                groups.setdefault(match[1], []).append(item)
        if len(groups) != question['total_records']:
            raise ValueError('Pinned session coverage differs')
        ordered = list(groups.items())
        records = []
        for ordinal in question['record_ordinals']:
            session_id, members = ordered[ordinal]
            result = {'ordinal': ordinal, 'session_id': session_id,
                      'members': [item.filename for item in members],
                      'request': None, 'response': None}
            for item in members:
                side = 'request' if item.filename.endswith('_c.txt') else 'response' if item.filename.endswith('_s.txt') else None
                if side is None:
                    continue
                with archive.open(item) as source:
                    content = source.read(item.file_size + 1)
                if len(content) != item.file_size:
                    raise ValueError('Stored member size differs')
                result[side] = {'member': item.filename, **stored_http(content, side == 'request')}
            records.append(result)
    with path.open('rb') as source:
        after = source.read(entry['bytes'] + 1)
    if hashlib.sha256(after).hexdigest() != digest:
        raise ValueError('Selected archive changed during independent read')
    return {'kind': 'saz', 'artifact': artifact, 'sha256': digest,
            'total_records': len(groups), 'record_ordinals': question['record_ordinals'],
            'records': records,
            'scope': 'Stored HTTP bytes and ZIP member coordinates; no body decompression, live attribution or certificate interpretation'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('artifact')
    parser.add_argument('path', type=Path)
    args = parser.parse_args()
    print(json.dumps(read_saz(args.artifact, args.path)))
