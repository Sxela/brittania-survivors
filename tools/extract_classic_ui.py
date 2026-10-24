"""Extract Classic gumps and native bitmap typefaces for the survivor UI."""
from __future__ import annotations
import argparse,hashlib,json,pathlib
from PIL import Image
from classic_font import bitmap_font
from classic_paths import DEFAULT_CLASSIC
SPELLS=['clumsy','create-food','feeblemind','heal','magic-arrow','night-sight','reactive-armor','weaken','agility','cunning','cure','harm','magic-trap','magic-untrap','protection','strength','bless','fireball','magic-lock','poison','telekinesis','teleport','unlock','wall-of-stone','arch-cure','arch-protection','curse','fire-field','greater-heal','lightning','mana-drain','recall','blade-spirits','dispel-field','incognito','magic-reflection','mind-blast','paralyze','poison-field','summon-creature','dispel','energy-bolt','explosion','invisibility','mark','mass-curse','paralyze-field','reveal','chain-lightning','energy-field','flame-strike','gate-travel','mana-vampire','mass-dispel','meteor-swarm','polymorph','earthquake','energy-vortex','resurrection','air-elemental','summon-daemon','earth-elemental','fire-elemental','water-elemental']
def extract(client=DEFAULT_CLASSIC,out='game/assets/classic-ui'):
    from classic_data import ClassicData
    client=pathlib.Path(client);out=pathlib.Path(out);out.mkdir(parents=True,exist_ok=True);data=ClassicData(client)
    manifest={'schemaVersion':1,'sourceClient':str(client),'sourceArchive':'gumpartLegacyMUL.uop','images':{},'fonts':{},'roles':{},'limitations':['Classic skills have no equivalent of the Enhanced skill-icon atlas. Skill labels use explicitly associated original spell or weapon-ability gumps.']}
    def save(key,image,ids,**extra):
        if image is None:raise ValueError(f'Missing Classic gump {ids} for {key}')
        dest=out/(key+'.png');dest.parent.mkdir(parents=True,exist_ok=True);image.save(dest)
        entry={'src':'assets/classic-ui/'+key+'.png','width':image.width,'height':image.height,'sourceArchive':'gumpartLegacyMUL.uop','sourceGumpIds':ids,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),**extra};manifest['images'][key]=entry;manifest['roles'][key]=key;return entry
    def resizepic(base):
        tiles=[data.gump(base+i) for i in range(9)]
        if any(t is None for t in tiles):raise ValueError(f'Incomplete resizepic {base}')
        widths=[tiles[0].width,min(tiles[i].width for i in [1,4,7]),tiles[2].width];heights=[tiles[0].height,min(tiles[i].height for i in [3,4,5]),tiles[6].height]
        result=Image.new('RGBA',(sum(widths),sum(heights)))
        for i,tile in enumerate(tiles):result.paste(tile.crop((0,0,widths[i%3],heights[i//3])),(sum(widths[:i%3]),sum(heights[:i//3])))
        return result,[heights[0],widths[2],heights[2],widths[0]]
    # Native nine-piece resizepic families. Original pieces concatenated without painting.
    for role,base in [('window-frame',5054),('inner-frame',3000),('simple-frame',3000),('menu-frame',5054),('properties-background',3000)]:
        im,slices=resizepic(base);save(role,im,list(range(base,base+9)),borderImageSlice=slices)
    center=data.gump(5058)
    for role in ['window-background','bar-track','slot-shadow']:save(role,center,[5058])
    singles={'button-normal':4005,'button-hover':4006,'button-pressed':4007,'button-disabled':4005,'close-normal':4017,'close-hover':4018,'close-pressed':4019,'slot':3004,'divider':58,'separator':58,'emblem':10460,'joystick-track':52,'joystick-thumb':2103,'scroll-thumb':254,'scroll-track':255,'bar-health':2053,'bar-experience':2057,'health-fill':2053,'stamina-fill':2057,'textures/buttons/arrowbuttonright':4005}
    for role,gid in singles.items():
        im=data.gump(gid)
        if im is None:
            fallback={'divider':3004,'separator':3004,'emblem':2240,'joystick-track':3004,'joystick-thumb':2103,'scroll-thumb':3004,'scroll-track':3004,'bar-experience':2054,'stamina-fill':2054}.get(role)
            if fallback is None:raise ValueError(f'Missing gump {gid} for {role}')
            gid=fallback;im=data.gump(gid)
        save(role,im,[gid])
    # General text buttons reuse native blank resizepic building blocks, not arrow-labelled buttons.
    for role in ['button-normal','button-hover','button-pressed','button-disabled']:
        im,slices=resizepic(5054);save(role,im,list(range(5054,5063)),borderImageSlice=slices)
    # The native Unicode bitmap font is converted into one rectangle per opaque horizontal run.
    for role,index in [('default',0),('subtitle',1),('title',2)]:
        source=client/('unifont'+(str(index) if index else '')+'.mul');raw=source.read_bytes();ttf=bitmap_font(raw,'UO Classic '+role.title());dest=out/'fonts'/('uo-'+role+'.ttf');dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(ttf)
        manifest['fonts'][role]={'src':'assets/classic-ui/fonts/'+dest.name,'family':'UO Classic '+role.title(),'format':'truetype','sourceArchive':source.name,'sourceSha256':hashlib.sha256(raw).hexdigest(),'sha256':hashlib.sha256(ttf).hexdigest(),'conversion':'Exact original Unicode bitmap occupied-pixel contours; no smoothing, tracing, or substitute glyph designs.','glyphs':225}
    icons={}
    for index,name in enumerate(SPELLS):
        gid=0x1b58+index;entry=save('abilities/spells/'+name,data.gump(gid),[gid],association='exact Classic Magery spell icon',spellIndex=index);icons['spells/'+name]=entry
    aliases={'skills/evaluatingintelligence':'spells/cunning','skills/anatomy':'spells/strength','skills/spiritspeak':'spells/resurrection','skills/healing':'spells/heal','skills/resistingspells':'spells/protection','skills/magery':'spells/magic-arrow','skills/ninjitsu':'spells/teleport','skills/archery':'spells/bless','skills/swordsmanship':'spells/reactive-armor','stats/faster-cast':'spells/agility','weaponspecials/doublestrike':'spells/harm'}
    for alias,original in aliases.items():
        src=icons[original];gid=src['sourceGumpIds'][0];entry=save('abilities/'+alias,data.gump(gid),[gid],association='Original Classic spell icon adapted to survivor skill/stat role',originalIcon=original);icons[alias]=entry
    (out/'abilities/manifest.json').write_text(json.dumps({'schemaVersion':1,'sourceClient':str(client),'sourceArchive':'gumpartLegacyMUL.uop','icons':icons},indent=2)+'\n',encoding='utf8')
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8');print(f'Classic UI: {len(manifest["images"])} images, {len(manifest["fonts"])} bitmap fonts');return manifest
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--client',default=DEFAULT_CLASSIC);p.add_argument('--out',default='game/assets/classic-ui');a=p.parse_args();extract(a.client,a.out)
