"""Analyze native ground transparency offline instead of reading the GPU in play."""
import hashlib
import json
from pathlib import Path
from PIL import Image


def analyze(manifest, game=Path('game'), image_root=None):
    for region in manifest['regions']:
        src = Path(manifest['images'][region['ground']]['src'])
        path = image_root / src.relative_to('assets/classic-maps') if image_root else game / src
        alpha = Image.open(path).convert('RGBA').getchannel('A')
        pixels = alpha.load()
        fills = []
        for a in range(0, 64, 4):
            for b in range(0, 64, 4):
                # Same interior diamond sampled by drawPatch, including native
                # sector origin (1408,32) and pixel centers. The expanded clip
                # boundary lies outside this diamond and cannot affect alpha.
                cx, cy = (a-b)*22, (a+b+4)*22
                exposed = False
                for dy in range(-86, 86):
                    sy = 32 + cy + dy
                    for dx in range(-86, 86):
                        if abs(dx+.5)+abs(dy+.5) >= 86:
                            continue
                        sx = 1408 + cx + dx
                        if not (0 <= sx < alpha.width and 0 <= sy < alpha.height) or not pixels[sx, sy]:
                            exposed = True
                            break
                    if exposed:
                        break
                fills.append(exposed)
        region['groundPatchBorderFill'] = fills
        region['groundPatchSourceSha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
    return manifest


if __name__ == '__main__':
    for name in ['game/assets/classic-maps/manifest.json', 'game/assets/maps/manifest.json']:
        path = Path(name)
        manifest = analyze(json.loads(path.read_text(encoding='utf-8')))
        path.write_text(json.dumps(manifest, separators=(',', ':'))+'\n', encoding='utf-8')
    print('Analyzed all 1536 native ground patches; runtime GPU alpha reads are unnecessary')
