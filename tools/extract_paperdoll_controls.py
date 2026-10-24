"""Recover Classic square accessory frames and blank blue/gold controls."""
import hashlib
import json
from pathlib import Path
from classic_data import ClassicData


def extract(client=None):
    data=ClassicData(client) if client else ClassicData()
    out=Path('game/assets/classic-ui/paperdoll');out.mkdir(parents=True,exist_ok=True)
    entries={}
    try:
        for name,gid in [('slot',9028),('button',2062)]:
            image=data.gump(gid);dest=out/(name+'.png');image.save(dest)
            raw=data.member('gumpartLegacyMUL.uop',f'build/gumpartlegacymul/{gid:08d}.tga')
            entries['paperdoll/'+name]={'src':'assets/classic-ui/paperdoll/'+dest.name,
                'width':image.width,'height':image.height,'sourceArchive':'gumpartLegacyMUL.uop',
                'sourceGumpIds':[gid],'sourceSha256':hashlib.sha256(raw).hexdigest(),
                'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),
                'association':'Native accessory slot frame from Intrface.def newpaperdolltinyequip' if name=='slot' else 'Original blank blue/gold bar adapted to text buttons; original pixels and border retained'}
        for name in ['game/assets/classic-ui/manifest.json','game/assets/ui/manifest.json']:
            path=Path(name);manifest=json.loads(path.read_text(encoding='utf-8'));manifest['images'].update(entries)
            for slot in manifest.get('equipment',{}).get('slots',{}).values():slot['x']=12 if slot['x']<80 else 158
            path.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
        path=Path('game/assets/classic-equipment/manifest.json');manifest=json.loads(path.read_text(encoding='utf-8'))
        for slot in manifest['equipment']['slots'].values():slot['x']=12 if slot['x']<80 else 158
        path.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
        print({key:(entry['width'],entry['height']) for key,entry in entries.items()})
    finally:data.close()


if __name__=='__main__':extract()
