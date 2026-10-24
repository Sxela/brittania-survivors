"""Read Classic UOP flags 0/1/3; flag 3 is zlib plus UO's BWT/MTF codec.

Format corroboration: ClassicUO.Utility/BwtDecompress.cs and GumpsLoader.cs,
https://github.com/ClassicUO/ClassicUO (BSD-2-Clause). This independent Python
decoder preserves the trailing zero sentinel used by that implementation.
"""
from __future__ import annotations
import struct
import zlib


def decompress_bwt(data: bytes) -> bytes:
    if len(data) < 1029:
        raise ValueError('Truncated Classic BWT stream')
    # Four reserved header bytes precede move-to-front encoded symbols. The
    # final encoded byte is a sentinel, not processed by the native decoder.
    table = list(range(256))
    transformed = bytearray(len(data)-4)
    for i, index in enumerate(data[4:-1]):
        symbol = table[index]
        if index:
            table.pop(index)
            table.insert(0, symbol)
        transformed[i] = symbol
    counts = list(struct.unpack_from('<256I', transformed))
    size = sum(counts)
    if not 0 <= size <= 128*1024*1024:
        raise ValueError('Invalid Classic BWT output size')
    if 1024+size > len(transformed):
        raise ValueError('Truncated Classic BWT symbol lists')
    symbols = list(range(256))
    ranked = sorted((i for i, n in enumerate(counts) if n), key=lambda i: (-counts[i], i))
    positions = [0]*256
    limits = [0]*256
    cursor = 0
    for symbol in ranked:
        symbols[transformed[1024+cursor]] = symbol
        positions[symbol] = cursor+1
        cursor += counts[symbol]
        limits[symbol] = cursor
    active = len(ranked)
    value = symbols[0]
    result = bytearray(size)
    for i in range(size):
        result[i] = value
        if positions[value] >= limits[value]:
            previous = active
            active -= 1
            if previous > 0:
                symbols[:active] = symbols[1:active+1]
                value = symbols[0]
        else:
            index = transformed[1024+positions[value]]
            positions[value] += 1
            if index:
                symbols[:index] = symbols[1:index+1]
                symbols[index] = value
                value = symbols[0]
    return bytes(result)


def read_classic_entry(package, entry) -> bytes:
    offset, header, compressed_size, raw_size, _, _, flag = entry
    package.file.seek(offset+header)
    data = package.file.read(compressed_size)
    if len(data) != compressed_size:
        raise ValueError('Truncated Classic UOP entry')
    if flag in (1, 3):
        data = zlib.decompress(data)
    elif flag != 0:
        raise ValueError(f'Unsupported Classic UOP compression {flag}')
    if len(data) != raw_size:
        raise ValueError('Classic UOP inflated size mismatch')
    return decompress_bwt(data) if flag == 3 else data
