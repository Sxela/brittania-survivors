"""Export only native, named-region-contained Classic map patches for route areas.

Small complete patches are repeated to the existing 64-tile renderer size. No
terrain, decor, native elevation, hue, or transitions are synthesized.
"""
import argparse, hashlib, json, math, pathlib, struct
from collections import Counter
from functools import lru_cache
from PIL import Image, ImageChops
from classic_data import ClassicData, DEFAULT_CLASSIC, rgb555
from extract_classic_maps import sloped_land
from classic_map_metrics import largest_component, structure_metrics, small_structures, vegetation_metrics, sparse_vegetation

ROOT=pathlib.Path(__file__).resolve().parents[1]
FACETS={'Felucca':(0,7168,4096),'Trammel':(1,7168,4096),'Ilshenar':(2,2304,1600),'Malas':(3,2560,2048),'Tokuno':(4,1448,1448),'TerMur':(5,1280,4096)}

def add_radars(manifest,data,out):
    colors=data.file('radarcol.mul');hues=data.file('hues.mul')
    def color(index,hue=0):
        hue=(hue&0x3fff)-1
        if hue>=0:
            offset=(hue//8)*708+4+(hue%8)*88+32
            if offset+2<=len(hues):return rgb555(struct.unpack_from('<H',hues,offset)[0])
        return rgb555(struct.unpack_from('<H',colors,index*2)[0]) if 0<=index<len(colors)//2 else (8,8,8,255)
    for region in manifest['regions']:
        highest={}
        for s in region['statics']:
            cell=s['x']*64+s['y']
            if cell not in highest or s['z']>highest[cell]['z']:highest[cell]=s
        radar=Image.new('RGBA',(128,128))
        for a in range(64):
            for b in range(64):
                cell=a*64+b;iid,z,*_=region['tiles'][cell];s=highest.get(cell)
                tint=color(s['itemId']+0x4000,s['hue']) if s and s['z']>=z else color(iid)
                x=a-b+63;y=a+b;radar.putpixel((x,y),tint);radar.putpixel((x,y+1),tint)
        key=f'zone-radar/{region["areaId"]}';dest=out/(key+'.png');dest.parent.mkdir(parents=True,exist_ok=True);radar.save(dest)
        manifest['images'][key]={'src':'assets/zone-maps/'+key+'.png','width':128,'height':128,'sourceArchive':'radarcol.mul','sha256':hashlib.sha256(dest.read_bytes()).hexdigest()};region['radar']=key

def analyze_ground(manifest,out):
    """Same pixel-center diamond test as prepare_ground_patches, in Pillow C."""
    mask=Image.new('L',(172,172));pixels=mask.load()
    for dx in range(-86,86):
        for dy in range(-86,86):
            if abs(dx+.5)+abs(dy+.5)<86:pixels[dx+86,dy+86]=255
    for region in manifest['regions']:
        path=out/pathlib.Path(manifest['images'][region['ground']]['src']).relative_to('assets/zone-maps');alpha=Image.open(path).getchannel('A')
        fills=[]
        for a in range(0,64,4):
            for b in range(0,64,4):
                cx=1408+(a-b)*22;cy=32+(a+b+4)*22
                # Test zero alpha only, matching runtime transparency behavior.
                crop=alpha.crop((cx-86,cy-86,cx+86,cy+86)).point(lambda v:255 if v else 0)
                fills.append(ImageChops.subtract(mask,crop).getbbox() is not None)
        region['groundPatchBorderFill']=fills;region['groundPatchSourceSha256']=hashlib.sha256(path.read_bytes()).hexdigest()

def finalize_manifest(manifest):
    used={r[k] for r in manifest['regions'] for k in ('ground','radar')}
    used.update(s['image'] for r in manifest['regions'] for s in r['statics'] if s.get('image'))
    manifest['images']={k:v for k,v in manifest['images'].items() if k in used}
    manifest['selectionPolicy']['featureClosure']='Reject native wet, impassable, or void land on source patch boundary; preserve all interior native transitions and statics.'
    manifest['selectionPolicy']['sourceSizes']=[64,32,16,8,4]
    manifest['limitations']=['Small native source patches repeat to64tiles; sourceSize and repeatedNativePatch disclose this adaptation. Native maps do not include dynamic server houses. All source land, static placements, heights and hues are retained. Feature closure checks native wet/impassable/void terrain. Multi-floor interiors retain upper floor statics, which require runtime cutaway.']
    for r in manifest['regions']:
        n=r['sourceSize'];zs=[r['tiles'][x*64+y][1] for x in range(n) for y in range(n) if x in (0,n-1) or y in (0,n-1)]
        r['quality']['sourceBoundaryElevationRange']=[min(zs),max(zs)]
        r['quality']['sourceStaticPlacements']=len(r['statics'])//((64//n)**2)
        r['quality']['nativeLandArtAvailable']=True
        r['quality']['nativeStaticArtAvailable']=not r['missingStaticArt']
        r['quality']['candidateRejections'].pop('null',None)
    manifest['coverage']['images']=len(manifest['images'])

def export(client=DEFAULT_CLASSIC,out=ROOT/'game/assets/zone-maps',resume=False,refresh=None):
    out=pathlib.Path(out);out.mkdir(parents=True,exist_ok=True)
    plan=json.loads((ROOT/'research/zone-run-plan.json').read_text());scan=json.loads((ROOT/'research/zone-scan.json').read_text());zones={z['id']:z for z in scan['zones']}
    data=ClassicData(client);art={};lands={};defs={}
    manifest={'formatVersion':3,'artStyle':'classic','sourceClient':str(client),'sectorSize':64,'tileWidth':44,'tileHeight':44,'elevationPixels':4,'images':{},'regions':[],'landDefinitions':{},'coverage':{},'gaps':[], 'selectionPolicy':{'minimumConnectedRatio':.7,'maxTallVegetation':24,'maxEstimatedCanopyRatio':.12,'maxStructureFootprintTiles':12,'maxStraightWallRunTiles':8,'allowBoundaryStructures':False,'sourceSizes':[64,32,16,8],'containment':'Every source tile must be inside its named region rectangle union.','featureClosure':'Reject wet or impassable rock/mountain components intersecting the source patch boundary.'},'limitations':['Small native source patches repeat to 64 tiles; sourceSize and repeatedNativePatch disclose this adaptation. Native maps do not include dynamic server houses. Feature closure is evaluated from native wet flags and impassable rock/mountain names, not elevation alone.']}
    if resume and (out/'manifest.json').exists():
        manifest=json.loads((out/'manifest.json').read_text());manifest['gaps']=[]
        if refresh:manifest['regions']=[r for r in manifest['regions'] if r['name'] not in refresh]
    manifest['selectionPolicy']['sourceSizes']=[64,32,16,8,4]
    completed={r['areaId'] for r in manifest['regions']}
    @lru_cache(maxsize=12000)
    def block(facet,b):return data.map_block(b,facet),data.statics_block(b,facet)
    def tile(iid):
        if iid not in defs:
            im=data.art(iid);art[iid]=im;defs[iid]={**data.tile(iid),'bounds':[im.width-1,im.height-1,0,0] if im else [0,0,0,0]}
        return defs[iid]
    def land(iid):
        if iid not in lands:lands[iid]=data.land_tile(iid)
        return lands[iid]
    def save(key,image,archive,**extra):
        dest=out/(key+'.png');dest.parent.mkdir(parents=True,exist_ok=True);image.save(dest)
        manifest['images'][key]={'src':'assets/zone-maps/'+key+'.png','width':image.width,'height':image.height,'sourceArchive':archive,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),**extra};return key
    def contains(zone,x,y):return any(r['x']<=x<r['x']+r['width'] and r['y']<=y<r['y']+r['height'] for r in zone['rectangles'])
    def native(zone,sx,sy,n):
        facet,fw,fh=FACETS[zone['facet']]
        if sx<0 or sy<0 or sx+n>fw or sy+n>fh:return None,'outside-facet'
        if any(not contains(zone,x,y) for x in range(sx,sx+n) for y in range(sy,sy+n)):return None,'outside-named-region'
        tiles=[];statics=[]
        for x in range(sx,sx+n):
            for y in range(sy,sy+n):
                t=block(facet,(x//8)*(fh//8)+y//8)[0][(y%8)*8+x%8];tiles.append([t[0],t[1],[]])
        for bx in range(sx//8,(sx+n-1)//8+1):
            for by in range(sy//8,(sy+n-1)//8+1):
                for iid,x,y,z,hue in block(facet,bx*(fh//8)+by)[1]:
                    x+=bx*8-sx;y+=by*8-sy
                    if 0<=x<n and 0<=y<n:statics.append({'x':x,'y':y,'z':z,'itemId':iid,'hue':hue})
        for x in range(n):
            for y in range(n):
                d=land(tiles[x*n+y][0]);name=d['name'].lower();f=d['flags']
                feature=bool(f&0xc0) or name=='void'
                if feature and (x in (0,n-1) or y in (0,n-1)):return None,'open-water-or-mountain'
        if refresh:
            boundary=[tiles[x*n+y][1] for x in range(n) for y in range(n) if x in (0,n-1) or y in (0,n-1)]
            if max(boundary)-min(boundary)>2:return None,'uneven-repeat-boundary'
        expanded=[tiles[(x%n)*n+y%n] for x in range(64) for y in range(64)]
        repeated=[{**s,'x':s['x']+dx,'y':s['y']+dy} for dx in range(0,64,n) for dy in range(0,64,n) for s in statics]
        blocked={i for i,t in enumerate(expanded) if land(t[0])['flags']&0xc0}
        for s in repeated:
            if tile(s['itemId'])['flags']&0x40 and abs(s['z']-expanded[s['x']*64+s['y']][1])<=16:blocked.add(s['x']*64+s['y'])
        if len(blocked)>4096*.3:return None,'less-than-70-percent-passable'
        main=largest_component(blocked)
        if len(main)<4096*.7:return None,'less-than-70-percent-connected'
        structures=structure_metrics(repeated,tile)
        if not small_structures(structures):return None,'large-or-cut-structure'
        veg=vegetation_metrics(repeated,tile)
        if not sparse_vegetation(veg):return None,'dense-vegetation'
        if any(data.land(t[0]) is None for t in {tuple(t[:2]) for t in tiles}):return None,'missing-land-art'
        return (expanded,repeated,blocked,main,structures,veg),None
    def candidates(zone,n):
        points=[];go=zone.get('go')
        if go:points.append((int(go['x']),int(go['y'])))
        population=[tuple(p['point'][:2]) for p in zone.get('population',[]) if p.get('point')]
        points.extend(population[::max(1,len(population)//12)][:12])
        for r in zone['rectangles']:
            points.append((r['x']+r['width']//2,r['y']+r['height']//2))
            if r['width']>=n and r['height']>=n:
                step=max(1 if resume else 2,n//2,math.ceil(math.sqrt(r['width']*r['height']/(1600 if resume else 100))))
                points.extend((x+n//2,y+n//2) for x in range(r['x'],r['x']+r['width']-n+1,step) for y in range(r['y'],r['y']+r['height']-n+1,step))
        seen=set()
        for px,py in points:
            for dx,dy in ((0,0),(-n//4,0),(n//4,0),(0,-n//4),(0,n//4)):
                pair=(px-n//2+dx,py-n//2+dy)
                if pair not in seen:seen.add(pair);yield pair
                if len(seen)>=(8000 if resume else 200):return
    for ai,area in enumerate(plan['pool']):
        if area['id'] in completed:continue
        chosen=None;rejects=Counter()
        for n in (64,32,16,8,4):
            best=None;bestscore=float('inf')
            for zid in area['zoneIds']:
                zone=zones[zid]
                for sx,sy in candidates(zone,n):
                    result,reason=native(zone,sx,sy,n)
                    if result and 'snow/ice' in area['biome'] and sum(any(word in land(t[0])['name'].lower() for word in ('snow','ice')) for t in result[0])<2048:
                        result=None;reason='snow-ice-biome-mismatch'
                    if result:
                        if not refresh:chosen=(zone,sx,sy,n,result);break
                        score=len(result[1])+sum(abs(t[1]-result[0][0][1]) for t in result[0])
                        if score<bestscore:best=(zone,sx,sy,n,result);bestscore=score
                        if score==0:break
                    if reason:rejects[reason]+=1
                if chosen:break
            if best:chosen=best
            if chosen:break
        if not chosen:
            gap={'areaId':area['id'],'name':area['name'],'zoneIds':area['zoneIds'],'candidateRejections':dict(rejects)};manifest['gaps'].append(gap);print('GAP',ai,area['name'],dict(rejects),flush=True);continue
        zone,sx,sy,n,(tiles,statics,blocked,main,structures,veg)=chosen
        spawn=min(main,key=lambda i:((i//64)-31)**2+((i%64)-31)**2);ax,ay=spawn//64+.5,spawn%64+.5
        region={'id':area['id'],'areaId':area['id'],'name':area['name'],'biome':area['biome'],'facet':zone['facet'],'sourceFacet':FACETS[zone['facet']][0],'sourceZoneId':zone['id'],'sourceX':sx,'sourceY':sy,'sourceSize':n,'repeatedNativePatch':n<64,'sourceArchive':f'map{FACETS[zone["facet"]][0]}LegacyMUL.uop','tiles':tiles,'statics':statics,'blocked':sorted(blocked),'mainPassable':sorted(main),'connectedRatio':len(main)/4096,'passableRatio':1-len(blocked)/4096,'structureMetrics':structures,'vegetationMetrics':veg,'terrainNames':dict(Counter(land(t[0])['name'].lower() for t in tiles)),'missingStaticArt':[],'spawn':{'x':(ax-ay)*22,'y':(ax+ay)*22,'tileX':spawn//64,'tileY':spawn%64},'quality':{'nativeRegionContained':True,'closedWetAndMountainFeatures':True,'noCutOrLargeStructures':True,'sparseVegetation':True,'candidateRejections':dict(rejects)}}
        region['sourceSha256']=hashlib.sha256(json.dumps({'tiles':tiles,'statics':statics},sort_keys=True).encode()).hexdigest()
        ground=Image.new('RGBA',(2816,2880))
        def elevation(x,y):return tiles[min(x,63)*64+min(y,63)][1]
        for x,y in sorted(((x,y) for x in range(64) for y in range(64)),key=lambda p:sum(p)):
            iid,z,_=tiles[x*64+y]
            # Separate item and terrain caches: IDs overlap in native files.
            image=data.land(iid) if ('land',iid) not in art else art[('land',iid)]
            art[('land',iid)]=image
            px=(x-y)*22+1408;py=(x+y)*22+32-z*4;z1,z2,z3=elevation(x+1,y),elevation(x+1,y+1),elevation(x,y+1)
            if z==z1==z2==z3:ground.alpha_composite(image,(px-22,py))
            else:
                patch,left,top=sloped_land(image,[(px,py),(px+22,(x+y+1)*22+32-z1*4),(px,(x+y+2)*22+32-z2*4),(px-22,(x+y+1)*22+32-z3*4)]);ground.alpha_composite(patch,(left,top))
        region['ground']=save(f'zone/{area["id"]}/ground',ground,region['sourceArchive'],sourceX=sx,sourceY=sy,sourceSize=n,sourceSha256=region['sourceSha256'])
        for s in statics:
            iid=s['itemId'];definition=tile(iid);image=art[iid];key=f'zone-statics/{iid}'
            if image is not None and key not in manifest['images']:save(key,image,'artLegacyMUL.uop',itemId=iid)
            s.update({'image':key if image else None,'flags':definition['flags'],'name':definition['name'],'bounds':definition['bounds'],'classicArt':True,'light':bool(definition['flags']&0x800000),'roof':bool(definition['flags']&0x10000000)})
            if image is None:region['missingStaticArt'].append(iid)
        for iid,_,_ in tiles:
            d=land(iid);manifest['landDefinitions'][str(iid)]={**d,'tileFlags':d['flags'],'flags':[s for bit,s in [(0x40,'impassable'),(0x80,'wet')] if d['flags']&bit],'passable':not bool(d['flags']&0xc0)}
        manifest['regions'].append(region);print('OK',ai,area['name'],zone['facet'],sx,sy,'native',n,'connected',round(region['connectedRatio'],3),flush=True)
    analyze_ground(manifest,out)
    manifest['coverage']={'requestedAreas':len(plan['pool']),'regions':len(manifest['regions']),'gaps':len(manifest['gaps']),'images':len(manifest['images']),'staticPlacements':sum(len(r['statics']) for r in manifest['regions']),'sourceSizeCounts':dict(Counter(r['sourceSize'] for r in manifest['regions']))}
    add_radars(manifest,data,out);manifest['coverage']['images']=len(manifest['images'])
    finalize_manifest(manifest)
    (out/'manifest.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n');data.close();print(json.dumps(manifest['coverage']),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--client',default=DEFAULT_CLASSIC);p.add_argument('--out',default=ROOT/'game/assets/zone-maps');p.add_argument('--radar-only',action='store_true');p.add_argument('--resume',action='store_true');p.add_argument('--refresh',nargs='*');a=p.parse_args()
    if a.radar_only:
        out=pathlib.Path(a.out);m=json.loads((out/'manifest.json').read_text());d=ClassicData(a.client);add_radars(m,d,out);m['coverage']['images']=len(m['images']);(out/'manifest.json').write_text(json.dumps(m,separators=(',',':'))+'\n');d.close()
    else:export(a.client,a.out,a.resume,a.refresh)
