"""Read-only Classic Client MUL and AnimationFrame UOP animation decoding.

The same AMOU magic also occurs in EC archives, but Classic pixel blocks use
RGB555 palettes and signed-coordinate RLE rather than EC's indexed bytecode.
Native frame origins are retained for correctly aligned wearable layers.
"""
from __future__ import annotations
import hashlib
import pathlib
import re
import struct
from PIL import Image
from classic_archive import UOP

from classic_paths import DEFAULT_CLASSIC


def rgb555(value):
    return tuple(((value >> shift) & 31)*255//31 for shift in (10, 5, 0))


def read_sprite(data, offset, palette, zero_transparent=False):
    """Decode a single bounded signed10 RLE frame and preserve its origin."""
    cx, cy, width, height = struct.unpack_from('<hhhh', data, offset)
    if width == 0 or height == 0:
        # Native wearable blocks retain completely transparent phases explicitly.
        return None
    if not 0 < width <= 2048 or not 0 < height <= 2048:
        raise ValueError('Invalid Classic animation dimensions')
    cursor = offset+8
    pixels = bytearray(width*height*4)
    while True:
        command, = struct.unpack_from('<I', data, cursor)
        cursor += 4
        if command == 0x7fff7fff:
            break
        length = command & 0xfff
        x, y = (command >> 22) & 1023, (command >> 12) & 1023
        x = (x-1024 if x >= 512 else x)+cx
        y = (y-1024 if y >= 512 else y)+cy+height
        if not length or not (0 <= x <= width and 0 <= y < height) or x+length > width:
            raise ValueError('Classic animation RLE outside frame bounds')
        if cursor+length > len(data):
            raise ValueError('Truncated Classic animation run')
        for i, index in enumerate(data[cursor:cursor+length]):
            value = palette[index]
            if value or not zero_transparent:
                start = (y*width+x+i)*4
                pixels[start:start+4] = bytes((*rgb555(value), 255))
        cursor += length
    return Image.frombytes('RGBA', (width, height), bytes(pixels)), -cx, -cy-height, width-cx, -cy


def decode_mul(data, final_only=False):
    if len(data) < 520:
        raise ValueError('Truncated MUL animation block')
    palette = struct.unpack_from('<256H', data)
    count, = struct.unpack_from('<I', data, 512)
    if not 0 < count <= 256 or 516+count*4 > len(data):
        raise ValueError('Invalid MUL animation frame index')
    offsets = struct.unpack_from('<'+str(count)+'I', data, 516)
    selected = [count-1] if final_only else range(count)
    return [read_sprite(data, 512+offsets[i], palette) for i in selected]


def decode_uop(data, final_only=False, equipment=False):
    if data[:4] != b'AMOU' or len(data) < 40:
        raise ValueError('Not Classic AMOU')
    count, offset = struct.unpack_from('<II', data, 32)
    if count > 5000 or offset+count*16 > len(data):
        raise ValueError('Invalid Classic UOP frame index')
    records = [struct.unpack_from('<HHhhhhI', data, offset+i*16) for i in range(count)]
    perdir = max(10 if equipment else 1, (max(r[1] for r in records)+4)//5)
    result = [None]*(5*(1 if final_only else perdir))
    for i, record in enumerate(records):
        number, relative = record[1], record[-1]
        direction, phase = divmod(number-1, perdir)
        if direction >= 5:
            raise ValueError('Classic UOP facing index exceeds five rows')
        if final_only and phase != perdir-1:
            continue
        cursor = offset+i*16+relative
        palette = struct.unpack_from('<256H', data, cursor)
        result[direction if final_only else number-1] = read_sprite(data, cursor+512, palette, True)
    if final_only:
        # Some layer archives omit the last phase when it is transparent.
        return result, perdir
    return result, perdir


def load_def(path):
    result = {}
    if not path.exists():
        return result
    for line in path.read_text(encoding='utf8', errors='replace').splitlines():
        match = re.match(r'^\s*(\d+)\s+\{([^}]+)\}\s*(\d+)', line)
        if match:
            values = [int(v) for v in re.findall(r'\d+', match[2])]
            result[int(match[1])] = (values[2] if len(values) >= 3 else values[0], int(match[3]))
    return result


class ClassicAnimations:
    def __init__(self, client=DEFAULT_CLASSIC):
        self.client = pathlib.Path(client)
        self.indices, self.files = {}, {}
        for bank in range(1, 7):
            stem = 'anim'+(str(bank) if bank > 1 else '')
            idx, mul = self.client/(stem+'.idx'), self.client/(stem+'.mul')
            if idx.exists() and mul.exists():
                self.indices[bank] = idx.read_bytes()
                self.files[bank] = mul.open('rb')
        self.types = {}
        for line in (self.client/'mobtypes.txt').read_text().splitlines():
            values = line.split('#', 1)[0].split()
            if len(values) >= 3 and values[0].isdigit():
                self.types[int(values[0])] = (values[1].lower(), int(values[2], 16))
        self.bodies, self.corpses = load_def(self.client/'Body.def'), load_def(self.client/'Corpse.def')
        self.conversions = {}
        for line in (self.client/'Bodyconv.def').read_text().splitlines():
            values = line.split('#', 1)[0].strip().split()
            if values and values[0].isdigit():
                for bank, value in enumerate(values[1:], 2):
                    if value.lstrip('-').isdigit() and int(value) >= 0 and bank in self.files:
                        self.conversions[int(values[0])] = (bank, int(value))
        self.equipment = {}
        for line in (self.client/'Equipconv.def').read_text().splitlines():
            values = line.split('#', 1)[0].strip().split()
            if len(values) >= 5 and all(v.lstrip('-').isdigit() for v in values[:5]):
                body, original, replacement, gump, hue = map(int, values[:5])
                self.equipment[body, original] = (replacement, gump, hue)
        self.packages, self.uop = [], {}
        for path in sorted(self.client.glob('AnimationFrame*.uop')):
            package = UOP(path)
            self.packages.append(package)
            for entry in package.entries:
                # Header body/action IDs avoid a million speculative hash guesses.
                package.file.seek(entry[0]+entry[1])
                raw = package.file.read(min(entry[2], 4096))
                if entry[-1]:
                    import zlib
                    head = zlib.decompressobj().decompress(raw, 2048)
                else:
                    head = raw
                if head[:4] != b'AMOU' or len(head) < 40:
                    continue
                body, = struct.unpack_from('<I', head, 12)
                index, = struct.unpack_from('<I', head, 36)
                if index+2 > len(head):
                    head = package.read(entry)
                action, = struct.unpack_from('<H', head, index)
                self.uop[body, action] = (package, entry)
        self.sequence = {}
        path = self.client/'AnimationSequence.uop'
        if path.exists():
            package = UOP(path)
            for entry in package.entries:
                data = package.read(entry)
                if len(data) < 56:
                    continue
                body, = struct.unpack_from('<I', data)
                count, = struct.unpack_from('<I', data, 52)
                remaps = {}
                if count not in (48, 68):
                    for i in range(count):
                        old, frames, new = struct.unpack_from('<III', data, 56+i*72)
                        if not frames:
                            remaps[old] = new
                self.sequence[body] = remaps
            package.close()

    def close(self):
        for file in self.files.values():
            file.close()
        for package in self.packages:
            package.close()

    def type(self, body, bank=1):
        return self.types.get(body, ('monster' if body < 200 else 'animal' if body < 400 else 'human', 0))

    def layout(self, body, bank=1, original=None):
        kind, flags = self.type(body if original is None else original, bank)
        if kind == 'monster':
            group = 'human' if flags & 0x400 else 'animal' if flags & 0x40 else 'monster'
        elif kind == 'animal':
            group = ('human' if flags & 0x400 else 'animal' if flags & 0x40 else 'monster') if flags & 0x20 else 'animal'
        elif kind == 'sea_monster':
            return body*110, 13, kind
        else:
            group = 'human'
        if group == 'monster':
            return body*110, 22, group
        if group == 'animal':
            return (body-200)*65+22000, 13, group
        return (body-400)*175+35000, 35, group

    def resolve(self, body, corpse=False):
        # Expansion MUL banks contain the real creature (including dressed mage
        # bodies). Body.def's human aliases are compatibility fallbacks, not a
        # replacement for an installed Bodyconv.def animation bank.
        if body in self.conversions:
            bank, mapped = self.conversions[body]
            return body, bank, mapped, 0
        source, hue = (self.corpses if corpse else self.bodies).get(body, (body, 0))
        bank, mapped = self.conversions.get(source, (1, source))
        return source, bank, mapped, hue

    def has_mul(self, body, action=0):
        source, bank, mapped, _ = self.resolve(body)
        start, count, _ = self.layout(mapped, bank, source)
        if action >= count:
            return False
        data = self.indices[bank]
        for direction in range(5):
            offset = (start+action*5+direction)*12
            if offset < 0 or offset+12 > len(data):
                return False
            position, length, _ = struct.unpack_from('<III', data, offset)
            if position == 0xffffffff or length < 520 or position+length > self.files[bank].seek(0, 2):
                return False
        return True

    def frames(self, body, action=0, corpse=False, final_only=False):
        source, bank, mapped, hue = self.resolve(body, corpse)
        _, flags = self.type(source)
        uop_action = self.sequence.get(source, {}).get(action, action)
        if (flags & 0x10000 or not self.has_mul(body, action)) and (source, uop_action) in self.uop:
            package, entry = self.uop[source, uop_action]
            data = package.read(entry)
            frames, perdir = decode_uop(data, final_only, self.type(source)[0] == 'equipment')
            evidence = {'sourceArchive': package.path.name, 'sourceMember': f'{entry[4]:016x}',
                        'sourceSha256': hashlib.sha256(data).hexdigest(), 'animationBodyId': source,
                        'actionId': uop_action, 'defaultHue': hue, 'sourceFramesPerDirection': perdir,
                        'pixelFormat': 'Classic RGB555 per-frame palette RLE'}
            return frames, evidence
        start, count, kind = self.layout(mapped, bank, source)
        if action >= count:
            raise ValueError('Action exceeds native MUL group')
        frames, hashes, offsets = [], [], []
        perdir = None
        for direction in range(5):
            offset = (start+action*5+direction)*12
            if offset < 0 or offset+12 > len(self.indices[bank]):
                raise ValueError('MUL index outside bank')
            position, length, _ = struct.unpack_from('<III', self.indices[bank], offset)
            if position == 0xffffffff or length < 520:
                raise ValueError('Missing native MUL action/direction')
            file = self.files[bank]
            file.seek(position)
            data = file.read(length)
            if len(data) != length:
                raise ValueError('Truncated native MUL block')
            decoded = decode_mul(data, final_only)
            count, = struct.unpack_from('<I', data, 512)
            if perdir is None:
                perdir = count
            if perdir != count:
                raise ValueError('MUL facing rows have inconsistent phases')
            frames.extend(decoded)
            hashes.append(hashlib.sha256(data).hexdigest())
            offsets.append({'offset': position, 'length': length})
        return frames, {'sourceArchive': pathlib.Path(self.files[bank].name).name,
                        'sourceSha256': hashlib.sha256(''.join(hashes).encode()).hexdigest(),
                        'sourceDirectionSha256': hashes, 'sourceDirections': offsets,
                        'animationBodyId': source, 'sourceBankBodyId': mapped,
                        'actionId': action, 'defaultHue': hue, 'sourceFramesPerDirection': perdir,
                        'pixelFormat': 'Classic RGB555 shared-palette RLE', 'nativeGroup': kind}
