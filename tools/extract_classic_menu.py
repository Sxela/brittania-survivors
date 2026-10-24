"""Recover native Classic menu pieces without replacing other active UI assets."""
from __future__ import annotations
import hashlib
import json
import pathlib
import struct
from PIL import Image
from classic_data import ClassicData, DEFAULT_CLASSIC, rgb555


def extract(client=DEFAULT_CLASSIC):
    data = ClassicData(client)
    root = pathlib.Path('game/assets/classic-ui/menu')
    root.mkdir(parents=True, exist_ok=True)
    entries = {}
    hues = data.file('hues.mul')

    def save(name, image, ids, hue=0, **extra):
        if hue:
            index = hue - 1
            offset = (index // 8) * 708 + 4 + (index % 8) * 88
            ramp = [rgb555(struct.unpack_from('<H', hues, offset + i * 2)[0]) for i in range(32)]
            image.putdata([(*ramp[r >> 3][:3], a) if a and r == g == b else (r, g, b, a)
                           for r, g, b, a in image.getdata()])
        dest = root / (name + '.png')
        image.save(dest)
        entries['menu/' + name] = {
            'src': 'assets/classic-ui/menu/' + dest.name,
            'width': image.width, 'height': image.height,
            'sourceArchive': 'gumpartLegacyMUL.uop', 'sourceGumpIds': ids,
            'sourceDecodedSha256': [hashlib.sha256(data.member('gumpartLegacyMUL.uop',
                f'build/gumpartlegacymul/{i:08d}.tga')).hexdigest() for i in ids],
            'sha256': hashlib.sha256(dest.read_bytes()).hexdigest(),
            'sourceDefinition': 'Intrface.def: character selection and cool/shield buttons',
            'partialHue': hue, **extra,
        }

    def panel(name, base, hue=0):
        tiles = [data.gump(base + i) for i in range(9)]
        widths = [tiles[0].width, min(tiles[i].width for i in [1, 4, 7]), tiles[2].width]
        heights = [tiles[0].height, min(tiles[i].height for i in [3, 4, 5]), tiles[6].height]
        result = Image.new('RGBA', (sum(widths), sum(heights)))
        for i, tile in enumerate(tiles):
            result.paste(tile.crop((0, 0, widths[i % 3], heights[i // 3])),
                         (sum(widths[:i % 3]), sum(heights[:i // 3])))
        save(name, result, list(range(base, base + 9)), hue,
             borderImageSlice=[heights[0], widths[2], heights[2], widths[0]])

    try:
        panel('frame', 2600)
        for name, base in [('normal', 9400), ('hover', 9450), ('pressed', 9500)]:
            panel('button-' + name, base, 2100)
        for name, base in [('normal', 10550), ('hover', 10553), ('pressed', 10556)]:
            tiles = [data.gump(base + i) for i in range(3)]
            result = Image.new('RGBA', (sum(t.width for t in tiles), tiles[0].height))
            x = 0
            for tile in tiles:
                result.paste(tile, (x, 0))
                x += tile.width
            save('start-' + name, result, list(range(base, base + 3)), 34,
                 borderImageSlice=[12, 28, 20, 28])
        for name, gid in [('dragon-left', 10400), ('dragon-right', 10410),
                          ('tail-left', 10402), ('tail-right', 10412)]:
            save(name, data.gump(gid), [gid])
        for path in [pathlib.Path('game/assets/classic-ui/manifest.json'),
                     pathlib.Path('game/assets/ui/manifest.json')]:
            manifest = json.loads(path.read_text(encoding='utf-8'))
            manifest['images'].update(entries)
            path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        print(f'Recovered {len(entries)} native menu assets with source hashes')
    finally:
        data.close()


if __name__ == '__main__':
    extract()
