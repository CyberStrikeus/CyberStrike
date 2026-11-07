"""Run ESP-IDF's otatool against a flash dump file instead of a device.

Usage: python flash_file_tool.py IMAGE FLASH_OFFSET otatool [ARGS...]

ESP-IDF's parttool, which otatool uses, reaches flash only through
ParttoolTarget._call_esptool with esptool's read-flash, erase-region and
write-flash commands (v4 spells them with underscores). This script replaces
that one method with reads and writes of IMAGE, whose first byte is flash
address FLASH_OFFSET; otatool's own otadata logic runs unchanged. IDF_PATH
names the ESP-IDF checkout to import from.
"""

import os
import sys

IDF = os.environ['IDF_PATH']
sys.path[:0] = [
    os.path.join(IDF, 'components', 'partition_table'),
    os.path.join(IDF, 'components', 'app_update'),
]

import otatool  # noqa: E402
import parttool  # noqa: E402

IMAGE, FLASH_OFFSET = sys.argv[1], int(sys.argv[2], 0)


def _file_offset(address):
    offset = int(address, 0) - FLASH_OFFSET
    if offset < 0:
        raise SystemExit(f'flash address {address} precedes the dump')
    return offset


def _call_esptool(self, args, out=None):
    command, *rest = args
    name = command.replace('_', '-')
    with open(IMAGE, 'r+b') as flash:
        if name == 'read-flash':
            offset, size = _file_offset(rest[0]), int(rest[1], 0)
            flash.seek(offset)
            data = flash.read(size)
            with open(rest[2], 'wb') as output:
                output.write(data + b'\xff' * (size - len(data)))
        elif name == 'erase-region':
            flash.seek(_file_offset(rest[0]))
            flash.write(b'\xff' * int(rest[1], 0))
        elif name == 'write-flash':
            flash.seek(_file_offset(rest[0]))
            with open(rest[1], 'rb') as data:
                flash.write(data.read())
        else:
            raise SystemExit(f'unsupported esptool command {command}')


parttool.ParttoolTarget._call_esptool = _call_esptool

if sys.argv[3] != 'otatool':
    raise SystemExit('usage: flash_file_tool.py IMAGE FLASH_OFFSET otatool ARGS...')
sys.argv = ['otatool.py', *sys.argv[4:]]
otatool.main()
