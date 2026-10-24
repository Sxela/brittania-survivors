"""Recover Classic Client creature, player, and wearable animation sheets."""
from __future__ import annotations
import argparse
import hashlib
import json
import pathlib
import struct
from PIL import Image
from classic_animation import ClassicAnimations, DEFAULT_CLASSIC
from classic_animation import rgb555
from classic_data import ClassicData
from classic_archive import catalog_bodies

ROOT = pathlib.Path(__file__).resolve().parents[1]


def item_animation_ids(client):
    """Use the shared Classic item metadata reader for wearable animation IDs."""
    source = ClassicData(client)
    groups = (len(source.tiles)-512*(4+32*30))//(4+32*41)
    result = {iid: source.tile(iid)['animation'] for iid in range(groups*32)}
    source.close()
    return result


def extract_hues(client, out):
    data = (client/'hues.mul').read_bytes()
    if len(data)%708:
        raise ValueError('Unexpected Classic hues.mul group size')
    palettes, native, provenance = {}, {}, {}
    for group in range(len(data)//708):
        for entry in range(8):
            number = group*8+entry+1
            offset = group*708+4+entry*88
            colors = [list(rgb555(value)) for value in struct.unpack_from('<32H', data, offset)]
            native[str(number)] = colors
            palettes[str(number)] = [colors[value>>3] for value in range(256)]
            provenance[str(number)] = {'sourceOffset': offset,
                'sourceSha256': hashlib.sha256(data[offset:offset+88]).hexdigest(),
                'name': data[offset+68:offset+88].split(b'\0')[0].decode('latin1')}
    result = {'formatVersion': 1, 'sourceArchive': 'hues.mul',
              'sourceSha256': hashlib.sha256(data).hexdigest(),
              'lookup': 'Classic source red channel >>3 selects one of 32 native RGB555 hue steps. Expanded 256 table preserves existing renderer API.',
              'palettes': palettes, 'native32Palettes': native, 'provenance': provenance}
    (out/'hues.json').write_text(json.dumps(result, separators=(',', ':'))+'\n', encoding='utf8')
    return {'src': 'assets/classic-actors/hues.json', 'count': len(palettes), 'samplesPerHue': 256,
            'nativeSamplesPerHue': 32, 'sourceArchive': 'hues.mul'}


def extract(client=DEFAULT_CLASSIC, out=ROOT/'game/assets/classic-actors', audit=True):
    client, out = pathlib.Path(client), pathlib.Path(out)
    out.mkdir(parents=True, exist_ok=True)
    animations = ClassicAnimations(client)
    catalog = json.loads((ROOT/'game/data/catalog.json').read_text(encoding='utf8'))
    wanted = catalog_bodies(catalog)
    actor = {'formatVersion': 1, 'sourceClient': str(client), 'animations': {},
             'limitations': ['Five native facing rows S,SW,W,NW,N are mirrored for the other directions.',
                            'Body.def/Bodyconv.def and mobtypes flags select source artwork and default hues.',
                            'A client body is artwork; gameplay classes and stats remain sourced from RunUO.']}
    actor['hues'] = extract_hues(client, out)
    world = {'formatVersion': 1, 'sourceClient': str(client), 'playerBases': {}, 'equipment': {},
             'corpses': {}, 'missing': {'equipment': {}, 'corpses': []},
             'limitations': actor['limitations'][:],
             'drawOrder': {'sourceArchive': 'Classic native layer ordering',
                           'twoHandedWeapons': {'exceptionItemIds': []}}}
    cache, errors = {}, {}

    def sheet(body, action, role, corpse=False, final=False, aligned_bottom=None):
        key = body, action, corpse, final
        if key not in cache:
            frames, evidence = animations.frames(body, action, corpse, final)
            visible = [frame for frame in frames if frame is not None]
            if not visible:
                raise ValueError('No visible native Classic frames')
            columns = len(frames)//5
            if not columns or len(frames)%5:
                raise ValueError('Incomplete Classic facing rows')
            left, top = min(f[1] for f in visible), min(f[2] for f in visible)
            right, bottom = max(f[3] for f in visible), max(f[4] for f in visible)
            width, height = right-left, bottom-top
            if width*columns > 8192 or height*5 > 8192:
                raise ValueError('Classic atlas exceeds 8192 pixel bound')
            image = Image.new('RGBA', (width*columns, height*5))
            for i, frame in enumerate(frames):
                if frame is not None:
                    image.alpha_composite(frame[0], ((i%columns)*width+frame[1]-left,
                                                    (i//columns)*height+frame[2]-top))
            relative = f'{role}/body-{body}-action-{action}.png'
            destination = out/relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            image.save(destination)
            cache[key] = {**evidence, 'src': 'assets/classic-actors/'+relative,
                          'bodyId': body, 'cellWidth': width, 'cellHeight': height,
                          'framesPerDirection': columns, 'directions': 5, 'frameStride': 1,
                          'nativeBounds': [left, top, right, bottom],
                          'anchorX': -left, 'anchorY': height,
                          'originalOriginAnchorY': -top,
                          'transparentMissingFrameCount': sum(f is None for f in frames),
                          'pose': 'finalDeathFrame' if final else 'walking'}
        result = dict(cache[key])
        if aligned_bottom is not None:
            result['anchorY'] = aligned_bottom-result['nativeBounds'][1]
        return result

    for body in sorted(wanted):
        try:
            actor['animations'][str(body)] = sheet(body, 0, 'actors')
            source = actor['animations'][str(body)]['animationBodyId']
            kind, flags = animations.type(source)
            idle = 4 if kind in ('human', 'equipment') else 2 if kind == 'animal' and not flags & 0x10000 else 1
            try:
                actor['animations'][str(body)]['idle'] = sheet(body, idle, 'idle', aligned_bottom=actor['animations'][str(body)]['nativeBounds'][3])
            except (ValueError, IndexError, struct.error) as error:
                errors[f'idle:{body}'] = str(error)
        except (ValueError, IndexError, struct.error) as error:
            errors[str(body)] = str(error)
    for sex, body in [('male', 400), ('female', 401)]:
        world['playerBases'][sex] = {}
        for mode, action in [('walk', 0), ('walkArmed', 1), ('mine', 11)]:
            world['playerBases'][sex][mode] = sheet(body, action, 'players')
    equipment_ids = item_animation_ids(client)
    wanted_items = {}
    for item in catalog['items']:
        for iid in item.get('itemIds', [item.get('itemId')]):
            if iid is not None:
                wanted_items.setdefault(int(iid), item)
        if item.get('itemId') is not None:
            wanted_items.setdefault(int(item['itemId']), item)
    wanted_items.setdefault(0xe86, {'id':'pickaxe','slot':'weapon'})
    for iid, item in sorted(wanted_items.items()):
        graphic = equipment_ids.get(iid, 0)
        record = {'itemId': iid, 'catalogId': item['id'], 'slot': item.get('slot'),
                  'animationBodyId': graphic, 'layers': {},
                  'mapping': {'sourceArchive': 'tiledata.mul', 'field': 'animation', 'animationId': graphic}}
        if not graphic:
            world['missing']['equipment'][str(iid)] = 'Tiledata has no animated wearable layer (jewelry, talismans and invisible gear can intentionally have none)'
            continue
        for sex, player in [('male', 400), ('female', 401)]:
            mapped, _, hue = animations.equipment.get((player, graphic), (graphic, 0, 0))
            layers = {}
            for mode, action in [('walk', 0), ('walkArmed', 1), ('mine', 11)]:
                try:
                    layer = sheet(mapped, action, 'layers', aligned_bottom=world['playerBases'][sex][mode]['nativeBounds'][3])
                    layer['alignedPlayerBodyId'] = player
                    if hue:
                        layer['equipmentConversionHue'] = hue
                    layers[mode] = layer
                except (ValueError, IndexError, struct.error) as error:
                    errors[f'item:{iid}:{sex}:{mode}'] = str(error)
            if layers:
                record['layers'][sex] = layers
                record['femaleAnimationBodyId' if sex == 'female' else 'animationBodyId'] = mapped
        if record['layers']:
            world['equipment'][str(iid)] = record
        else:
            world['missing']['equipment'][str(iid)] = f'No walking frames for native wearable animation {graphic}'
    for body in sorted(wanted):
        if str(body) not in actor['animations']:
            world['missing']['corpses'].append(body)
            continue
        source = animations.resolve(body, True)[0]
        kind, flags = animations.type(source)
        actions = (21, 22) if kind in ('human', 'equipment') else (2, 3) if flags & 0x10000 or kind == 'monster' else (8, 12)
        # Flags can select a different native MUL grouping from mobtypes' semantic type.
        if not flags & 0x10000:
            _, bank, mapped, _ = animations.resolve(body, True)
            group = animations.layout(mapped, bank, source)[2]
            actions = (21, 22) if group == 'human' else (8, 12) if group in ('animal', 'sea_monster') else (2, 3)
        for action in actions:
            try:
                world['corpses'][str(body)] = sheet(body, action, 'corpses', True, True,
                    actor['animations'][str(body)]['nativeBounds'][3])
                break
            except (ValueError, IndexError, struct.error) as error:
                errors[f'corpse:{body}:{action}'] = str(error)
        else:
            world['missing']['corpses'].append(body)

    # Inventory all art identities, not just server-used bodies. Numeric entries
    # are deliberately not assigned guessed species or gameplay statistics.
    ids = set(range(2048)) | set(animations.types) | set(animations.bodies) | set(animations.conversions) | {b for b, _ in animations.uop}
    available, unknown = [], []
    used_by = {}
    for monster in catalog['monsters']:
        for body in monster.get('bodyIds', [monster['body']]):
            used_by.setdefault(body, []).append(monster['className'])
    server_rows, server_scope = [], 'Local client only'
    if audit:
        from audit_monsters import inventory_source
        server_rows, server_scope = inventory_source(ROOT/'runuo')
    references = {}
    for row in server_rows:
        if row['abstract']:
            continue
        for body in row.get('bodyIds', []):
            references.setdefault(body, []).append({'className': row['className'], 'source': row['path'],
                                                    'scope': row['scope'], 'bodyEvidence': row['bodyEvidence']})
    for body in sorted(ids):
        source, bank, mapped, hue = animations.resolve(body)
        kind, flags = animations.type(source)
        action = animations.sequence.get(source, {}).get(0, 0)
        mul, uop = animations.has_mul(body), (source, action) in animations.uop
        if not mul and not uop:
            continue
        record = {'bodyId': body, 'sourceBodyId': source, 'type': kind, 'flags': flags,
                  'defaultHue': hue, 'mulBank': bank if mul else None, 'mulBankBodyId': mapped if mul else None,
                  'hasMulWalk': mul, 'hasUopWalk': uop, 'serverClasses': used_by.get(body, []),
                  'otherServerReferences': [r for r in references.get(body, []) if r['className'] not in used_by.get(body, [])]}
        available.append(record)
        if not record['serverClasses'] and kind not in ('equipment', 'human'):
            unknown.append(record)
    resolved = sorted(map(int, actor['animations']))
    actor['animationCoverage'] = {'requestedBodies': sorted(wanted), 'resolvedBodies': resolved,
                                'missingBodies': sorted(wanted-set(resolved)), 'decodeErrors': errors}
    actor['clientArtInventory'] = {'availableBodies': available, 'additionalCreatureBodies': unknown,
                                  'uopBodyActions': len(animations.uop), 'sequenceBodies': len(animations.sequence),
                                  'mulBanks': sorted(animations.files),
                                  'serverReferenceScope': server_scope,
                                  'note': 'Additional creature bodies are numeric art identities, not an inferred monster roster.'}
    bank_inventory = []
    for bank, index in sorted(animations.indices.items()):
        length = animations.files[bank].seek(0, 2)
        valid = sum(position != 0xffffffff and size >= 520 and position+size <= length
                    for position, size, _ in struct.iter_unpack('<III', index))
        bank_inventory.append({'bank': bank, 'sourceArchive': pathlib.Path(animations.files[bank].name).name,
                               'indexRecords': len(index)//12, 'nonemptyDirectionBlocks': valid,
                               'sourceIndexSha256': hashlib.sha256(index).hexdigest(), 'sourceBytes': length})
    actor['clientArtInventory']['mulBankInventory'] = bank_inventory
    world['coverage'] = {'requestedItemIds': len(wanted_items), 'equipmentItemIds': len(world['equipment']),
                         'corpseBodies': len(world['corpses']), 'uniqueSheets': len(cache)}
    for name, manifest in [('manifest.json', actor), ('world-manifest.json', world)]:
        (out/name).write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf8')
    if audit:write_report(actor, world, client)
    animations.close()
    print(json.dumps({'actors': len(resolved), 'missing': actor['animationCoverage']['missingBodies'],
                      'world': world['coverage'], 'allClientBodies': len(available), 'additionalCreatureBodies': len(unknown)}))
    return actor, world


def write_report(actor, world, client=DEFAULT_CLASSIC):
    """Compare actual client art identities with every concrete server creature."""
    from audit_monsters import inventory_source
    rows, scope = inventory_source(ROOT/'runuo')
    catalog = json.loads((ROOT/'game/data/catalog.json').read_text())
    existing = {item['className'] for item in catalog['monsters']}
    available = {row['bodyId'] for row in actor['clientArtInventory']['availableBodies']}
    extra, missing, unresolved = [], [], []
    for row in rows:
        if row['abstract']:
            continue
        record = {'className': row['className'], 'source': row['path'], 'scope': row['scope'],
                  'bodyIds': row['bodyIds'], 'bodyEvidence': row['bodyEvidence'],
                  'classicAvailableBodies': [b for b in row['bodyIds'] if b in available],
                  'classicMissingBodies': [b for b in row['bodyIds'] if b not in available]}
        if not row['bodyIds']:
            unresolved.append(record)
        elif record['classicMissingBodies']:
            missing.append(record)
        if row['className'] not in existing:
            extra.append(record)
    inventory = actor['clientArtInventory']
    result = {'sourceClient': str(client), 'sourceScope': scope,
              'currentSurvivorClasses': len(existing), 'additionalServerClasses': extra,
              'serverClassesWithMissingClassicBodies': missing,
              'serverClassesWithoutLiteralBodyResolution': unresolved,
              'additionalClientCreatureArt': inventory['additionalCreatureBodies'],
              'limitations': ['Client indexes establish artwork availability, not monster names or gameplay stats.',
                             'Additional server classes include peaceful animals, vendors, NPCs, summons, mounts, familiars and encounter helpers.',
                             'Body.def can intentionally turn an old numeric identity into a different modern creature; IDs are version-sensitive.',
                             'The broad server inventory enumerates literal alternatives across class bodies; runtime body changes and conditional branches can over-approximate constructor appearances.']}
    destination = ROOT/'research/classic-monster-inventory.json'
    destination.write_text(json.dumps(result, indent=2)+'\n', encoding='utf8')
    known_extra = [row for row in inventory['additionalCreatureBodies'] if row['otherServerReferences']]
    lines = ['# Classic Client animation and monster comparison', '',
             f'Source: `{client}`. Read-only extraction; this is the installed Classic Client asset set, not a verified Renaissance-era release.', '',
             '## Confirmed coverage', '',
             f'- All six `anim*.idx` tables were scanned, plus all {inventory["uopBodyActions"]:,} body/action members in five AnimationFrame UOPs and {inventory["sequenceBodies"]} AnimationSequence definitions.',
             f'- {len(actor["animations"])} of 230 requested body identities have original Classic walking art and genuine final-death poses; 307 RunUO gameplay classes remain the source roster.',
             '- `GazerLarva` body 778 uses its installed anim2 body 46. Installed Bodyconv expansion art takes precedence over generic Body.def compatibility aliases, including dressed Evil Mages and Juka creatures.',
             '- `CorporealBrume` body 260 is the one Classic gap. RunUO directly derives it from BaseCreature and assigns 0x104 with a `TODO: Verify` comment. Classic Bodyconv maps 260 to anim5 body 19 (commented Travesty), whose direction blocks contain no artwork. There is no inherited server body alternative or shipped Body.def/AnimationSequence replacement.',
             f'- {world["coverage"]["equipmentItemIds"]}/{world["coverage"]["requestedItemIds"]} catalog item identities have Classic walking wearable layers. The remaining items are mostly necklaces/gorget/jewelry, talismans, circlets and elven glasses without native walking layers; none are replaced by invented art.',
             '- Native RGB555 RLE pixels, five directions, transparent wearable phases, frame origins and 3000 original 32-step hue palettes are retained.',
             '- Bodyconv explicitly restores original spider 28 and daemon 9 rather than their Lord Blackthorn replacement art.', '',
             '## Does the monster list differ?', '',
             f'The client contains {len(inventory["availableBodies"])} index-backed body identities, including equipment, humans and aliases. {len(inventory["additionalCreatureBodies"])} non-human/non-equipment identities are outside the current gameplay catalog; {len(known_extra)} have additional RunUO source references. Many IDs alias the same visible creature. These are not 256 newly identified species.', '',
             f'Broad server scan: {scope["sourceFiles"]} C# files, {scope["classDeclarationsWithBase"]} declarations, {len(extra)} concrete BaseCreature descendants outside the 307-class survivors roster. These include animals, mounts, summons, vendors and NPCs. No gameplay class is inferred from client pixels alone, and this report does not mutate the gameplay roster.', '',
             'Additional client creature identities with server source references:', '',
             '| Body | Classic source body | RunUO classes outside the current roster |',
             '|---:|---:|---|']
    for row in known_extra:
        names = sorted({r['className'] for r in row['otherServerReferences']})
        lines.append(f'| {row["bodyId"]} | {row["sourceBodyId"]} | '+', '.join(names)+' |')
    lines += ['', '## Full-server missing-art scan', '',
              'Every concrete BaseCreature descendant was checked against the Classic body inventory, including classes outside the survivors roster. Multiple body alternatives are retained rather than selecting a random branch.', '',
              '| Class | Missing Classic bodies | Source |', '|---|---|---|']
    for row in missing:
        lines.append(f'| {row["className"]} | '+', '.join(map(str, row['classicMissingBodies']))+f' | `{row["source"]}` |')
    lines += ['', f'{len(unresolved)} concrete server classes have no bounded literal body resolution in the broad inventory; they remain explicit in [classic-monster-inventory.json](classic-monster-inventory.json), with every additional class and source reference.', '',
              '## Recovery and validation', '',
              '`python tools/extract_classic_actors.py` regenerates source art/manifests/hues and this report. `--verify` checks all generated sheet dimensions, provenance, player/layer origin alignment and hue table dimensions without needing the installation.', '',
              'Decoder format corroboration: [ClassicUO AnimationsLoader](https://github.com/ClassicUO/ClassicUO/blob/main/src/ClassicUO.Assets/AnimationsLoader.cs). Extraction uses independently implemented bounded readers and actual installed bytes. No client executable was run or modified.', '']
    (ROOT/'research/classic-monsters.md').write_text('\n'.join(lines), encoding='utf8')
    return {'additionalServerClasses': len(extra), 'missingClassicClasses': len(missing), 'unresolvedClasses': len(unresolved)}


def verify(out=ROOT/'game/assets/classic-actors'):
    out = pathlib.Path(out)
    actor = json.loads((out/'manifest.json').read_text())
    world = json.loads((out/'world-manifest.json').read_text())
    definitions = list(actor['animations'].values())+list(world['corpses'].values())
    for sprites in world['playerBases'].values():
        definitions.extend(sprites.values())
    for item in world['equipment'].values():
        for sex, modes in item['layers'].items():
            for mode, sprite in modes.items():
                base = world['playerBases'][sex][mode]
                assert sprite['anchorY'] == base['nativeBounds'][3]-sprite['nativeBounds'][1]
                definitions.append(sprite)
    for sprite in list(definitions):
        if sprite.get('idle'):
            definitions.append(sprite['idle'])
    unique = {}
    for sprite in definitions:
        path = ROOT/'game'/sprite['src']
        if path not in unique:
            with Image.open(path) as image:
                unique[path] = image.size
        assert unique[path] == (sprite['cellWidth']*sprite['framesPerDirection'], sprite['cellHeight']*5)
        assert sprite['sourceSha256'] and sprite['pixelFormat'].startswith('Classic RGB555')
    palettes = json.loads((out/'hues.json').read_text())
    assert len(palettes['palettes']) == actor['hues']['count'] == 3000
    assert all(len(palette) == 256 for palette in palettes['palettes'].values())
    print(json.dumps({'verifiedUniqueSheets': len(unique), 'actorBodies': len(actor['animations']),
                      'wearableItems': len(world['equipment']), 'huePalettes': len(palettes['palettes'])}))
    return len(unique)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--client', default=str(DEFAULT_CLASSIC))
    parser.add_argument('--out', default=str(ROOT/'game/assets/classic-actors'))
    parser.add_argument('--verify', action='store_true')
    parser.add_argument('--report', action='store_true')
    args = parser.parse_args()
    if args.verify:
        verify(args.out)
    elif args.report:
        out = pathlib.Path(args.out)
        print(json.dumps(write_report(json.loads((out/'manifest.json').read_text()),
                                      json.loads((out/'world-manifest.json').read_text()), args.client)))
    else:
        extract(args.client, args.out)
