"""Copy bounded Classic locations verbatim, without periodic terrain repetition.

Every tile and static is read at its original facet coordinate. Named region
membership limits movement; surrounding native scenery remains visible.
"""
import argparse, hashlib, json, math, pathlib, struct
from collections import Counter, deque
from functools import lru_cache
from PIL import Image
from classic_data import ClassicData, DEFAULT_CLASSIC, rgb555
from extract_classic_maps import sloped_land
from export_zone_maps import FACETS
from location_decorations import region_decorations
from location_collision import normalize_region
from location_backdrop import add_native_backdrop
from location_floor_repairs import repair_spectre_floor,rebake_repaired_chunks
from location_bounds import compact_expansion

ROOT=pathlib.Path(__file__).resolve().parents[1]

def zone_definitions():
    return json.loads((ROOT/'tools/asset-recipe.json').read_text(encoding='utf8'))['zones']

def component(cells,h):
    remaining=set(cells);best=set()
    while remaining:
        first=remaining.pop();group={first};queue=[first]
        while queue:
            i=queue.pop();x,y=divmod(i,h)
            for j in (i-h,i+h,i-1 if y else -1,i+1 if y<h-1 else -1):
                if j in remaining:remaining.remove(j);group.add(j);queue.append(j)
        if len(group)>len(best):best=group
    return best

def finalize(manifest,data,selected=None):
    """Keep native render metadata and resolve physical collision consistently."""
    zones={z['id']:z for z in zone_definitions()}
    for r in manifest['regions']:
        if selected is not None and r['areaId'] not in selected:continue
        h=r['height']
        if not r.get('namedRegionCells'):
            zone=zones[r['sourceZoneId']]
            r['namedRegionCells']=[x*h+y for x in range(r['width']) for y in range(h) if any(q['x']<=r['sourceX']+x<q['x']+q['width'] and q['y']<=r['sourceY']+y<q['y']+q['height'] for q in zone['rectangles'])]
        for s in r['statics']:
            im=manifest['images'].get(s['image']);s['bounds']=[im['width']-1,im['height']-1,0,0] if im else [0,0,0,0]
            s['height']=data.tile(s['itemId']).get('height',0)
        r['collisionAudit']=normalize_region(r,data)
        r['sourceSha256']=hashlib.sha256(json.dumps({'tiles':r['tiles'],'statics':r['statics']},sort_keys=True).encode()).hexdigest()


