"""Derive lossless WebP ground and scenery atlases; keep all source assets intact."""
import argparse, hashlib, io, json, os, pathlib, tempfile
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image, __version__ as PILLOW_VERSION

ROOT = pathlib.Path(__file__).resolve().parents[1]
PAGE, PAD = 1024, 2
RECIPE = f'map-webp-v1-p{PAGE}-pad{PAD}-method4-exact-pillow{PILLOW_VERSION}'
WRITE_LOCKS = defaultdict(threading.Lock)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def atomic_write(file, data):
    # Different source files can have identical pixels/bytes and output names.
    # Serialize those writes, including on Windows where replacing a file while
    # another worker verifies it can fail with a sharing violation.
    with WRITE_LOCKS[str(file)]:
        if file.exists() and file.read_bytes() == data:
            return
        _atomic_write(file, data)

def _atomic_write(file, data):
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=file.parent, prefix='.building-', delete=False) as stream:
            temporary = pathlib.Path(stream.name)
            stream.write(data)
        os.replace(temporary, file)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)

def resource(game, src):
    if not isinstance(src, str) or not src.startswith('assets/') or '\\' in src or '..' in pathlib.PurePosixPath(src).parts or ':' in src:
        raise ValueError('Unsafe asset reference')
    file = game / src
    if not file.resolve(strict=True).is_relative_to((game / 'assets').resolve()) or file.is_symlink():
        raise ValueError('Asset reference escapes resource directory')
    return file

def webp_bytes(image):
    output = io.BytesIO()
    image.save(output, 'WEBP', lossless=True, method=4, exact=True)
    data = output.getvalue()
    with Image.open(io.BytesIO(data)) as decoded:
        if decoded.convert('RGBA').tobytes() != image.tobytes():
            raise ValueError('Lossless WebP pixel verification failed')
    return data

def convert_image(game, out, src):
    file = resource(game, src)
    raw = file.read_bytes()
    source_sha = digest(raw)
    filename = digest((RECIPE + source_sha).encode()) + '.webp'
    target = out / 'ground' / filename
    with Image.open(io.BytesIO(raw)) as original:
        image = original.convert('RGBA')
    if target.exists():
        data = target.read_bytes()
        with Image.open(io.BytesIO(data)) as decoded:
            if decoded.size != image.size or decoded.convert('RGBA').tobytes() != image.tobytes():
                raise ValueError('Existing optimized resource differs from original pixels')
    else:
        data = webp_bytes(image)
        atomic_write(target, data)
    return {'src': target.relative_to(game).as_posix(), 'width': image.width, 'height': image.height,
            'sha256': digest(data), 'sourceImageSha256': source_sha}, len(raw), len(data)

def pack_shelves(entries):
    """Deterministic packing, no rotation, trim or rescale of individual sprites."""
    pages, placed, oversized = [], [], []
    for src, image in sorted(entries, key=lambda e: (-e[1].height, -e[1].width, e[0])):
        w, h = image.width + PAD * 2, image.height + PAD * 2
        if max(w, h) > PAGE:
            oversized.append(src)
            continue
        candidates = []
        for page_id, page in enumerate(pages):
            for shelf in page['shelves']:
                if h <= shelf['height'] and shelf['x'] + w <= PAGE:
                    candidates.append(((shelf['height'] - h, PAGE - shelf['x'] - w), page_id, shelf))
        if candidates:
            _, page_id, shelf = min(candidates, key=lambda c: (c[0], c[1], c[2]['y']))
        else:
            page_id = next((i for i, p in enumerate(pages) if p['height'] + h <= PAGE), None)
            if page_id is None:
                page_id = len(pages)
                pages.append({'shelves': [], 'height': 0, 'width': 0})
            page = pages[page_id]
            shelf = {'x': 0, 'y': page['height'], 'height': h}
            page['shelves'].append(shelf)
            page['height'] += h
        placed.append({'src': src, 'page': page_id, 'x': shelf['x'] + PAD, 'y': shelf['y'] + PAD,
                       'width': image.width, 'height': image.height})
        shelf['x'] += w
        pages[page_id]['width'] = max(pages[page_id]['width'], shelf['x'])
    return pages, placed, oversized

