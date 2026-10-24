"""Add native layers using the public enemy equipment configuration."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def augment_world(data, client_path):
    """Recover missing native hair/arcane/shroud layers and true corpse garments."""
    from PIL import Image
    from classic_animation import ClassicAnimations, DEFAULT_CLASSIC
    from classic_data import ClassicData
    animations=ClassicAnimations(client_path)
    client=ClassicData(client_path)
    path=ROOT/'game/assets/classic-actors/world-manifest.json'
    world=json.loads(path.read_text())
    def sheet(body,action,align_bottom,corpse=False):
        frames,evidence=animations.frames(body,action,corpse,corpse)
        visible=[f for f in frames if f is not None]
        if not visible:
            raise ValueError('No visible frames')
        left,top=min(f[1] for f in visible),min(f[2] for f in visible)
        right,bottom=max(f[3] for f in visible),max(f[4] for f in visible)
        columns=len(frames)//5
        image=Image.new('RGBA',((right-left)*columns,(bottom-top)*5))
        for index,frame in enumerate(frames):
            if frame:
                image.alpha_composite(frame[0],((index%columns)*(right-left)+frame[1]-left,(index//columns)*(bottom-top)+frame[2]-top))
        relative=f'enemy-layers/body-{body}-action-{action}'+('-final' if corpse else '')+'.png'
        target=path.parent/relative
        target.parent.mkdir(exist_ok=True)
        image.save(target)
        return {**evidence,'src':'assets/classic-actors/'+relative,'bodyId':body,'cellWidth':right-left,'cellHeight':bottom-top,'framesPerDirection':columns,'directions':5,'frameStride':1,'nativeBounds':[left,top,right,bottom],'anchorX':-left,'anchorY':align_bottom-top,'pose':'finalDeathFrame' if corpse else 'walking'}
    all_items={o['itemId']:o for p in data['recipes'].values() for section in ('common','male','female') for g in p.get(section,[]) for o in g['options']}
    missing=[]
    for iid,item in all_items.items():
        graphic=client.tile(iid)['animation']
        if not graphic:
            continue # jewelry intentionally invisible in native world sprites
        rec=world['equipment'].setdefault(str(iid),{'itemId':iid,'slot':item['slot'],'animationBodyId':graphic,'layers':{},'mapping':{'sourceArchive':'tiledata.mul','field':'animation','animationId':graphic}})
        for sex,body in [('male',400),('female',401)]:
            mapped,_,hue=animations.equipment.get((body,graphic),(graphic,0,0))
            for mode,action in [('walk',0),('walkArmed',1)]:
                if mode in rec.get('layers',{}).get(sex,{}):
                    continue
                try:
                    layer=sheet(mapped,action,world['playerBases'][sex][mode]['nativeBounds'][3])
                    if hue: layer['equipmentConversionHue']=hue
                    rec.setdefault('layers',{}).setdefault(sex,{})[mode]=layer
                except (ValueError,IndexError) as error:
                    missing.append({'itemId':iid,'sex':sex,'mode':mode,'reason':str(error)})
            try:
                # Match the native actor corpse anchor, which shares its walking
                # feet baseline. Garments have their own original origin offsets.
                layer=sheet(mapped,21,world['playerBases'][sex]['walk']['nativeBounds'][3],True)
                rec.setdefault('corpseLayers',{})[sex]=layer
            except (ValueError,IndexError):
                pass
    # Native elf bases have the same wearable protocol; preserve their own
    # origin baseline and compensate layer offsets in WorldAppearance.enemy.
    for body in (605,606):
        sex='female' if body==606 else 'male'
        for mode,action in [('walk',0),('walkArmed',1)]:
            try:
                frames,_=animations.frames(body,action)
                bottom=max(f[4] for f in frames if f)
                world.setdefault('enemyBases',{}).setdefault(str(body),{})[mode]=sheet(body,action,bottom)
            except (ValueError,IndexError):
                pass
    world['enemyEquipmentCoverage']={'itemIds':len(all_items),'missingWalkingLayers':missing}
    path.write_text(json.dumps(world,indent=2)+'\n')
    active_path=ROOT/'game/assets/world-equipment/manifest.json'
    active=json.loads(active_path.read_text())
    if active.get('artStyle')=='classic':
        # Keep Classic activation's one explicit Enhanced corpse fallback and
        # default skin metadata; copy only this extractor's augmented fields.
        for key in ('equipment','enemyBases','enemyEquipmentCoverage'):
            active[key]=world[key]
        active_path.write_text(json.dumps(active,separators=(',',':'))+'\n')
    client.close()
    return world['enemyEquipmentCoverage']
