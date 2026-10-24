"""Extract only native Classic artwork needed by survivor Magery summons.

Does not mutate the main actor manifest or regenerate unrelated equipment.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import struct
from PIL import Image
from classic_animation import ClassicAnimations, DEFAULT_CLASSIC

ROOT = Path(__file__).resolve().parents[1]
SUMMONS = {
    'blade-spirits': (574, 'Mobiles/Monsters/Misc/Melee/BladeSpirits.cs'),
    'energy-vortex': (164, 'Mobiles/Monsters/Misc/Melee/EnergyVortex.cs'),
    'air-elemental': (13, 'Mobiles/Monsters/Summons/SummonedAirElemental.cs'),
    'earth-elemental': (14, 'Mobiles/Monsters/Summons/SummonedEarthElemental.cs'),
    'fire-elemental': (15, 'Mobiles/Monsters/Summons/SummonedFireElemental.cs'),
    'water-elemental': (16, 'Mobiles/Monsters/Summons/SummonedWaterElemental.cs'),
    'daemon': (10, 'Mobiles/Monsters/Summons/SummonedDaemon.cs'),
    'summon-creature': (211, 'Mobiles/Animals/Bears/BlackBear.cs'),
}


def extract(client=DEFAULT_CLASSIC, out=ROOT/'game/assets/classic-summons'):
    client, out = Path(client), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    decoder = ClassicAnimations(client)
    manifest = {'formatVersion': 1, 'sourceClient': str(client), 'animations': {},
                'summons': {}, 'missing': {}, 'limitations': [
                    'Native five facing rows S, SW, W, NW, N; opposite facings mirror the source sprite.',
                    'Summon Creature uses the source Black Bear body as a survivor selection from the server animal pool.',
                    'Daemon body 10 is the AOS source default; body 9 is its pre-AOS variant.',
                    'Energy Vortex body 220 with hue 118 is the server SE one-in-500 llama variant.']}

    def sheet(body, action=0, aligned_bottom=None):
        frames, evidence = decoder.frames(body, action)
        visible = [frame for frame in frames if frame is not None]
        if not visible or len(frames) % 5:
            raise ValueError('No complete five-facing native Classic animation')
        columns = len(frames)//5
        left, top = min(f[1] for f in visible), min(f[2] for f in visible)
        right, bottom = max(f[3] for f in visible), max(f[4] for f in visible)
        width, height = right-left, bottom-top
        if width*columns > 8192 or height*5 > 8192:
            raise ValueError('Native atlas exceeds 8192 pixel limit')
        image = Image.new('RGBA', (width*columns, height*5))
        for index, frame in enumerate(frames):
            if frame is not None:
                image.alpha_composite(frame[0], ((index % columns)*width+frame[1]-left,
                                                (index//columns)*height+frame[2]-top))
        relative = f'body-{body}-action-{action}.png'
        image.save(out/relative)
        return {**evidence, 'src': 'assets/classic-summons/'+relative, 'bodyId': body,
                'cellWidth': width, 'cellHeight': height, 'framesPerDirection': columns,
                'directions': 5, 'frameStride': 1, 'nativeBounds': [left, top, right, bottom],
                'anchorX': -left, 'anchorY': height if aligned_bottom is None else aligned_bottom-top,
                'originalOriginAnchorY': -top, 'pose': 'walking' if action == 0 else 'idle',
                'transparentMissingFrameCount': sum(frame is None for frame in frames),
                'sheetSha256': hashlib.sha256((out/relative).read_bytes()).hexdigest()}

    try:
        for body in sorted({entry[0] for entry in SUMMONS.values()} | {9, 220}):
            try:
                animation = sheet(body)
                source = animation['animationBodyId']
                kind, flags = decoder.type(source)
                idle = 4 if kind in ('human', 'equipment') else 2 if kind == 'animal' and not flags & 0x10000 else 1
                try:
                    animation['idle'] = sheet(body, idle, animation['nativeBounds'][3])
                except (ValueError, IndexError, struct.error) as error:
                    manifest.setdefault('missingIdle', {})[str(body)] = str(error)
                manifest['animations'][str(body)] = animation
            except (ValueError, IndexError, struct.error) as error:
                manifest['missing'][str(body)] = str(error)
        for spell, (body, source) in SUMMONS.items():
            source_path = ROOT/'runuo/Scripts'/source
            record = {'body': body, 'hue': manifest['animations'].get(str(body), {}).get('defaultHue', 0),
                      'source': source_path.relative_to(ROOT).as_posix(),
                      'sourceSha256': hashlib.sha256(source_path.read_bytes()).hexdigest() if source_path.exists() else None}
            if spell == 'daemon':
                record['variants'] = [{'body': 9, 'condition': 'pre-AOS'}]
            elif spell == 'energy-vortex':
                record['variants'] = [{'body': 220, 'hue': 118, 'chance': .002, 'condition': 'SE'}]
            manifest['summons'][spell] = record
        (out/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf8')
    finally:
        decoder.close()
    if manifest['missing']:
        raise ValueError(f"Missing Classic summon bodies: {manifest['missing']}")
    print(json.dumps({'summons': len(manifest['summons']), 'bodies': len(manifest['animations']),
                      'missing': manifest['missing']}))
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client', type=Path, default=DEFAULT_CLASSIC)
    parser.add_argument('--out', type=Path, default=ROOT/'game/assets/classic-summons')
    args = parser.parse_args()
    extract(args.client, args.out)
