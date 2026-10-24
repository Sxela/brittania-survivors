"""Resolve EC mobile body art using the installed TileArt mobile definitions.

Virtual paths come from MainMisc assetmap + string_dictionary. The source body
field at byte32 is corroborated by known-body controls and mapped AMOU headers.
No client execution or installation writes occur. UOP hash word conventions
are corroborated against UltimaWorks/ultima-sdk-python and local archive keys.
"""
from __future__ import annotations
import hashlib
import struct
from pathlib import Path

def create_hash(name: str) -> int:
    """Jenkins lookup3 hash pair, using UOP's low/high word convention."""
    data = name.encode('ascii')
    mask = 0xffffffff
    def rotate(value, count):
        return ((value << count) | (value >> (32-count))) & mask
    words = [((len(data) + 0xdeadbeef) & mask)] * 3
    offset = 0
    while len(data)-offset > 12:
        for i in range(3):
            words[i] = (words[i] + int.from_bytes(data[offset+i*4:offset+i*4+4], 'little')) & mask
        for i, shift in zip((0,1,2,0,1,2), (4,6,8,16,19,4)):
            previous = (i+2)%3
            words[i] = (((words[i]-words[previous]) & mask) ^ rotate(words[previous],shift)) & mask
            words[previous] = (words[previous]+words[(i+1)%3]) & mask
        offset += 12
    tail = data[offset:]
    for i in range(3):
        words[i] = (words[i] + int.from_bytes(tail[i*4:i*4+4], 'little')) & mask
    if tail:
        for i, shift in zip((2,0,1,2,0,1,2), (14,11,25,16,4,14,24)):
            previous = (i+2)%3
            words[i] = ((words[i]^words[previous])-rotate(words[previous],shift)) & mask
    return (words[1]<<32) | words[2]


def read_body_mapping(package, body: int) -> dict:
    """Read one mobile definition from an already-open extract_client.UOP.

    Only the version4 mobile header is interpreted; the remaining TileArt
    fields remain opaque. Returned hashes cover the complete raw member.
    """
    body=int(body)
    if not 0 <= body < 10000000:
        raise ValueError("Body ID outside mobile-definition range")
    resource_id=10000000+body
    virtual_path=f"build/tileart/{resource_id:08d}.bin"
    member=create_hash(virtual_path)
    entry=next((e for e in package.entries if e[4]==member),None)
    if entry is None:
        raise ValueError(f"Missing mobile TileArt definition for body {body}")
    data=package.read(entry)
    if len(data)<40 or struct.unpack_from("<H",data)[0]!=4:
        raise ValueError("Unsupported mobile TileArt header")
    if struct.unpack_from("<I",data,6)[0]!=resource_id:
        raise ValueError("TileArt resource identity mismatch")
    source_body=struct.unpack_from("<I",data,32)[0]
    if not 0 <= source_body < 10000000:
        raise ValueError("Invalid mobile animation source body")
    return {
        "bodyId":body,"sourceBodyId":source_body,
        "sourceArchive":Path(package.path).name,
        "sourceMember":f"{member:016x}",
        "sourceSha256":hashlib.sha256(data).hexdigest(),
        "sourceVirtualPath":virtual_path,
        "sourceBodyOffset":32,"tileArtVersion":4,
        "tileArtResourceId":resource_id,
    }
