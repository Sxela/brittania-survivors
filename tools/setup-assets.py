"""Build local resources from a user-supplied Classic client, never download assets.

All work happens in a fresh staging directory. A failed extraction leaves any
existing installation intact. Fixed recipes and pinned Pillow make repeat runs
reproducible for the same client files; the report hashes both inputs and output.
"""
from __future__ import annotations
import argparse, hashlib, json, os, pathlib, shutil, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
TOOLS = ['classic_archive.py','classic_paths.py','client_bodymap.py','classic_animation.py','classic_compression.py',
 'classic_data.py','classic_font.py','classic_map_metrics.py','classic_sound_roles.py',
 'classic_enemy_layers.py','extract_classic_actors.py','extract_classic_audio.py',
 'extract_classic_effects.py','extract_classic_equipment.py','extract_classic_ui.py',
 'extract_classic_maps.py','extract_classic_menu.py','extract_classic_hud.py',
 'extract_paperdoll_controls.py','extract_classic_minimap.py','extract_classic_summons.py',
 'export_native_locations.py','export_zone_maps.py','location_decorations.py',
 'location_collision.py','location_backdrop.py','location_floor_repairs.py',
 'location_bounds.py','prepare_ground_patches.py','optimize-map-assets.py','setup-assets.py','asset-recipe.json']
REQUIRED = ['artLegacyMUL.uop','gumpartLegacyMUL.uop','soundLegacyMUL.uop',
 'tiledata.mul','hues.mul','radarcol.mul','animdata.mul','anim.mul','anim.idx',
 'mobtypes.txt','Body.def','Bodyconv.def','Equipconv.def','gump.def',
 'unifont.mul','unifont1.mul','unifont2.mul']

def digest(file):
    h=hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def validate(client):
    missing=[name for name in REQUIRED if not (client/name).is_file()]
    for facet in range(6):
        for name in [f'map{facet}LegacyMUL.uop',f'statics{facet}.mul',f'staidx{facet}.mul']:
            if not (client/name).is_file():missing.append(name)
    if missing:raise ValueError('Incomplete/unsupported Classic client. Missing: '+', '.join(missing))
    if ROOT==client or ROOT in client.parents:raise ValueError('Choose a client installation outside this repository.')

