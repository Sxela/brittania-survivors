"""Native paperdoll backpack and coin art for movable HUD shortcuts."""
import hashlib
import json
import pathlib
from classic_data import ClassicData


def extract(client=None):
    data = ClassicData(client) if client else ClassicData()
    out = pathlib.Path('game/assets/classic-ui/hud')
    out.mkdir(parents=True, exist_ok=True)
    entries = {}
    try:
        for name, archive, virtual, image, extra in [
            ('backpack', 'gumpartLegacyMUL.uop', 'build/gumpartlegacymul/00050422.tga', data.gump(50422),
             {'sourceGumpIds': [50422], 'sourceItemId': 3701, 'sourceAnimationId': 422,
              'association': 'Original backpack paperdoll wearable; transparent margins cropped'}),
            ('shop', 'artLegacyMUL.uop', 'build/artlegacymul/00020207.tga', data.art(3823),
             {'sourceItemId': 3823, 'association': 'Original gold coin pile used as merchant shortcut'}),
        ]:
            bounds = image.getbbox()
            image = image.crop(bounds)
            dest = out / (name + '.png')
            image.save(dest)
            entries['hud/' + name] = {
                'src': 'assets/classic-ui/hud/' + dest.name,
                'width': image.width, 'height': image.height,
                'sourceArchive': archive, 'sourceVirtualPath': virtual,
                'sourceSha256': hashlib.sha256(data.member(archive, virtual)).hexdigest(),
                'sourceCrop': list(bounds), 'sha256': hashlib.sha256(dest.read_bytes()).hexdigest(), **extra,
            }
        for filename in ['game/assets/classic-ui/manifest.json', 'game/assets/ui/manifest.json']:
            path = pathlib.Path(filename)
            manifest = json.loads(path.read_text(encoding='utf-8'))
            manifest['images'].update(entries)
            path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        print('Recovered native backpack and gold-pile shortcut icons')
    finally:
        data.close()


if __name__ == '__main__':
    extract()
