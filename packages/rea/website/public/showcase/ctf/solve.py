#!/usr/bin/env python3
"""Solve the DownUnderCTF 2023 masked-squares handout from REA-extracted checks.

Requires Python 3 and z3-solver. The constants below were read from the original
ELF with SHA-256 dcd3bec4f608e11f3a12ce461100aaf5f621851ee63a1f870d7c90d4e3dd51ae.
Challenge by joseph / DownUnderCTF:
https://github.com/DownUnderCTF/Challenges_2023_Public/tree/b48f83db2984bc7fa2ec7879a32d7efb1be8d333/rev/masked-squares-flag-checker
"""

from z3 import Int, Or, Solver, Sum, sat

TARGETS = [1441, 2043, 1259, 2031, 1799, 746, 55, 1450, 1485, 1362, 611, 1314, 358, 1834, 1500, 1355, 2011, 1990, 1939, 1990, 278, 1859, 2111, 1510, 888, 1224]
RUNS = [
    (-5, 1, -2, 1, -1, 3, -3, 2, -1, 1, -1, 1, -1, 1, -1, 2, -3, 2, -2, 2),
    (-1, 1, -3, 2, -3, 2, -1, 1, -2, 3, -1, 1, -1, 7, -1, 3, -1, 2),
    (-1, 1, -1, 1, -1, 2, -1, 1, -6, 1, -1, 1, -2, 1, -1, 1, -1, 1, -4, 3, -1, 1, -2),
    (2, -1, 5, -3, 3, -1, 4, -1, 2, -1, 5, -3, 2, -3),
    (-1, 1, -3, 1, -1, 1, -2, 1, -1, 3, -1, 1, -1, 1, -2, 5, -1, 4, -1, 1, -3),
    (1, -2, 2, -8, 1, -7, 2, -1, 1, -3, 1, -2, 1, -4),
    (-21, 1, -14),
    (-2, 3, -4, 4, -5, 1, -2, 1, -1, 1, -2, 1, -2, 1, -1, 4, -1),
    (-4, 5, -3, 1, -5, 1, -3, 1, -2, 5, -4, 2),
    (-1, 2, -4, 1, -1, 4, -3, 1, -4, 1, -1, 2, -1, 1, -3, 1, -1, 2, -2),
    (-2, 1, -8, 1, -1, 1, -3, 1, -1, 1, -7, 1, -8),
    (1, -2, 5, -1, 1, -8, 3, -2, 1, -2, 1, -3, 1, -4, 1),
    (-3, 1, -9, 1, -2, 1, -17, 1, -1),
    (3, -5, 4, -1, 1, -2, 1, -1, 2, -3, 3, -1, 1, -1, 3, -1, 2, -1),
    (-2, 2, -3, 1, -1, 1, -1, 1, -1, 1, -7, 1, -1, 6, -1, 3, -1, 1, -1),
    (1, -5, 1, -2, 2, -1, 2, -1, 1, -1, 1, -5, 1, -1, 1, -1, 5, -4),
    (2, -3, 1, -5, 4, -2, 3, -2, 5, -1, 2, -1, 2, -1, 2),
    (-1, 1, -3, 1, -1, 2, -2, 1, -1, 7, -2, 3, -1, 4, -1, 1, -2, 1, -1),
    (2, -1, 1, -2, 2, -1, 2, -2, 5, -1, 1, -1, 2, -3, 2, -1, 1, -2, 2, -1, 1),
    (1, -3, 3, -1, 1, -2, 1, -1, 6, -1, 1, -1, 2, -2, 1, -1, 1, -1, 3, -1, 2),
    (-9, 1, -9, 1, -5, 1, -10),
    (1, -1, 2, -2, 1, -1, 9, -1, 1, -1, 1, -7, 2, -2, 1, -2, 1),
    (-1, 9, -1, 3, -1, 6, -1, 1, -1, 1, -2, 1, -3, 1, -4),
    (-2, 1, -3, 1, -1, 2, -5, 6, -1, 2, -2, 4, -1, 1, -4),
    (-2, 1, -4, 1, -1, 1, -2, 1, -3, 1, -3, 1, -3, 3, -6, 1, -2),
    (-8, 4, -2, 2, -1, 3, -5, 1, -2, 2, -1, 1, -4),
]


def decode_mask(runs):
    """Expand signed run lengths into 36 selected/unselected cells."""
    cells = [selected for run in runs for selected in [run > 0] * abs(run)]
    if len(cells) != 36:
        raise ValueError('A mask must cover all 36 input positions.')
    return [i for i, selected in enumerate(cells) if selected]


codes = [Int(f'code_{i}') for i in range(36)]
solver = Solver()
solver.set(timeout=60000)
# Analyst assumptions about a conventional flag's format and alphabet.
alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_{}'
for code in codes:
    solver.add(Or(*[code == ord(char) for char in alphabet]))
for code, char in zip(codes, 'DUCTF{'):
    solver.add(code == ord(char))
solver.add(codes[-1] == ord('}'))
for runs, target in zip(RUNS, TARGETS):
    solver.add(Sum([codes[i] for i in decode_mask(runs)]) == target)

status = solver.check()
if status != sat:
    raise SystemExit(f'No candidate returned: {status}. {solver.reason_unknown()}')
model = solver.model()
values = [model.eval(code).as_long() for code in codes]
if not all(sum(values[i] for i in decode_mask(runs)) == target
           for runs, target in zip(RUNS, TARGETS)):
    raise SystemExit('Candidate did not pass the extracted checks.')
print(''.join(map(chr, values)))