def write(relative,value):
    file=ROOT/relative;file.parent.mkdir(parents=True,exist_ok=True)
    file.write_text(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n',encoding='utf8')

def worker(client):
    from classic_archive import apply_material_hue_adaptations
    from classic_data import ClassicData
    import extract_classic_actors as actors
    import extract_classic_ui as ui
    import extract_classic_equipment as equipment
    import extract_classic_audio as audio
    import extract_classic_effects as effects
    recipe=json.loads((ROOT/'tools/asset-recipe.json').read_text(encoding='utf8'))
    print('Extracting creatures, player and wearable animations...',flush=True)
    actor,world=actors.extract(client,audit=False)
    # No Enhanced-client dependency: explicitly substitute the Classic spectre
    # for the one catalog creature whose native body is absent from this client.
    for body in actor['animationCoverage']['missingBodies']:
        if body!=260:raise ValueError('Unsupported client: missing creature body '+str(body))
        actor['animations'][str(body)]={**actor['animations']['26'],'compatibilityFallback':'Classic spectre art for missing Corporeal Brume body'}
        world['corpses'][str(body)]={**world['corpses']['26'],'compatibilityFallback':'Classic spectre corpse for missing Corporeal Brume body'}
    actor['images']={};actor['artStyle']='classic';apply_material_hue_adaptations(actor)
    print('Extracting UI, item art, effects and audio...',flush=True)
    uim=ui.extract(client);data=ClassicData(client)
    try:eq=equipment.extract(client,ROOT/'game/assets/classic-equipment',data)
    finally:data.close()
    uim['images'].update(eq['images']);uim['equipment']=eq['equipment'];uim['artStyle']='classic'
    for archetype,icon in [('mage','energy-bolt'),('warrior','reactive-armor'),('ranger','bless')]:
        actor['images']['class-'+archetype]=uim['images']['abilities/spells/'+icon]
    write('game/assets/manifest.json',actor);write('game/assets/ui/manifest.json',uim)
    write('game/assets/abilities/manifest.json',json.loads((ROOT/'game/assets/classic-ui/abilities/manifest.json').read_text()))
    world.update(artStyle='classic',defaultSkinHue=1002)
    write('game/assets/world-equipment/manifest.json',world)
    from classic_enemy_layers import augment_world
    augment_world(json.loads((ROOT/'game/data/enemy-equipment.json').read_text()),client)
    write('game/assets/effects/manifest.json',effects.extract(client))
    audio.extract(client)
    write('game/assets/audio/manifest.json',json.loads((ROOT/'game/assets/classic-audio/manifest.json').read_text()))
    import extract_classic_menu,extract_classic_hud,extract_paperdoll_controls
    extract_classic_menu.extract(client);extract_classic_hud.extract(client);extract_paperdoll_controls.extract(client)
    data=ClassicData(client)
    try:
        for role,iid,hue in [('resources/gold-ingots',0x1beb,0),('resources/gold-ore',0x19b9,0x8a5),('resources/gold-rock-0',0x1363,0x8a5),('resources/gold-rock-1',0x1364,0x8a5),('resources/gold-rock-2',0x1365,0x8a5),('loot/chest',0xe41,0),('inventory/trash',0xe77,0),('scenery/tree-stump',3671,0)]:
            image=data.art(iid)
            if image is None:raise ValueError('Missing required item art '+str(iid))
            file=ROOT/'game/assets/classic-ui'/(role.replace('/','-')+'.png');image.save(file)
            uim=json.loads((ROOT/'game/assets/ui/manifest.json').read_text())
            uim['images'][role]={'src':file.relative_to(ROOT/'game').as_posix(),'width':image.width,'height':image.height,'itemId':iid,'hue':hue}
            write('game/assets/ui/manifest.json',uim)
    finally:data.close()
    import extract_classic_maps,extract_classic_minimap,extract_classic_summons
    write('game/assets/maps/manifest.json',recipe['legacyMaps'])
    extract_classic_maps.extract(client)
    write('game/assets/maps/manifest.json',json.loads((ROOT/'game/assets/classic-maps/manifest.json').read_text()))
    extract_classic_minimap.extract(client);extract_classic_summons.extract(client)
    print('Extracting all native locations (this is the slowest step)...',flush=True)
    import export_native_locations
    export_native_locations.export(client,recipe_windows=recipe['windows'])
    # Legacy procedural route support is retired; native locations drive runs.
    write('game/assets/zone-maps/manifest.json',{'formatVersion':3,'images':{},'regions':[]})
    # A deterministic locally derived background needs no distributed bitmap.
    from PIL import Image,ImageEnhance
    maps=json.loads((ROOT/'game/assets/maps/manifest.json').read_text())
    source=ROOT/'game'/maps['images'][maps['regions'][0]['ground']]['src']
    with Image.open(source) as image:
        ImageEnhance.Brightness(image.convert('RGB').resize((1280,720))).enhance(.5).save(ROOT/'game/assets/menu-background.png')
    subprocess.run(['node',str(ROOT/'tools/build-mobile.mjs')],cwd=ROOT,check=True,env={**os.environ,'BRITANNIA_ASSET_PYTHON':sys.executable})
    verify_resources()
    # Absolute installation paths and environment-dependent audit fields are
    # intentionally absent from local output manifests.
    def clean(value):
        if isinstance(value,list):return [clean(v)for v in value]
        if isinstance(value,dict):return {k:clean(v)for k,v in value.items()if k not in ('sourceClient','serverReferenceScope')}
        return value
    for file in sorted((ROOT/'game/assets').rglob('*.json')):
        file.write_text(json.dumps(clean(json.loads(file.read_text())),sort_keys=True,separators=(',',':'))+'\n',encoding='utf8')

def verify_resources():
    missing=set()
    def inspect(value):
        if isinstance(value,dict):
            src=value.get('src')
            if isinstance(src,str)and src.startswith('assets/'):
                file=(ROOT/'game'/src).resolve()
                if not file.is_relative_to(ROOT/'game/assets')or not file.is_file():missing.add(src)
            for v in value.values():inspect(v)
        elif isinstance(value,list):
            for v in value:inspect(v)
    for file in sorted((ROOT/'game/assets').rglob('*.json')):inspect(json.loads(file.read_text()))
    if missing:raise ValueError('Missing extracted resources: '+', '.join(sorted(missing)))
    print('All resource references resolve.',flush=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client',default=os.environ.get('UO_CLIENT_PATH'))
    parser.add_argument('--check',action='store_true',help='Validate inputs without extracting')
    parser.add_argument('--rebuild',action='store_true',help='Keep existing assets as assets.previous, then replace after success')
    parser.add_argument('--worker',action='store_true',help=argparse.SUPPRESS)
    args=parser.parse_args()
    if not args.client:parser.error('Supply --client /path/to/Ultima-Online-Classic or UO_CLIENT_PATH')
    client=pathlib.Path(args.client).resolve();validate(client)
    import PIL
    if PIL.__version__!='11.3.0':raise ValueError('Install pinned extraction dependencies: python -m pip install -r requirements-assets.txt')
    if args.check:print('Classic client inputs and Pillow version are ready.');return
    if args.worker:worker(client);return
    target=ROOT/'game/assets';backup=ROOT/'game/assets.previous'
    existing=target.exists() and any(p.is_file() or p.is_symlink() for p in target.rglob('*'))
    if existing and not args.rebuild:raise ValueError('Assets already exist; use --rebuild to retain a backup and replace them after successful extraction.')
    if backup.exists():raise ValueError('Move game/assets.previous elsewhere before rebuilding.')
    cache=ROOT/'.cache';cache.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='asset-setup-',dir=cache) as temp:
        stage=pathlib.Path(temp)
        for name in TOOLS+['build-mobile.mjs']:
            dest=stage/'tools'/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/'tools'/name,dest)
        shutil.copytree(ROOT/'game/data',stage/'game/data')
        for module in (ROOT/'game').glob('*.mjs'):shutil.copyfile(module,stage/'game'/module.name)
        print('Hashing local client inputs...',flush=True)
        inputs={p.name:digest(p)for p in sorted(client.iterdir())if p.is_file()and p.suffix.lower()in ('.uop','.mul','.idx','.def','.txt')}
        subprocess.run([sys.executable,str(stage/'tools/setup-assets.py'),'--client',str(client),'--worker'],cwd=stage,check=True)
        assets=stage/'game/assets'
        outputs={p.relative_to(assets).as_posix():digest(p)for p in sorted(assets.rglob('*'))if p.is_file()}
        report={'version':1,'pillow':PIL.__version__,'python':sys.version.split()[0],'recipeSha256':digest(ROOT/'tools/asset-recipe.json'),'tools':{name:digest(ROOT/'tools'/name)for name in TOOLS+['build-mobile.mjs']},'inputs':inputs,'outputs':outputs}
        (assets/'setup-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
        if target.exists():
            if existing:target.rename(backup)
            else:
                # Retired export files can leave empty directory shells. rmdir
                # refuses nonempty directories rather than deleting new files.
                for folder in sorted(target.rglob('*'),key=lambda p:len(p.parts),reverse=True):folder.rmdir()
                target.rmdir()
        try:shutil.move(str(assets),target)
        except BaseException:
            if backup.exists()and not target.exists():backup.rename(target)
            raise
    print('Resources ready. Run npm start (browser) or npm run desktop. Inputs were not modified.')

if __name__=='__main__':
    try:main()
    except (ValueError,OSError,subprocess.CalledProcessError) as error:
        print('Asset setup failed: '+str(error),file=sys.stderr);sys.exit(1)