def refresh_statics(client=DEFAULT_CLASSIC,out=ROOT/'game/assets/locations',selected=None):
    """Re-read all source statics plus server furniture; retain unchanged land PNGs.

    Legacy static diffs are disabled by this RunUO's MapDefinitions.cs, matching
    the modern UOP map revision. Refuse to retain
    ground images if source land changed, rather than combining two revisions.
    """
    out=pathlib.Path(out);manifest=json.loads((out/'manifest.json').read_text());data=ClassicData(client)
    colors=data.file('radarcol.mul');hues=data.file('hues.mul');art_seen=set();patches=[]
    @lru_cache(maxsize=16384)
    def block(facet,b):return data.map_block(b,facet),data.statics_block(b,facet)
    def save(key,im,archive,**extra):
        path=out/(key+'.png');path.parent.mkdir(parents=True,exist_ok=True);im.save(path,compress_level=2)
        manifest['images'][key]={'src':'assets/locations/'+key+'.png','width':im.width,'height':im.height,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'sourceArchive':archive,**extra}
    def make(item):
        iid=item['itemId'];d=data.tile(iid);key=f'statics/{iid}'
        if iid not in art_seen:
            im=data.art(iid)
            if im is None:key=None
            else:save(key,im,'artLegacyMUL.uop',itemId=iid,emptyArt=not bool(im.getbbox()))
            art_seen.add(iid)
        im=manifest['images'].get(key);flags=d['flags']
        return {**item,'image':key if im else None,'flags':flags,'name':d['name'],'height':d['height'],'bounds':[im['width']-1,im['height']-1,0,0] if im else [0,0,0,0],'classicArt':True,'light':bool(flags&0x800000),'roof':bool(flags&0x10000000)}
    def color(i,hue=0):
        hue=(hue&0x3fff)-1
        if hue>=0:
            offset=(hue//8)*708+4+(hue%8)*88+32
            if offset+2<=len(hues):return rgb555(struct.unpack_from('<H',hues,offset)[0])
        return rgb555(struct.unpack_from('<H',colors,i*2)[0]) if 0<=i*2+2<=len(colors) else (8,8,8,255)
    for r in manifest['regions']:
        if selected is not None and r['areaId'] not in selected:continue
        facet,fw,fh=FACETS[r['facet']];sx,sy,w,h=r['sourceX'],r['sourceY'],r['width'],r['height'];statics=[];patched=0
        originals={entry['index']:entry['source'] for entry in r.get('nativeFloorRepairs',[])}
        for x in range(w):
            for y in range(h):
                cells=block(facet,((sx+x)//8)*(fh//8)+(sy+y)//8)[0]
                iid,z=cells[((sy+y)%8)*8+(sx+x)%8]
                if [iid,z]!=originals.get(x*h+y,r['tiles'][x*h+y][:2]):raise ValueError('Land changed: run a full location export before refreshing '+r['name'])
        for xx in range(sx//8,(sx+w-1)//8+1):
            for yy in range(sy//8,(sy+h-1)//8+1):
                b=xx*(fh//8)+yy;is_patch=b in data.diff_blocks(facet,True);patched+=is_patch
                for iid,x,y,z,hue in block(facet,b)[1]:
                    x+=xx*8-sx;y+=yy*8-sy
                    if 0<=x<w and 0<=y<h:statics.append(make({'itemId':iid,'x':x,'y':y,'z':z,'hue':hue,'sourceArchive':f'stadif{facet}.mul' if is_patch else f'statics{facet}.mul'}))
        additions,counts=region_decorations(r,statics)
        statics.extend(make(s) for s in additions);r['statics']=statics;r['decorationAudit']=counts;r['appliedStaticDiffBlocks']=patched
        repair_spectre_floor(r,data);rebake_repaired_chunks(r,data,save)
        patches.append({'area':r['name'],'patchedBlocks':patched,'decorations':counts['added']})
        # Native radar colors must describe the same patched visible scenery.
        highest={}
        for s in statics:
            if not s['image'] or manifest['images'][s['image']].get('emptyArt') or s['name'].replace(' ','').lower()=='nodraw':continue
            i=s['x']*h+s['y']
            if i not in highest or s['z']>highest[i]['z']:highest[i]=s
        radar=Image.new('RGBA',(w+h,w+h))
        for x in range(w):
            for y in range(h):
                i=x*h+y;iid,z=r['tiles'][i][:2];s=highest.get(i);tint=color(s['itemId']+0x4000,s['hue']) if s and s['z']>=z else color(iid);px=x-y+h-1;py=x+y
                radar.putpixel((px,py),tint);radar.putpixel((px,py+1),tint)
        save(r['radar'],radar,'radarcol.mul')
        r['backdropAudit']=add_native_backdrop(r,data,save,make,padding=40)
        print('REFRESH',r['name'],'statics',len(statics),'patches',patched,'decorations',counts['added'],flush=True)
    finalize(manifest,data,selected)
    used={k for r in manifest['regions'] for k in [r['radar'],*[g['image'] for g in r['grounds']+r.get('backdropGrounds',[])],*[s['image'] for s in r['statics']+r.get('backdropStatics',[])]] if k}|set(manifest['moongate']['frames'])
    manifest['images']={k:v for k,v in manifest['images'].items() if k in used}
    manifest['formatVersion']=2;manifest['reviewVersion']=1;manifest['staticDiffsApplied']=data.use_patches;manifest['serverDecorationsApplied']=True
    manifest['staticDiffPolicy']='Disabled to match runuo/Scripts/Misc/MapDefinitions.cs:41 for modern client maps.'
    manifest['limitations']=['Original bounded native sections with no repeated terrain. Movement uses the connected physical section, not invisible named-region walls. One walk height per tile; stacked floors are cut away above the player. Source server decoration cfg files supplement native statics; player-built dynamic houses are absent. Doors are traversable for arena movement. Forty native tiles of scenery continue beyond the movement bounds.']
    manifest['coverage'].update(regions=len(manifest['regions']),images=len(manifest['images']),staticPlacements=sum(len(r['statics']) for r in manifest['regions']))
    (out/'manifest.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n');data.close()
    return manifest,patches

def export(client=DEFAULT_CLASSIC,out=ROOT/'game/assets/locations',resume=False,limit=None,expand_compact=False,recipe_windows=None):
    out=pathlib.Path(out);out.mkdir(parents=True,exist_ok=True)
    areas=json.loads((ROOT/'game/data/areas.json').read_text())['areas'];requested_count=len(areas)
    zones={z['id']:z for z in zone_definitions()}
    manifest={'formatVersion':1,'artStyle':'classic','tileWidth':44,'tileHeight':44,'elevationPixels':4,'sourceClient':str(client),'images':{},'regions':[],'landDefinitions':{},'limitations':['Bounded contiguous native windows; large or disconnected named regions use one original section. No repeated patches, map interpolation, or synthetic scenery. Dynamic server houses are not client statics. Doors are traversable for arena movement. Upper-floor and roof cutaway is a runtime responsibility.']}
    if (resume or expand_compact) and (out/'manifest.json').exists():manifest=json.loads((out/'manifest.json').read_text())
    windows={};previous={};order=[r['areaId'] for r in manifest['regions']]
    if expand_compact:
        if not order:raise ValueError('Compact expansion requires an existing native export')
        for r in manifest['regions']:
            _,fw,fh=FACETS[r['facet']];bounds=compact_expansion(r,fw,fh)
            if bounds:windows[r['areaId']]=bounds;previous[r['areaId']]=r
        if not windows:
            print('No compact native crops need expansion',flush=True);return
        manifest['regions']=[r for r in manifest['regions'] if r['areaId'] not in windows]
        areas=[a for a in areas if a['id'] in windows]
    done={r['areaId'] for r in manifest['regions']};data=ClassicData(client)
    colors=data.file('radarcol.mul');hues=data.file('hues.mul')
    def save(key,image,archive,**extra):
        path=out/(key+'.png');path.parent.mkdir(parents=True,exist_ok=True);image.save(path,compress_level=2)
        manifest['images'][key]={'src':'assets/locations/'+key+'.png','width':image.width,'height':image.height,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'sourceArchive':archive,**extra};return key
    @lru_cache(maxsize=16000)
    def block(facet,b):return data.map_block(b,facet),data.statics_block(b,facet)
    @lru_cache(maxsize=3000)
    def land(iid):return data.land_tile(iid)
    @lru_cache(maxsize=3000)
    def landart(iid):return data.land(iid)
    @lru_cache(maxsize=16000)
    def definition(iid):return data.tile(iid)
    def contains(z,x,y):return any(r['x']<=x<r['x']+r['width'] and r['y']<=y<r['y']+r['height'] for r in z['rectangles'])
    def point(facet,fh,x,y):return block(facet,(x//8)*(fh//8)+y//8)[0][(y%8)*8+x%8]
    def color(i,hue=0):
        hue=(hue&0x3fff)-1
        if hue>=0:
            offset=(hue//8)*708+4+(hue%8)*88+32
            if offset+2<=len(hues):return rgb555(struct.unpack_from('<H',hues,offset)[0])
        return rgb555(struct.unpack_from('<H',colors,i*2)[0]) if i*2+2<=len(colors) else (8,8,8,255)
    for ai,area in enumerate(areas[:limit] if limit else areas):
        if area['id'] in done:continue
        z=zones[area['zoneIds'][0]];facet,fw,fh=FACETS[z['facet']];rects=z['rectangles'];go=z.get('go') or {}
        gx=int(go.get('x',rects[0]['x']+rects[0]['width']//2));gy=int(go.get('y',rects[0]['y']+rects[0]['height']//2))
        # Prefer the original entrance room; disconnected dungeon levels remain
        # separate source sections rather than being pasted together.
        rect=next((r for r in rects if r['x']<=gx<r['x']+r['width'] and r['y']<=gy<r['y']+r['height']),max(rects,key=lambda r:r['width']*r['height']))
        if not contains(z,gx,gy):gx=rect['x']+rect['width']//2;gy=rect['y']+rect['height']//2
        bx=min(r['x'] for r in rects);by=min(r['y'] for r in rects);ex=max(r['x']+r['width'] for r in rects);ey=max(r['y']+r['height'] for r in rects)
        whole=ex-bx<=192 and ey-by<=192
        largest=max(rects,key=lambda r:r['width']*r['height'])
        if not whole and rect['width']*rect['height']<1024 and rect['width']*rect['height']*4<largest['width']*largest['height']:
            # Some dungeon Go points are a tiny external entrance separated by
            # a teleport from the actual dungeon. Copy the original main room.
            rect=largest;gx=rect['x']+rect['width']//2;gy=rect['y']+rect['height']//2
        if whole:sx=max(0,bx-8);sy=max(0,by-8);w=min(fw-sx,ex-bx+16);h=min(fh-sy,ey-by+16)
        else:
            w=min(192,max(128,min(rect['width']+16,192)));h=min(192,max(128,min(rect['height']+16,192)))
            sx=max(0,min(fw-w,gx-w//2));sy=max(0,min(fh-h,gy-h//2))
        if area['id'] in windows:
            old=previous[area['id']];sx,sy,w,h=windows[area['id']]
            # Keep the entrance in its original world position after recentering.
            gx=old['sourceX']+old['spawn']['tileX'];gy=old['sourceY']+old['spawn']['tileY']
        elif recipe_windows and area['id'] in recipe_windows:
            window=recipe_windows[area['id']]
            sx,sy,w,h=(window[k] for k in ('sourceX','sourceY','width','height'))
            gx=sx+window['spawn']['tileX'];gy=sy+window['spawn']['tileY']
        tiles=[];statics=[];inside=set();blocked=set();walk=[]
        for x in range(w):
            for y in range(h):
                iid,height=point(facet,fh,sx+x,sy+y);i=x*h+y;d=land(iid);tiles.append([iid,height,[]]);walk.append(height)
                if contains(z,sx+x,sy+y):inside.add(i)
                if d['flags']&0xc0 or d['name'].lower() in ('void','nodraw'):blocked.add(i)
                manifest['landDefinitions'][str(iid)]={**d,'tileFlags':d['flags'],'passable':not bool(d['flags']&0xc0)}
        for xx in range(sx//8,(sx+w-1)//8+1):
            for yy in range(sy//8,(sy+h-1)//8+1):
                for iid,x,y,height,hue in block(facet,xx*(fh//8)+yy)[1]:
                    x+=xx*8-sx;y+=yy*8-sy
                    if not (0<=x<w and 0<=y<h):continue
                    d=definition(iid);key=f'statics/{iid}';image=None
                    if key not in manifest['images']:
                        image=data.art(iid)
                        if image is not None:save(key,image,'artLegacyMUL.uop',itemId=iid)
                    im=manifest['images'].get(key);f=d['flags'];i=x*h+y
                    s={'x':x,'y':y,'z':height,'itemId':iid,'hue':hue,'image':key if im else None,'flags':f,'name':d['name'],'bounds':[im['width']-1,im['height']-1,0,0] if im else [0,0,0,0],'classicArt':True,'light':bool(f&0x800000),'roof':bool(f&0x10000000)};statics.append(s)
                    # Ignore doors for collision; native floor surfaces can cover
                    # void under dungeon rooms/raised walkways.
                    if f&0x200 and not f&0x10000000 and not f&0x40 and abs(height-walk[i])<=20:
                        walk[i]=max(walk[i],height+d.get('height',0));blocked.discard(i)
                    if f&0x40 and not f&0x20000000 and abs(height-walk[i])<=16:blocked.add(i)
        playable=inside-blocked;main=component(playable,h)
        if not main:raise ValueError(f'No passable native region: {area["name"]}')
        spawn=min(main,key=lambda i:(i//h-(gx-sx))**2+(i%h-(gy-sy))**2);ax,ay=spawn//h+.5,spawn%h+.5
        r={'id':area['id'],'areaId':area['id'],'name':area['name'],'facet':z['facet'],'sourceFacet':facet,'sourceZoneId':z['id'],'sourceX':sx,'sourceY':sy,'width':w,'height':h,'tiles':tiles,'walkZ':walk,'statics':statics,'blocked':sorted(set(range(w*h))-main),'mainPassable':sorted(main),'spawn':{'x':(ax-ay)*22,'y':(ax+ay)*22,'tileX':spawn//h,'tileY':spawn%h},'grounds':[],'radarOriginX':h-1,'radarOriginY':0,'sourceCoverage':'whole-named-region' if whole else 'contiguous-native-section','repeatedNativePatch':False,'namedRegionTiles':len(inside),'connectedRatio':len(main)/max(1,len(inside)),'terrainNames':dict(Counter(land(t[0])['name'] for t in tiles)),'sourceArchive':f'map{facet}LegacyMUL.uop'}
        if area['id'] in previous:
            old=previous[area['id']]
            r['sourceCoverage']='expanded-connected-native-section'
            r['expansionAudit']={'previousBounds':{k:old[k] for k in ('sourceX','sourceY','width','height')},'previousReachable':len(old['mainPassable']),'minimumSide':128}
        r['sourceSha256']=hashlib.sha256(json.dumps({'tiles':tiles,'statics':statics},sort_keys=True).encode()).hexdigest()
        def elev(x,y):return point(facet,fh,min(fw-1,sx+x),min(fh-1,sy+y))[1]
        for cx in range(0,w,32):
            for cy in range(0,h,32):
                patches=[]
                for x,y in sorted(((x,y) for x in range(cx,min(w,cx+32)) for y in range(cy,min(h,cy+32))),key=lambda p:sum(p)):
                    iid,height,_=tiles[x*h+y];im=landart(iid)
                    if im is None:continue
                    px=(x-y)*22;py=(x+y)*22-height*4;z1,z2,z3=elev(x+1,y),elev(x+1,y+1),elev(x,y+1)
                    if height==z1==z2==z3:patches.append((im,px-22,py))
                    else:
                        p,l,t=sloped_land(im,[(px,py),(px+22,(x+y+1)*22-z1*4),(px,(x+y+2)*22-z2*4),(px-22,(x+y+1)*22-z3*4)]);patches.append((p,l,t))
                if not patches:continue
                left=min(p[1] for p in patches);top=min(p[2] for p in patches);right=max(p[1]+p[0].width for p in patches);bottom=max(p[2]+p[0].height for p in patches)
                ground=Image.new('RGBA',(right-left,bottom-top))
                for im,x,y in patches:ground.alpha_composite(im,(x-left,y-top))
                key=save(f'grounds/{area["id"]}/{cx}-{cy}',ground,r['sourceArchive']);r['grounds'].append({'image':key,'left':left,'top':top,'width':ground.width,'height':ground.height,'tileX':cx,'tileY':cy})
        highest={}
        for s in statics:
            i=s['x']*h+s['y']
            if i not in highest or s['z']>highest[i]['z']:highest[i]=s
        radar=Image.new('RGBA',(w+h,w+h))
        for x in range(w):
            for y in range(h):
                i=x*h+y;iid,height,_=tiles[i];s=highest.get(i);tint=color(s['itemId']+0x4000,s['hue']) if s and s['z']>=height else color(iid);px=x-y+h-1;py=x+y;radar.putpixel((px,py),tint);radar.putpixel((px,py+1),tint)
        r['radar']=save(f'radars/{area["id"]}',radar,'radarcol.mul');manifest['regions'].append(r)
        (out/'manifest.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n')
        print('OK',ai,area['name'],w,h,'playable',len(main),'statics',len(statics),r['sourceCoverage'],flush=True)
    if expand_compact:manifest['regions'].sort(key=lambda r:order.index(r['areaId']))
    finalize(manifest,data,set(windows) if expand_compact else None)
    frames=[]
    # animdata.mul stores the genuine moongate pulse order, including the
    # reverse half of the pulse; sequential item IDs alone lose that motion.
    animation=data.file('animdata.mul');offset=(0xf6c//8)*548+4+(0xf6c%8)*68
    record=struct.unpack_from('64b4B',animation,offset);framecount=record[65];interval=record[66]
    offsets=list(record[:framecount])
    for iid in dict.fromkeys(0xf6c+n for n in offsets):
        im=data.art(iid)
        if im is not None:frames.append(save(f'moongate/{iid}',im,'artLegacyMUL.uop',itemId=iid))
    manifest['moongate']={'frames':[f'moongate/{0xf6c+n}' for n in offsets],'fps':10/(interval+1),'nativeFrameOffsets':offsets,'nativeFrameInterval':interval,'source':'runuo/Scripts/Items/Skill Items/Magical/Misc/Moongate.cs:72; animdata.mul','itemId':0xf6c,'soundId':0x20e}
    manifest['coverage']={'requestedAreas':requested_count,'regions':len(manifest['regions']),'images':len(manifest['images']),'staticPlacements':sum(len(r['statics']) for r in manifest['regions'])}
    (out/'manifest.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n');data.close()
    refreshed,_=refresh_statics(client,out,set(windows) if expand_compact else None);print(json.dumps(refreshed['coverage']),flush=True)
    if expand_compact:
        rows=[{'areaId':r['areaId'],'name':r['name'],**r['expansionAudit'],'width':r['width'],'height':r['height'],'reachable':len(r['mainPassable'])} for r in refreshed['regions'] if r['areaId'] in windows]
        (ROOT/'research/zone-expansion-audit.json').write_text(json.dumps(rows,indent=2)+'\n')
        for row in rows:print('EXPANDED',row['name'],row['previousReachable'],'->',row['reachable'],flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--client',default=DEFAULT_CLASSIC);p.add_argument('--out',default=ROOT/'game/assets/locations');p.add_argument('--resume',action='store_true');p.add_argument('--refresh-statics',action='store_true');p.add_argument('--expand-compact',action='store_true');p.add_argument('--limit',type=int);a=p.parse_args()
    if a.refresh_statics:refresh_statics(a.client,a.out)
    else:export(a.client,a.out,a.resume,a.limit,a.expand_compact)