def atlas_images(game, out, sources):
    images = {}
    for src in sorted(sources):
        with Image.open(resource(game, src)) as image:
            images[src] = image.convert('RGBA')
    pages, placed, oversized = pack_shelves(list(images.items()))
    output = {}
    for page_id, page in enumerate(pages):
        canvas = Image.new('RGBA', (page['width'], page['height']))
        members = [item for item in placed if item['page'] == page_id]
        for item in members:
            image = images[item['src']]
            x, y, w, h = item['x'], item['y'], item['width'], item['height']
            canvas.paste(image, (x, y))
            # Extrude edge pixels into padding to avoid texture filtering seams.
            for dy in range(-PAD, h + PAD):
                for dx in (-2, -1, w, w + 1):
                    canvas.putpixel((x + dx, y + dy), image.getpixel((min(w - 1, max(0, dx)), min(h - 1, max(0, dy)))))
            for dy in (-2, -1, h, h + 1):
                row = min(h - 1, max(0, dy))
                canvas.paste(image.crop((0, row, w, row + 1)), (x, y + dy))
        data = webp_bytes(canvas)
        target = out / 'atlases' / (digest(data) + '.webp')
        atomic_write(target, data)
        with Image.open(io.BytesIO(data)) as decoded:
            restored = decoded.convert('RGBA')
        for item in members:
            x, y, w, h = item['x'], item['y'], item['width'], item['height']
            if restored.crop((x, y, x + w, y + h)).tobytes() != images[item['src']].tobytes():
                raise ValueError('Atlas sprite pixel verification failed')
            output[item['src']] = {'src': target.relative_to(game).as_posix(), 'width': w, 'height': h,
                                  'sha256': digest(data), 'atlas': {'x': x, 'y': y}}
    for src in oversized:
        output[src] = convert_image(game, out, src)[0]
    return output

def optimize(game, workers=4):
    game = pathlib.Path(game).resolve(strict=True)
    out = game / 'assets/optimized-locations'
    source_index = json.loads((game / 'assets/mobile-locations/manifest.json').read_text(encoding='utf-8'))
    areas = list(source_index['areas'].items())
    ground_sources = set()
    for _, area in areas:
        manifest = json.loads(resource(game, area['src']).read_text(encoding='utf-8'))
        for region in manifest['regions']:
            for chunk in region.get('grounds', []) + region.get('backdropGrounds', []):
                ground_sources.add(manifest['images'][chunk['image']]['src'])
    converted, original_bytes, webp_total = {}, 0, 0
    print(f'Optimizing {len(ground_sources)} ground images for {len(areas)} areas...', flush=True)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(convert_image, game, out, src): src for src in sorted(ground_sources)}
        for count, future in enumerate(as_completed(futures), 1):
            result, before, after = future.result()
            converted[futures[future]] = result
            original_bytes += before
            webp_total += after
            if count % 100 == 0 or count == len(futures):
                print(f'Ground {count}/{len(futures)}', flush=True)
    index = {'formatVersion': 1, 'optimizedMapsVersion': 1, 'areas': {}}
    report = {'recipe': RECIPE, 'pixelExact': True, 'groundFiles': len(converted),
              'groundPngBytes': original_bytes, 'groundWebpBytes': webp_total, 'areas': []}
    for count, (area_id, area) in enumerate(areas, 1):
        manifest = json.loads(resource(game, area['src']).read_text(encoding='utf-8'))
        before = len({entry['src'] for entry in manifest['images'].values()})
        statics = {entry['src'] for entry in manifest['images'].values() if '/statics/' in entry['src']}
        packed = atlas_images(game, out, statics)
        for key, entry in manifest['images'].items():
            replacement = converted.get(entry['src']) or packed.get(entry['src'])
            if replacement:
                manifest['images'][key] = {**entry, **replacement}
        manifest['optimizedMapsVersion'] = 1
        data = (json.dumps(manifest, sort_keys=True, separators=(',', ':')) + '\n').encode()
        target = out / 'areas' / (digest(data) + '.json')
        atomic_write(target, data)
        index['areas'][area_id] = {**area, 'src': target.relative_to(game).as_posix()}
        after = len({entry['src'] for entry in manifest['images'].values()})
        report['areas'].append({'id': area_id, 'name': area['name'], 'imagesBefore': before, 'imagesAfter': after})
        print(f'Area {count}/{len(areas)}: {area["name"]}: {before} -> {after} image files', flush=True)
    # Publish the index last, after every referenced file has been verified.
    atomic_write(out / 'report.json', (json.dumps(report, indent=2) + '\n').encode())
    atomic_write(out / 'manifest.json', (json.dumps(index, sort_keys=True, separators=(',', ':')) + '\n').encode())
    source_index['optimizedIndex'] = {'src': 'assets/optimized-locations/manifest.json'}
    atomic_write(game / 'assets/mobile-locations/manifest.json', (json.dumps(source_index, sort_keys=True, separators=(',', ':')) + '\n').encode())
    return report

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game', type=pathlib.Path, default=ROOT / 'game')
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    if not 1 <= args.workers <= 16:
        parser.error('Use 1..16 workers.')
    optimize(args.game, args.workers)
