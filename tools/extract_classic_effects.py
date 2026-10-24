"""Recover original Classic static spell-animation cels using animdata.mul."""
from __future__ import annotations
import argparse,hashlib,json,pathlib,struct,math,re
from PIL import Image
from classic_paths import DEFAULT_CLASSIC
# RunUO identifies projectile/fixed art; generic survivor impacts/dash adapt real spell sequences.
ROLES={'magic-arrow':(0x36e4,'RunUO First/MagicArrow.cs MovingParticles 0x36E4'),'fireball':(0x36d4,'RunUO Third/Fireball.cs MovingParticles 0x36D4'),'fireball-core':(0x36d4,'Same Fireball animation; optional core alias'),'nova':(0x36d4,'RunUO Seventh/MeteorSwarm.cs MovingParticles 0x36D4'),'heal':(0x376a,'RunUO Fourth/GreaterHeal.cs FixedParticles 0x376A'),'hit':(0x373a,'Original Classic sparkle animation adapted to generic hit'),'hurt':(0x374a,'Original Classic explosion animation adapted to damage'),'dash':(0x3728,'RunUO teleport-style particle art adapted to survivor dash'),'spark':(0x373a,'Original Classic sparkle animation'),'arrow':(0xf42,'RunUO Bow EffectID 0xF42'),'lightning':(0x4e20,'Classic BoltEffect lightning gump frames 0x4E20 through 0x4E29'),'chain':(0x4e20,'Classic lightning frames adapted to between-target chain beam'),'fire-field':(0x398c,'RunUO Fourth/FireField.cs field segment art')}
CIRCLES=['First','Second','Third','Fourth','Fifth','Sixth','Seventh','Eighth']
NAMES=['Clumsy CreateFood Feeblemind Heal MagicArrow NightSight ReactiveArmor Weaken','Agility Cunning Cure Harm MagicTrap RemoveTrap Protection Strength','Bless Fireball MagicLock Poison Telekinesis Teleport Unlock WallOfStone','ArchCure ArchProtection Curse FireField GreaterHeal Lightning ManaDrain Recall','BladeSpirits DispelField Incognito MagicReflect MindBlast Paralyze PoisonField SummonCreature','Dispel EnergyBolt Explosion Invisibility Mark MassCurse ParalyzeField Reveal','ChainLightning EnergyField FlameStrike GateTravel ManaVampire MassDispel MeteorSwarm Polymorph','Earthquake EnergyVortex Resurrection AirElemental SummonDaemon EarthElemental FireElemental WaterElemental']
IDS=[[0x3779,None,0x3779,0x376a,0x36e4,0x376a,0x376a,0x3779],[0x375a,0x375a,0x373a,0x374a,0x376a,0x376a,0x375a,0x375a],[0x373a,0x36d4,0x376a,0x374a,0x376a,0x3728,0x376a,0x82],[0x373a,0x375a,0x374a,0x398c,0x376a,0x4e20,0x3789,None],[None,0x376a,0x373a,0x375a,0x374a,0x376a,0x3915,None],[0x3728,0x379f,0x36bd,0x376a,14201,0x374a,0x3967,0x375a],[0x4e20,0x3946,0x3709,0xdda,0x374a,0x3728,0x36d4,None],[None,None,0x376a,None,0x3728,None,None,None]]
HUES={'harm':1153,'mind-blast':1181,'mana-vampire':23}
FIELD_VARIANTS={'fire-field':0x3996,'poison-field':0x3922,'paralyze-field':0x3979,'energy-field':0x3956}
def spell_registry():
    result={}
    for circle,names,ids in zip(CIRCLES,NAMES,IDS):
        for name,itemid in zip(names.split(),ids):
            role={'RemoveTrap':'magic-untrap','MagicReflect':'magic-reflection'}.get(name,re.sub(r'(?<!^)(?=[A-Z])','-',name).lower())
            result[role]={'itemId':itemid,'hue':HUES.get(role,0),'source':f'runuo/Scripts/Spells/{circle}/{name}.cs','visual':'none' if itemid is None else 'bolt' if role in ['lightning','chain-lightning'] else 'moving' if role in ['magic-arrow','fireball','energy-bolt','meteor-swarm'] else 'field' if role in FIELD_VARIANTS or role=='wall-of-stone' else 'fixed'}
    return result

