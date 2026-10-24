"""Choose native arena windows without mistaking region labels for map edges."""

def compact_expansion(region, facet_width, facet_height, minimum=128):
    """Enlarge cramped crops; physical collision still decides reachable cells.

    Large dungeon sections with little actual floor are deliberately excluded:
    their walls, rather than the export window, limit their playable space.
    """
    w, h = region['width'], region['height']
    if min(w, h) >= 96 or len(region['mainPassable']) >= 4096:
        return None
    width, height = min(facet_width, max(minimum, w)), min(facet_height, max(minimum, h))
    x = max(0, min(facet_width-width, region['sourceX']-(width-w)//2))
    y = max(0, min(facet_height-height, region['sourceY']-(height-h)//2))
    if (x, y, width, height) == (region['sourceX'], region['sourceY'], w, h):
        return None
    return x, y, width, height
