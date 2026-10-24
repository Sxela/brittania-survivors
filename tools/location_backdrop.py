"""Bake native scenery outside a location crop without extending its arena.

Only the original adjoining map cells are copied. All coordinates remain relative
to the unchanged location origin; no terrain is repeated or generated. The caller
owns image persistence and native static metadata/art resolution.
"""
from functools import lru_cache

from PIL import Image

from extract_classic_maps import sloped_land
from export_zone_maps import FACETS
from location_decorations import region_decorations


def backdrop_cells(region, padding=40):
    """Yield local coordinates in the clamped native ring, never arena cells."""
    _, facet_width, facet_height = FACETS[region['facet']]
    sx, sy, width, height = (region[k] for k in ('sourceX', 'sourceY', 'width', 'height'))
    left, top = max(-padding, -sx), max(-padding, -sy)
    right = min(width + padding, facet_width - sx)
    bottom = min(height + padding, facet_height - sy)
    for x in range(left, right):
        for y in range(top, bottom):
            if not (0 <= x < width and 0 <= y < height):
                yield x, y


def add_native_backdrop(region, data, save, make, padding=40):
    """Mutate backdropGrounds/backdropStatics, returning placement/image counts.

    ``save(key, image, archive, **metadata)`` persists an RGBA image under the
    supplied key; its return value is ignored. ``make(record)`` receives a native
    static record in *local* coordinates and returns an enriched record (image,
    flags, bounds, etc.), or None to suppress invisible helper art. All input and
    output records have sceneryOnly=True. Neither playable geometry nor spawn
    data is changed. Use the same base-map policy as the arena export.
    """
    if getattr(data, 'use_patches', False):
        raise ValueError('Native location backdrop requires use_patches=False')
    if padding < 0:
        raise ValueError('padding must not be negative')
    facet, fw, fh = FACETS[region['facet']]
    sx, sy, width, height = (region[k] for k in ('sourceX', 'sourceY', 'width', 'height'))
    cells = set(backdrop_cells(region, padding))
    grounds, statics = [], []
    archive = f'map{facet}LegacyMUL.uop'

    @lru_cache(maxsize=None)
    def block(index):
        return data.map_block(index, facet)

    def point(x, y):
        wx, wy = min(fw - 1, max(0, sx + x)), min(fh - 1, max(0, sy + y))
        return block((wx // 8) * (fh // 8) + wy // 8)[(wy % 8) * 8 + wx % 8]

    @lru_cache(maxsize=None)
    def land(iid):
        return data.land(iid)

    # Group into independent <=32-tile baked ground patches. Interior cells
    # stay transparent, so the arena's own ground is never overwritten.
    chunks = {}
    for x, y in cells:
        chunks.setdefault((x // 32, y // 32), []).append((x, y))
    for (cx, cy), coordinates in sorted(chunks.items()):
        patches = []
        for x, y in sorted(coordinates, key=lambda p: (sum(p), p[0])):
            iid, z = point(x, y)
            image = land(iid)
            if image is None:
                continue
            px, py = (x - y) * 22, (x + y) * 22 - z * 4
            z1, z2, z3 = point(x + 1, y)[1], point(x + 1, y + 1)[1], point(x, y + 1)[1]
            if z == z1 == z2 == z3:
                patches.append((image, px - 22, py))
            else:
                patch, left, top = sloped_land(image, [(px, py), (px + 22, (x + y + 1) * 22 - z1 * 4), (px, (x + y + 2) * 22 - z2 * 4), (px - 22, (x + y + 1) * 22 - z3 * 4)])
                patches.append((patch, left, top))
        if not patches:
            continue
        left, top = min(p[1] for p in patches), min(p[2] for p in patches)
        right = max(p[1] + p[0].width for p in patches)
        bottom = max(p[2] + p[0].height for p in patches)
        ground = Image.new('RGBA', (right - left, bottom - top))
        for image, x, y in patches:
            ground.alpha_composite(image, (x - left, y - top))
        key = f'backdrops/{region["id"]}/{cx}-{cy}'
        save(key, ground, archive, sceneryOnly=True)
        grounds.append({'image': key, 'left': left, 'top': top, 'width': ground.width, 'height': ground.height, 'tileX': cx * 32, 'tileY': cy * 32, 'sceneryOnly': True})

    native_blocks = {((sx + x) // 8, (sy + y) // 8) for x, y in cells}
    for bx, by in sorted(native_blocks):
        for iid, dx, dy, z, hue in data.statics_block(bx * (fh // 8) + by, facet):
            x, y = bx * 8 + dx - sx, by * 8 + dy - sy
            if (x, y) not in cells:
                continue
            definition = data.tile(iid)
            record = make({'x': x, 'y': y, 'z': z, 'itemId': iid, 'hue': hue, 'name': definition['name'], 'flags': definition['flags'], 'height': definition.get('height', 0), 'classicArt': True, 'sceneryOnly': True})
            if record is not None:
                statics.append({**record, 'sceneryOnly': True})
    # Supporting server furniture is part of the adjoining scene too.
    if cells:
        left,top=min(x for x,y in cells),min(y for x,y in cells)
        right,bottom=max(x for x,y in cells)+1,max(y for x,y in cells)+1
        bounds={'facet':region['facet'],'sourceX':sx+left,'sourceY':sy+top,'width':right-left,'height':bottom-top}
        existing=[{**s,'x':s['x']-left,'y':s['y']-top} for s in statics]
        additions,_=region_decorations(bounds,existing)
        for s in additions:
            x,y=s['x']+left,s['y']+top
            if (x,y) in cells:
                record=make({**s,'x':x,'y':y,'sceneryOnly':True})
                if record is not None:statics.append({**record,'sceneryOnly':True})
    region['backdropGrounds'] = grounds
    region['backdropStatics'] = statics
    region['backdropPadding'] = padding
    return {'tiles': len(cells), 'grounds': len(grounds), 'statics': len(statics)}
