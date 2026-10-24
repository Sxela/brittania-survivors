"""Read the world furniture omitted from client statics, without executing RunUO.

Decorate.cs generates Britannia on Trammel/Felucca, plus the facet's own cfg
folder. Preserve original art, coordinates, elevation and hue. Simple addon
constructors are expanded from their literal AddComponent calls; unsupported
constructors are reported rather than inventing scenery. Region extraction
deduplicates exact placements already supplied by the client statics.
"""
from __future__ import annotations

import pathlib
import json
import re
from collections import Counter, defaultdict
from functools import lru_cache

ROOT = pathlib.Path(__file__).resolve().parents[1]
NUMBER = r'[+-]?(?:0x[0-9A-Fa-f]+|\d+)'
HEADER = re.compile(r'^(\w+)\s+(' + NUMBER + r')(?:\s*\((.*)\))?\s*$')
POSITION = re.compile(r'^(' + NUMBER + r')\s+(' + NUMBER + r')\s+(' + NUMBER + r')(?:\s+.*)?$')
COMPONENT = re.compile(r'AddComponent\s*\(\s*new\s+\w+\s*\(\s*(' + NUMBER + r')\s*\)\s*,\s*(' + NUMBER + r')\s*,\s*(' + NUMBER + r')\s*,\s*(' + NUMBER + r')\s*\)')
FACETS = ('Felucca', 'Trammel', 'Ilshenar', 'Malas', 'Tokuno')


def integer(value):
    return int(value, 16 if 'x' in value.lower() else 10)


def brace_body(text, opening):
    depth = 1
    for end in range(opening + 1, len(text)):
        depth += (text[end] == '{') - (text[end] == '}')
        if not depth:
            return text[opening + 1:end]
    raise ValueError('Unbalanced source braces')


@lru_cache(maxsize=2)
def source_classes(server=ROOT / 'runuo'):
    classes = {}
    for path in sorted((pathlib.Path(server) / 'Scripts').rglob('*.cs')):
        text = path.read_text(encoding='utf-8-sig', errors='replace')
        text = re.sub(r'/\*.*?\*/|//[^\n]*', '', text, flags=re.S)
        for match in re.finditer(r'\bclass\s+(\w+)\s*:\s*(\w+)[^{]*\{', text):
            name, parent = match.group(1, 2)
            classes.setdefault(name.lower(), []).append((parent, brace_body(text, match.end() - 1), str(path)))
    return classes


def addon_components(kind, classes):
    """Return literal component geometry, or None for non-addons/unsupported code."""
    candidates = classes.get(kind.lower(), [])
    if len(candidates) != 1:
        return None
    parent, body, source = candidates[0]
    if not inherits(kind, 'BaseAddon', classes):
        return None
    constructor = re.search(r'\b' + re.escape(kind) + r'\s*\([^)]*\)\s*(?::\s*[^{}]+)?\{', body, re.I)
    if not constructor:
        return None
    # Delegating empty constructors (e.g. table hue constructors) are followed
    # by the actual component constructor in the same class.
    constructors = [brace_body(body, m.end() - 1) for m in re.finditer(r'\b' + re.escape(kind) + r'\s*\([^)]*\)\s*(?::\s*[^{}]+)?\{', body, re.I)]
    geometry = [b for b in constructors if 'AddComponent' in b]
    if not geometry:
        return addon_components(parent, classes)
    if len(geometry) != 1:
        return None
    code = geometry[0]
    if re.search(r'\b(if|switch|for|while|foreach)\s*\(', code):
        return None
    # StoneFountainAddon uses a literal initial ID and sequential increments.
    # Interpret only that bounded integer pattern, never arbitrary C#.
    for declaration in re.finditer(r'\bint\s+(\w+)\s*=\s*(' + NUMBER + r')\s*;', code):
        variable, initial = declaration.groups()
        counter = integer(initial)
        def increment(match):
            nonlocal counter
            if match.group(0).startswith('++'):
                counter += 1
                return str(counter)
            value = counter
            counter += 1
            return str(value)
        code = re.sub(r'\+\+' + re.escape(variable) + r'\b|\b' + re.escape(variable) + r'\+\+', increment, code)
    matches = list(COMPONENT.finditer(code))
    if not matches or len(matches) != len(re.findall(r'\bAddComponent\s*\(', code)):
        return None
    return [tuple(integer(n) for n in m.groups()) for m in matches]


def inherits(kind, ancestor, classes, seen=None):
    seen = set() if seen is None else seen
    key = kind.lower()
    if key == ancestor.lower():
        return True
    if key in seen:
        return False
    seen.add(key)
    candidates = classes.get(key, [])
    return len(candidates) == 1 and inherits(candidates[0][0], ancestor, classes, seen)


