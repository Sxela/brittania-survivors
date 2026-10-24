"""Repair verified uncovered black floor placeholders in Spectre Dungeon.

Source maps remain untouched. The derived manifest records every replacement;
only native 0x3FD1 floor art at the same elevation is used. Narrow gaps must
have matching floor on opposite sides; walls, water and exterior void remain.
"""
from collections import defaultdict
from PIL import Image
from export_zone_maps import FACETS
from extract_classic_maps import sloped_land


def repair_spectre_floor(region,data=None):
    if region.get('areaId')!='c44a5913697d0e96':return []
    if region.get('nativeFloorRepairs'):return []
    tiles=region['tiles'];w,h=region['width'],region['height'];statics=defaultdict(list)
    for s in region.get('statics',[]):statics[s['x']*h+s['y']].append(s)
    repairs=[]
    for i,tile in enumerate(tiles):
        if tile[:2]!=[0x244,-28]:continue
        if any(s['flags']&0x240 and not s['flags']&0x20000000 and s['z']+s.get('height',0)>-28 and s['z']<-12 for s in statics[i]):continue
        x,y=divmod(i,h)
        def floor_in_direction(dx,dy):
            for distance in range(1,4):
                a,b=x+dx*distance,y+dy*distance
                if not(0<=a<w and 0<=b<h):return False
                target=tiles[a*h+b][:2]
                if target==[0x3FD1,-28]:return True
                if target!=[0x244,-28]:return False
            return False
        if (floor_in_direction(1,0) and floor_in_direction(-1,0)) or (floor_in_direction(0,1) and floor_in_direction(0,-1)):
            repairs.append({'index':i,'source':[0x244,-28],'replacement':[0x3FD1,-28],
                'worldX':region['sourceX']+x,'worldY':region['sourceY']+y,'reason':'Uncovered narrow black placeholder between matching native room floors'})
    # Decide from the original floor mask, never grow the repair iteratively.
    for entry in repairs:tiles[entry['index']]=[*entry['replacement'],*tiles[entry['index']][2:]]
    if data is not None and repairs:
        from location_collision import normalize_region
        probe={**region};normalize_region(probe,data);reachable=set(probe['mainPassable'])
        for entry in repairs:
            if entry['index'] not in reachable:tiles[entry['index']]=[*entry['source'],*tiles[entry['index']][2:]]
        repairs=[entry for entry in repairs if entry['index'] in reachable]
    if repairs:region['nativeFloorRepairs']=repairs
    return repairs


def rebake_repaired_chunks(region,data,save):
    repairs=region.get('nativeFloorRepairs',[])
    if not repairs:return 0
    w,h=region['width'],region['height'];facet,fw,fh=FACETS[region['facet']]
    chunks={(entry['index']//h//32,(entry['index']%h)//32) for entry in repairs}
    art={};blocks={}
    def point(x,y):
        if 0<=x<w and 0<=y<h:return region['tiles'][x*h+y][:2]
        wx,wy=min(fw-1,max(0,region['sourceX']+x)),min(fh-1,max(0,region['sourceY']+y));block=wx//8*(fh//8)+wy//8
        if block not in blocks:blocks[block]=data.map_block(block,facet)
        return blocks[block][wy%8*8+wx%8]
    for chunk in region['grounds']:
        cx,cy=chunk['tileX'],chunk['tileY']
        if (cx//32,cy//32) not in chunks:continue
        patches=[]
        for x,y in sorted(((x,y) for x in range(cx,min(w,cx+32)) for y in range(cy,min(h,cy+32))),key=lambda p:sum(p)):
            iid,z=point(x,y)
            if iid not in art:art[iid]=data.land(iid)
            im=art[iid]
            if im is None:continue
            px,py=(x-y)*22,(x+y)*22-z*4;z1,z2,z3=point(x+1,y)[1],point(x+1,y+1)[1],point(x,y+1)[1]
            if z==z1==z2==z3:patches.append((im,px-22,py))
            else:
                patch,left,top=sloped_land(im,[(px,py),(px+22,(x+y+1)*22-z1*4),(px,(x+y+2)*22-z2*4),(px-22,(x+y+1)*22-z3*4)])
                patches.append((patch,left,top))
        left=min(p[1] for p in patches);top=min(p[2] for p in patches)
        right=max(p[1]+p[0].width for p in patches);bottom=max(p[2]+p[0].height for p in patches)
        ground=Image.new('RGBA',(right-left,bottom-top))
        for im,x,y in patches:ground.alpha_composite(im,(x-left,y-top))
        save(chunk['image'],ground,region['sourceArchive'],nativeFloorRepairs=True)
        chunk.update(left=left,top=top,width=ground.width,height=ground.height)
    return len(chunks)


def apply_manifest_repairs():
    import hashlib,json,pathlib,struct
    from classic_data import ClassicData,rgb555
    from location_collision import normalize_region
    root=pathlib.Path(__file__).resolve().parents[1];out=root/'game/assets/locations'
    path=out/'manifest.json';manifest=json.loads(path.read_text());data=ClassicData()
    region=next(r for r in manifest['regions'] if r['areaId']=='c44a5913697d0e96')
    def save(key,im,archive,**metadata):
        file=out/(key+'.png');im.save(file,compress_level=2)
        manifest['images'][key]={**manifest['images'][key],'width':im.width,'height':im.height,'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),**metadata}
    previous=region.pop('nativeFloorRepairs',[])
    for entry in previous:region['tiles'][entry['index']]=[*entry['source'],*region['tiles'][entry['index']][2:]]
    repairs=repair_spectre_floor(region,data)
    chunks=rebake_repaired_chunks({**region,'nativeFloorRepairs':previous+repairs},data,save)
    region['collisionAudit']=normalize_region(region,data)
    region['sourceSha256']=hashlib.sha256(json.dumps({'tiles':region['tiles'],'statics':region['statics']},sort_keys=True).encode()).hexdigest()
    entry=manifest['images'][region['radar']];radar=Image.open(root/'game'/entry['src']).convert('RGBA')
    colors=data.file('radarcol.mul');h=region['height']
    for repair in region['nativeFloorRepairs']:
        x,y=divmod(repair['index'],h);color=rgb555(struct.unpack_from('<H',colors,repair['replacement'][0]*2)[0]);px,py=x-y+h-1,x+y
        radar.putpixel((px,py),color);radar.putpixel((px,py+1),color)
    save(region['radar'],radar,'radarcol.mul')
    manifest['reviewVersion']=2
    path.write_text(json.dumps(manifest,separators=(',',':'))+'\n')
    report={'area':region['name'],'repairedCells':len(region['nativeFloorRepairs']),'newRepairs':len(repairs),'rebakedChunks':chunks,'repairs':region['nativeFloorRepairs']}
    (root/'research/spectre-floor-repair.json').write_text(json.dumps(report,indent=2)+'\n')
    data.close();print(json.dumps({k:v for k,v in report.items() if k!='repairs'}))


if __name__=='__main__':apply_manifest_repairs()
