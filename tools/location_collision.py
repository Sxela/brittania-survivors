"""Native location collision, projected onto one accessible walking level.

RunUO references: Movement.cs IsOk/Check (16-unit body, 2-unit step),
Map.cs GetAverageZ and TileData.cs CalcHeight. This arena projection deliberately
ignores doors and cannot represent two simultaneously accessible stacked floors.
It prefers the lowest clear structural support; furniture is never a floor.
Named region rectangles describe provenance, not invisible movement walls.
"""
import re
from functools import lru_cache

IMPASSABLE = 0x40
WET = 0x80
SURFACE = 0x200
BRIDGE = 0x400
ROOF = 0x10000000
DOOR = 0x20000000
FLOOR = re.compile(r'floor|tile|slate|plank|wooden boards|paver|flagstone|wooden logs|bridge|stairs?|steps?|carpet|rug|\bmat\b|bricks?|platform|\bdeck\b|cobblestone', re.I)


def ignored_land(item_id):
    """Server/TileMatrix.cs LandTile.Ignored, including featureless dungeon void."""
    return item_id in (2, 0x1DB) or 0x1AE <= item_id <= 0x1B5


def normalize_region(region, data):
    """Update walkZ, blocked, mainPassable and spawn; return audit counts.

    ``data`` supplies ClassicData.land_tile(id) and .tile(id). Native elevations
    just beyond the exported section are unavailable, so the last row/column
    clamp to their original edge vertex. All movement remains within the export.
    """
    w, h = region['width'], region['height']
    tiles = region['tiles']
    if w <= 0 or h <= 0 or len(tiles) != w*h:
        raise ValueError('Native region dimensions do not match its tile count')
    land = lru_cache(maxsize=None)(data.land_tile)
    item = lru_cache(maxsize=None)(data.tile)
    cells = [[] for _ in tiles]
    for static in region.get('statics', []):
        x, y = static['x'], static['y']
        if 0 <= x < w and 0 <= y < h:
            definition = item(static['itemId'])
            flags = static.get('flags', definition.get('flags', 0))
            if flags & DOOR:
                continue  # Arena doors are intentionally traversable.
            height = definition.get('height', 0)
            calc = height // 2 if flags & BRIDGE else height
            cells[x*h+y].append((static['z'], calc, height, flags,
                                   static.get('name', definition.get('name', ''))))
    walk, limits, passable = [], [], set()
    floor_count = clearance_blocked = ignored_count = 0
    for i, (tile_id, base, *_) in enumerate(tiles):
        x, y = divmod(i, h)
        heights = [base, tiles[x*h+min(y+1, h-1)][1],
                   tiles[min(x+1, w-1)*h+y][1],
                   tiles[min(x+1, w-1)*h+min(y+1, h-1)][1]]
        ztop, zleft, zright, zbottom = heights
        average = (zleft+zright)//2 if abs(ztop-zbottom) > abs(zleft-zright) else (ztop+zbottom)//2
        low, high = min(heights), max(heights)
        ld = land(tile_id)
        ignored = ignored_land(tile_id) or re.fullmatch(r'\s*(?:void|no\s*draw)\s*', ld.get('name', ''), re.I) is not None
        ignored_count += bool(ignored)
        land_ok = not ignored and not ld.get('flags', 0) & (IMPASSABLE | WET)
        # (standing Z, entry height, top used when stepping away, static floor)
        candidates = [(average, low, high, False)] if land_ok else []
        for z, calc, height, flags, name in cells[i]:
            shallow = height <= 2 and (ignored or z+calc <= average+2)
            if flags & SURFACE and not flags & (IMPASSABLE | ROOF) and (flags & BRIDGE or FLOOR.search(name) or shallow):
                support = z+calc
                # A buried floor cannot turn hillside into a walkable tunnel.
                if not ignored and support < average:
                    continue
                # GetStartZ uses full Height for the departure stepTop even
                # though the character stands halfway up bridge stair art.
                candidates.append((support, z if flags & BRIDGE else support, z+height, True))
        chosen = None
        for candidate in sorted(candidates):
            z = candidate[0]
            # IsOk tests actual [bottom, top) overlap, not abs(z-base).
            if any(flags & (IMPASSABLE | SURFACE) and sz+calc > z and z+16 > sz
                   for sz, calc, _, flags, _ in cells[i]):
                continue
            chosen = candidate
            break
        walk.append(chosen[0] if chosen else average)
        limits.append((chosen[1], chosen[2]) if chosen else (low, high))
        if chosen:
            passable.add(i)
            floor_count += chosen[3]
        elif candidates:
            clearance_blocked += 1

    def neighbors(i):
        x, y = divmod(i, h)
        if x: yield i-h
        if x+1 < w: yield i+h
        if y: yield i-1
        if y+1 < h: yield i+1

    named = set(region.get('namedRegionCells', []))
    remaining, components = set(passable), []
    while remaining:
        start = remaining.pop()
        group, queue = {start}, [start]
        while queue:
            i = queue.pop()
            for j in neighbors(i):
                if j in remaining and limits[j][0] <= limits[i][1]+2 and limits[i][0] <= limits[j][1]+2:
                    remaining.remove(j)
                    group.add(j)
                    queue.append(j)
        components.append(group)
    if not components:
        raise ValueError(f'No physically passable native cells: {region.get("name", "unknown")}')
    # Avoid selecting a huge ocean-side backdrop instead of the named dungeon.
    main = max(components, key=lambda group: (len(group & named), len(group), -min(group)))
    old = region.get('spawn', {})
    sx, sy = old.get('tileX', w//2), old.get('tileY', h//2)
    spawn = min(main, key=lambda i: ((i//h-sx)**2+(i%h-sy)**2, i))
    ax, ay = spawn//h+.5, spawn%h+.5
    old_main = set(region.get('mainPassable', []))
    region.update(walkZ=walk, mainPassable=sorted(main), blocked=sorted(set(range(w*h))-main),
                  spawn={'x': (ax-ay)*22, 'y': (ax+ay)*22, 'tileX': spawn//h, 'tileY': spawn%h},
                  connectedRatio=len(main)/len(tiles), movementBounds='connected-native-section')
    return {'cells': w*h, 'physicalPassable': len(passable), 'reachable': len(main),
            'components': len(components), 'outsideNamedReachable': len(main-named),
            'restoredReachable': len(main-old_main), 'removedReachable': len(old_main-main),
            'staticFloorCells': floor_count, 'clearanceBlocked': clearance_blocked,
            'ignoredLandCells': ignored_count}