def read_cfg(path):
    kind = None
    for line_number, raw in enumerate(path.read_text(encoding='utf-8-sig', errors='replace').splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        match = HEADER.fullmatch(line)
        if match:
            kind, art, params = match.groups()
            art = integer(art)
            params = params or ''
            continue
        match = POSITION.fullmatch(line)
        if not match or kind is None:
            raise ValueError(f'Invalid decoration at {path}:{line_number}: {line}')
        yield kind, art, params, tuple(integer(v) for v in match.groups()), line_number


def hidden_type(kind, classes, seen=None):
    """Recognize server-only triggers by source visibility, including inheritance."""
    seen = set() if seen is None else seen
    key = kind.lower()
    if key in seen:
        return False
    seen.add(key)
    candidates = classes.get(key, [])
    if len(candidates) != 1:
        return False
    parent, body, _ = candidates[0]
    if re.search(r'\bVisible\s*=\s*false\s*;', body) and not re.search(r'\bVisible\s*=\s*true\s*;', body):
        return True
    return hidden_type(parent, classes, seen)


@lru_cache(maxsize=2)
def load_decorations(server=ROOT / 'runuo'):
    """Return (facet -> world placements, report). No client files are modified."""
    server = pathlib.Path(server)
    if not server.exists():
        recipe = json.loads((ROOT / 'tools/asset-recipe.json').read_text(encoding='utf8'))
        return recipe['decorations'], {'source': 'Curated server placement configuration'}
    classes = source_classes(server)
    by_facet = defaultdict(list)
    report = {'files': 0, 'entries': 0, 'unsupported': {}, 'hidden': {}, 'placements': {}, 'rejectedEntries': []}
    unsupported = Counter()
    hidden = Counter()
    for folder in ('Britannia',) + FACETS:
        facets = ('Trammel', 'Felucca') if folder == 'Britannia' else (folder,)
        for path in sorted((server / 'Data' / 'Decoration' / folder).glob('*.cfg')):
            report['files'] += 1
            for kind, art, params, (x, y, z), line in read_cfg(path):
                report['entries'] += 1
                hue_match = re.search(r'(?:^|;)\s*Hue\s*=\s*(' + NUMBER + r')', params, re.I)
                hue = integer(hue_match.group(1)) if hue_match else 0
                components = addon_components(kind, classes)
                is_addon = kind.endswith('Addon') or inherits(kind, 'BaseAddon', classes)
                if not is_addon and hidden_type(kind, classes):
                    hidden[kind] += 1
                    continue
                if components is not None:
                    # Decorate.Construct overrides just the zero-offset component.
                    components = [(art if art > 0 and (dx, dy, dz) == (0, 0, 0) else iid, dx, dy, dz) for iid, dx, dy, dz in components]
                elif kind in ('AnkhNorth', 'AnkhWest'):
                    # Ankhs.cs spawns a second InternalItem beside the root.
                    bloodied = bool(re.search(r'(?:^|;)\s*Bloodied\s*(?:;|$)', params))
                    if kind == 'AnkhNorth':
                        components = [(0x1E5D if bloodied else 4, 0, 0, 0), (0x1E5C if bloodied else 5, 1, 0, 0)]
                    else:
                        components = [(0x1D98 if bloodied else 3, 0, 0, 0), (0x1D97 if bloodied else 2, 0, 1, 0)]
                elif is_addon or art <= 0:
                    unsupported[kind] += 1
                    report['rejectedEntries'].extend({'facet': facet, 'x': x, 'y': y, 'z': z, 'type': kind, 'source': path.relative_to(server).as_posix() + ':' + str(line)} for facet in facets)
                    continue
                else:
                    components = [(art, 0, 0, 0)]
                for iid, dx, dy, dz in components:
                    for facet in facets:
                        by_facet[facet].append({'x': x + dx, 'y': y + dy, 'z': z + dz, 'itemId': iid, 'hue': hue, 'decorationType': kind, 'decorationSource': path.relative_to(server).as_posix() + ':' + str(line)})
    report['unsupported'] = dict(sorted(unsupported.items()))
    report['hidden'] = dict(sorted(hidden.items()))
    report['placements'] = {facet: len(items) for facet, items in by_facet.items()}
    return dict(by_facet), report


def region_decorations(region, existing=(), server=ROOT / 'runuo'):
    """Return new *local-coordinate* items and duplicate counts for a region.

    Inputs use the location manifest's facet/sourceX/sourceY/width/height shape.
    Existing manifest statics are local coordinates, as are returned placements.
    Repeated calls never mutate the cached complete world decoration catalogue.
    """
    all_items, _ = load_decorations(server)
    facet = region['facet']
    if isinstance(facet, int):
        facet = FACETS[facet]
    seen = {(s['x'], s['y'], s['z'], s['itemId'], s.get('hue', 0)) for s in existing}
    result = []
    duplicates = 0
    for original in all_items.get(facet, []):
        x, y = original['x'] - region['sourceX'], original['y'] - region['sourceY']
        if not (0 <= x < region['width'] and 0 <= y < region['height']):
            continue
        key = (x, y, original['z'], original['itemId'], original['hue'])
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        result.append({**original, 'x': x, 'y': y})
    return result, {'added': len(result), 'duplicates': duplicates}


if __name__ == '__main__':
    import json
    _, stats = load_decorations()
    print(json.dumps(stats, indent=2))