def hue_cel(image,raw,hue):
    if not hue:return image
    n=(hue&0x3fff)-1;offset=(n//8)*708+4+(n%8)*88;palette=struct.unpack_from('<32H',raw,offset);out=image.copy();pixels=out.load()
    for y in range(out.height):
        for x in range(out.width):
            r,g,b,a=pixels[x,y]
            if a:
                c=palette[r>>3];pixels[x,y]=((c>>10&31)*255//31,(c>>5&31)*255//31,(c&31)*255//31,a)
    return out

def sequence(raw,itemid):
    pos=(itemid//8)*548+4+(itemid%8)*68
    if pos+68>len(raw):return [itemid],0,{}
    offsets=struct.unpack_from('64b',raw,pos);unknown,count,interval,start=struct.unpack_from('4B',raw,pos+64)
    return ([itemid+offsets[i] for i in range(count)] or [itemid]),10/max(1,interval),{'sourceFile':'animdata.mul','entryOffset':pos,'frameOffsets':list(offsets[:count]),'frameCount':count,'frameInterval':interval,'frameStart':start,'unknown':unknown}
def extract(client=DEFAULT_CLASSIC,out='game/assets/classic-effects'):
    from classic_data import ClassicData
    client=pathlib.Path(client);out=pathlib.Path(out);out.mkdir(parents=True,exist_ok=True);data=ClassicData(client);anim=(client/'animdata.mul').read_bytes()
    registry=spell_registry();roles={**ROLES,**{role:(entry['itemId'],entry['source']) for role,entry in registry.items() if entry['itemId'] is not None}}
    for role,item in FIELD_VARIANTS.items():roles[role+'-alternate']=(item,registry[role]['source'])
    manifest={'schemaVersion':2,'source':'Installed Classic Client artLegacyMUL.uop plus animdata.mul and hues.mul; server spell effect IDs','images':{},'effects':{},'spells':registry,'limitations':['Survivor spell positioning/timing follows survivor rules; source Classic cels and their order are retained.','Generic hit/hurt/dash roles adapt named original particle animations. Chain lightning uses original target bolts.','Spells with no native particle are explicit visual:none; summons show summoned actors and Earthquake is sound-only in RunUO.']}
    for role,(itemid,evidence) in roles.items():
        ids,fps,definition=sequence(anim,itemid)
        bolt=role in ['lightning','chain','chain-lightning']
        if bolt:ids=list(range(0x4e20,0x4e2a));fps=10;definition={'source':'Classic BoltEffect special ten-frame lightning gump sequence'}
        cels=[(data.gump(i) if bolt else data.art(i)) for i in ids]
        if any(im is None for im in cels):raise ValueError(f'Missing Classic effect {role} frames {[hex(ids[i]) for i,im in enumerate(cels) if im is None]}')
        cels=[hue_cel(im,data.file('hues.mul'),HUES.get(role,0)) for im in cels]
        width=max(im.width for im in cels);height=max(im.height for im in cels);columns=min(8,len(cels));rows=math.ceil(len(cels)/columns);sheet=Image.new('RGBA',(columns*width,rows*height))
        for i,im in enumerate(cels):sheet.paste(im,((i%columns)*width+(width-im.width)//2,(i//columns)*height+height-im.height))
        dest=out/(role+'.png');sheet.save(dest)
        entry={'src':'assets/classic-effects/'+dest.name,'width':sheet.width,'height':sheet.height,'sourceArchive':'gumpartLegacyMUL.uop' if bolt else 'artLegacyMUL.uop','sourceGumpIds' if bolt else 'sourceItemIds':ids,'serverEvidence':evidence,'sourceHue':HUES.get(role,0),'animationDefinition':definition,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()}
        rotation=math.pi if itemid in [0x36d4,0x36e4] else -math.pi/2 if itemid==0x379f else 0
        anchored=bolt or role.replace('-alternate','') in FIELD_VARIANTS or role in ['wall-of-stone','flame-strike']
        manifest['images'][role]=entry;manifest['effects'][role]={**entry,'texture':role,'cellWidth':width,'cellHeight':height,'frames':len(cels),'framesPerDirection':len(cels),'columns':columns,'rows':rows,'directions':1,'fps':fps,'anchorX':width/2,'anchorY':height if anchored else height/2,'blend':'source-over','rotationOffset':rotation,'displayWidth':width,'displayHeight':height,'renderingBoundary':'Source Classic animation cel sequence and source hue; game controls placement and lifetime.'}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8');print(f'Classic spell effects: {len(manifest["effects"])}');return manifest
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--client',default=DEFAULT_CLASSIC);p.add_argument('--out',default='game/assets/classic-effects');a=p.parse_args();extract(a.client,a.out)
