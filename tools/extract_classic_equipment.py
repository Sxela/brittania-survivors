"""Extract Classic inventory art and genuinely aligned native paperdoll layers.

Server item IDs/stats remain untouched. Missing art is explicit; no Enhanced
image is substituted. Transparent padding is cropped with its native offset
retained, so all equipped gumps share the original paperdoll (8,19) anchor.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import pathlib
import re

from classic_paths import DEFAULT_CLASSIC
CLIENT = DEFAULT_CLASSIC


def sha(data):
    return hashlib.sha256(data).hexdigest()


def cropped_visual(image):
    bounds = image.getbbox()
    if not bounds:
        return None
    return image.crop(bounds), list(bounds)


def extract(client, out, data):
    catalog = json.loads(pathlib.Path('game/data/catalog.json').read_text(encoding='utf8'))
    manifest = {'schemaVersion':1, 'artStyle':'classic', 'sourceClient':str(client), 'images':{}}
    config = {'canvas':{'width':262,'height':324,'originX':8,'originY':19},'bodies':{},'items':{},'slots':{},'coverage':{'missingIcons':[],'missingMappings':[],'missingLayers':{'male':[],'female':[]}}}
    source_hashes = {name:sha((client/name).read_bytes()) for name in ['artLegacyMUL.uop','gumpartLegacyMUL.uop','tiledata.mul','gump.def','Equipconv.def']}
    equipment_conversions={}
    for line in (client/'Equipconv.def').read_text(encoding='utf-8-sig',errors='replace').splitlines():
        fields=line.split('#',1)[0].split()
        if len(fields)>=5:
            try:
                body,animation,replacement,gump,hue=[int(v,0) if v.lower().startswith('0x') else int(v) for v in fields[:5]]
            except ValueError:
                continue
            equipment_conversions[body,animation]=(replacement,gump,hue)
    manifest['sourceArchiveSha256']=source_hashes
    def save(key, image, archive, **extra):
        dest=out/(key+'.png')
        dest.parent.mkdir(parents=True,exist_ok=True)
        image.save(dest)
        manifest['images'][key]={'src':'assets/classic-equipment/'+key+'.png','width':image.width,'height':image.height,'sha256':sha(dest.read_bytes()),'sourceArchive':archive,'sourceArchiveSha256':source_hashes[archive],**extra}
        return key
    image_cache={}
    def paper(number):
        if number in image_cache:
            return image_cache[number]
        image=data.gump(number)
        result=None
        if image is not None and (cropped:=cropped_visual(image)):
            resolved,hue=data.resolve_gump(number)
            pixels,bounds=cropped
            raw=data.member('gumpartLegacyMUL.uop',f'build/gumpartlegacymul/{resolved:08d}.tga')
            key=save('equipment/layers/'+str(number),pixels,'gumpartLegacyMUL.uop',gumpId=number,resolvedGumpId=resolved,sourceHue=hue,sourceSha256=sha(raw),nativeWidth=image.width,nativeHeight=image.height,bounds=bounds)
            result={'image':key,'bounds':bounds,'gumpId':number,'resolvedGumpId':resolved,'sourceHue':hue}
        image_cache[number]=result
        return result
    for sex,number in [('male',12),('female',13)]:
        config['bodies'][sex]=paper(number)
        if not config['bodies'][sex]:
            raise ValueError(f'Missing native Classic {sex} paperdoll body')
    for role,number in [('paperdoll-background',2000),('backpack',60)]:
        image=data.gump(number)
        if image is None:
            raise ValueError(f'Missing Classic {role} gump {number}')
        save('equipment/'+role,image,'gumpartLegacyMUL.uop',gumpId=number)
    # These are compact accessory drop controls around the original figure.
    # Their positions are adapted to accommodate every server equipment layer;
    # the background, body and wearable placements remain native.
    left=['head','earrings','neck','ring','bracelet','middleTorso','weapon','offhand','talisman','waist']
    right=['robe','hands','legs','arms','cloak','feet','armor','shirt','skirt']
    for names,x in [(left,12),(right,158)]:
        for i,name in enumerate(names):
            config['slots'][name]={'label':name.title(),'x':x,'y':45+i*21,'width':20,'height':20,'placeholder':None,'adaptedControlPlacement':True}
    config['slots']['pants']={**config['slots']['legs'],'label':'Pants','aliasOf':'legs'}
    config['slotOrder']=left+right
    icons={}
    def appearance(iid,slot):
        record={'itemId':iid,'icon':None,'layers':{}}
        if not isinstance(iid,int) or iid<0:
            return record
        if iid not in icons:
            image=data.art(iid)
            icons[iid]=save('equipment/items/'+str(iid),image,'artLegacyMUL.uop',itemId=iid,artIndex=0x4000+iid) if image is not None and image.getbbox() else None
        record['icon']=icons[iid]
        tile=data.tile(iid)
        if tile:
            record['sourceLayer']=tile.get('layer')
            record['partialHue']=bool(tile.get('flags',0)&0x40000)
            animation=tile.get('animation',0)
            if animation and slot:
                record['paperdollMapping']={'animationId':animation,'maleGumpId':50000+animation,'femaleGumpId':60000+animation,'sourceArchive':'tiledata.mul','sourceSha256':source_hashes['tiledata.mul'],'aliasDefinitions':'gump.def'}
                for sex,base in [('male',50000),('female',60000)]:
                    effective=animation
                    conversion=equipment_conversions.get((400 if sex=='male' else 401,animation))
                    if conversion:
                        replacement,gump,hue=conversion
                        effective=replacement if gump==-1 else animation if gump==0 else gump-(60000 if gump>=60000 else 50000) if gump>50000 else gump
                    layer=paper(base+effective)
                    # Classic tries the opposite sex if the native/aliased
                    # gump is absent (PaperDollInteractable.IsAnimExistsInGump).
                    if layer is None:
                        layer=paper((50000 if sex=='female' else 60000)+effective)
                        if layer:
                            layer={**layer,'classicOppositeSexFallback':True}
                    if layer:
                        if conversion:
                            layer={**layer,'equipmentConversion':{'source':'Equipconv.def','body':400 if sex=='male' else 401,'fromAnimation':animation,'animationId':effective,'gumpId':conversion[1],'hue':conversion[2]}}
                        record['layers'][sex]=layer
        return record
    items=list(catalog['items'])+[{'id':'potion','itemId':3852},{'id':'greater-heal','itemId':3852},{'id':'gold','itemId':3821},{'id':'gold-medium','itemId':3822},{'id':'gold-large','itemId':3823},{'id':'backpack','itemId':3701}]
    for item in items:
        iid=item.get('itemId');slot=item.get('slot');name=item['id']
        record={**appearance(iid,slot),'slot':slot,'hue':item.get('hue') or 0,'hueIds':item.get('hueIds',[]),'allowMaleWearer':item.get('stats',{}).get('AllowMaleWearer',True),'allowFemaleWearer':item.get('stats',{}).get('AllowFemaleWearer',True)}
        record['variants']=[appearance(v,slot) for v in sorted(set(item.get('itemIds',[]))) if isinstance(v,int) and v!=iid]
        config['items'][name]=record
        if not record['icon']:
            config['coverage']['missingIcons'].append(name)
        if slot:
            if not record.get('paperdollMapping'):
                config['coverage']['missingMappings'].append(name)
            for sex in ['male','female']:
                if sex not in record['layers']:
                    config['coverage']['missingLayers'][sex].append(name)
    variants=[v for item in config['items'].values() for v in item['variants']]
    config['coverage'].update({'items':len(config['items']),'equippable':len(catalog['items']),'icons':sum(bool(i['icon']) for i in config['items'].values()),'uniqueIcons':sum(bool(v) for v in icons.values()),'maleLayers':sum('male' in i['layers'] for i in config['items'].values()),'femaleLayers':sum('female' in i['layers'] for i in config['items'].values()),'uniquePaperdollFrames':sum(bool(v) for v in image_cache.values()),'alternateAppearances':len(variants),'missingVariantIcons':[v['itemId'] for v in variants if not v['icon']]})
    manifest['equipment']=config
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
    return manifest


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--client',default=CLIENT)
    parser.add_argument('--out',default='game/assets/classic-equipment')
    args=parser.parse_args()
    from classic_data import ClassicData
    client=pathlib.Path(args.client)
    data=ClassicData(client)
    try:
        manifest=extract(client,pathlib.Path(args.out),data)
    finally:
        data.close()
    print(json.dumps(manifest['equipment']['coverage']))


if __name__=='__main__':
    main()
