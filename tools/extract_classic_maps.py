"""Preserve sparse original map sectors using Classic land and static artwork."""
import argparse, hashlib, json, pathlib
from collections import Counter
from PIL import Image, ImageDraw, ImageChops
from classic_data import ClassicData, DEFAULT_CLASSIC
from classic_map_metrics import largest_component, structure_metrics, vegetation_metrics, small_structures, sparse_vegetation

def sloped_land(image,corners):
    """Map the original diamond's two triangles onto shared native z corners."""
    left=min(x for x,y in corners);top=min(y for x,y in corners)
    width=max(x for x,y in corners)-left+1;height=max(y for x,y in corners)-top+1
    result=Image.new('RGBA',(width,height));target=[(x-left,y-top) for x,y in corners]
    source=[(22,0),(44,22),(22,44),(0,22)]
    for indices in [(0,1,3),(1,2,3)]:
        points=[target[i] for i in indices]; values=[source[i] for i in indices]
        (x1,y1),(x2,y2),(x3,y3)=points
        det=x1*(y2-y3)+x2*(y3-y1)+x3*(y1-y2)
        if not det:continue
        def coefficients(axis):
            u1,u2,u3=[p[axis] for p in values]
            return ((u1*(y2-y3)+u2*(y3-y1)+u3*(y1-y2))/det,
                    (u1*(x3-x2)+u2*(x1-x3)+u3*(x2-x1))/det,
                    (u1*(x2*y3-x3*y2)+u2*(x3*y1-x1*y3)+u3*(x1*y2-x2*y1))/det)
        patch=image.transform((width,height),Image.Transform.AFFINE,coefficients(0)+coefficients(1),Image.Resampling.NEAREST)
        mask=Image.new('L',(width,height));ImageDraw.Draw(mask).polygon(points,fill=255)
        patch.putalpha(ImageChops.multiply(mask,patch.getchannel('A')));result.alpha_composite(patch)
    return result,left,top

def extract(client=DEFAULT_CLASSIC,out='game/assets/classic-maps'):
    data=ClassicData(client);out=pathlib.Path(out);out.mkdir(parents=True,exist_ok=True)
    old=json.loads(pathlib.Path('game/assets/maps/manifest.json').read_text())
    manifest={'formatVersion':3,'artStyle':'classic','sourceClient':str(client),'tileWidth':44,'tileHeight':44,'sectorSize':64,'elevationPixels':4,'selectionPolicy':old['selectionPolicy'],'images':{},'regions':[],'landDefinitions':{},'limitations':['Original land diamond triangles follow shared native map corner elevations. Dynamic server houses and native lighting are not reproduced.']}
    art={}; definitions={}
    def tile(iid):
        if iid not in definitions:
            im=data.art(iid);art[iid]=im;definitions[iid]={**data.tile(iid),'bounds':[im.width-1,im.height-1,0,0] if im else [0,0,0,0]}
        return definitions[iid]
    def save(key,image,archive,**extra):
        dest=out/(key+'.png');dest.parent.mkdir(parents=True,exist_ok=True);image.save(dest)
        source=data.member(archive,f'build/artlegacymul/{extra["itemId"]+0x4000:08d}.tga') if archive=='artLegacyMUL.uop' else None
        manifest['images'][key]={'src':'assets/classic-maps/'+key+'.png','width':image.width,'height':image.height,'sourceArchive':archive,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),**({'sourceSha256':hashlib.sha256(source).hexdigest()} if source else {}),**extra};return key
    land_art={}
    def sector(sx,sy):
        tiles=[None]*4096;statics=[];source=hashlib.sha256()
        for bx in range(8):
            for by in range(8):
                block=(sx//8+bx)*512+sy//8+by
                for index,(land,z) in enumerate(data.map_block(block)):
                    x=bx*8+index%8;y=by*8+index//8;tiles[x*64+y]=[land,z,[]]
                source.update(data.raw[(0,block//4096)][block%4096*196:(block%4096+1)*196])
                for iid,x,y,z,hue in data.statics_block(block):statics.append({'x':bx*8+x,'y':by*8+y,'z':z,'itemId':iid,'hue':hue})
        blocked={i for i,(land,z,_) in enumerate(tiles) if data.land_tile(land)['flags']&0xc0}
        for s in statics:
            if tile(s['itemId'])['flags']&0x40 and abs(s['z']-tiles[s['x']*64+s['y']][1])<=16:blocked.add(s['x']*64+s['y'])
        return tiles,statics,blocked,source.hexdigest()
    for previous in old['regions']:
        sx,sy=previous['sourceX'],previous['sourceY'];candidates=[]
        for dx,dy in [(0,0)]+[(dx,dy) for radius in range(1,6) for dx in range(-radius,radius+1) for dy in range(-radius,radius+1) if max(abs(dx),abs(dy))==radius]:
            x,y=sx+dx*64,sy+dy*64
            if not 0<=x<7168 or not 0<=y<4096:continue
            tiles,statics,blocked,source_hash=sector(x,y);main=largest_component(blocked)
            structures=structure_metrics(statics,tile);veg=vegetation_metrics(statics,tile)
            if len(main)<4096*.7 or not small_structures(structures) or not sparse_vegetation(veg):continue
            counts=Counter(data.land_tile(t[0])['name'].lower() for t in tiles)
            plains=(counts['grass']+counts['dirt'])/4096
            if previous['name'] in ('Britain outskirts','Britannian plains','Open countryside','Green Acres') and plains<.5:continue
            candidates.append((x,y,tiles,statics,blocked,main,structures,veg,counts,plains,source_hash));break
        if not candidates:raise ValueError('No sparse Classic sector for '+previous['name'])
        sx,sy,tiles,statics,blocked,main,structures,veg,counts,plains,source_hash=candidates[0]
        spawn=min(main,key=lambda i:((i//64)-(i%64))**2+((i//64)+(i%64)-63)**2);ax,ay=spawn//64+.5,spawn%64+.5
        region={'id':len(manifest['regions']),'name':previous['name'],'sourceArchive':'map0LegacyMUL.uop','sourceX':sx,'sourceY':sy,'tiles':tiles,'statics':statics,'blocked':sorted(blocked),'mainPassable':sorted(main),'passableRatio':1-len(blocked)/4096,'connectedRatio':len(main)/4096,'structureMetrics':structures,'vegetationMetrics':veg,'plainsRatio':plains,'terrainNames':dict(counts),'missingStaticArt':[],'spawn':{'x':(ax-ay)*22,'y':(ax+ay)*22,'tileX':spawn//64,'tileY':spawn%64}}
        region.update({'sectorId':sx//64*64+sy//64,'sourceSha256':source_hash})
        ground=Image.new('RGBA',(2816,2880))
        def elevation(x,y):return tiles[min(x,63)*64+min(y,63)][1]
        for x,y in sorted(((x,y) for x in range(64) for y in range(64)),key=lambda p:sum(p)):
            land,z,_=tiles[x*64+y]
            if land not in land_art:land_art[land]=data.land(land)
            image=land_art[land]
            if image is None:raise ValueError(f'Missing Classic land art {land}')
            px=(x-y)*22+1408;py=(x+y)*22+32-z*4
            z1,z2,z3=elevation(x+1,y),elevation(x+1,y+1),elevation(x,y+1)
            if z==z1==z2==z3:ground.alpha_composite(image,(px-22,py))
            else:
                patch,left,top=sloped_land(image,[(px,py),(px+22,(x+y+1)*22+32-z1*4),(px,(x+y+2)*22+32-z2*4),(px-22,(x+y+1)*22+32-z3*4)])
                ground.alpha_composite(patch,(left,top))
        region['ground']=save(f'regions/{region["id"]}-ground',ground,'map0LegacyMUL.uop',sourceX=sx,sourceY=sy,sourceSha256=source_hash)
        for s in statics:
            iid=s['itemId'];definition=tile(iid);image=art[iid];key=f'statics/{iid}'
            if image is not None and key not in manifest['images']:save(key,image,'artLegacyMUL.uop',itemId=iid)
            s.update({'image':key if image else None,'flags':definition['flags'],'name':definition['name'],'bounds':definition['bounds'],'classicArt':True,'light':bool(definition['flags']&0x800000),'roof':bool(definition['flags']&0x10000000)})
            if image is None:region['missingStaticArt'].append(iid)
        manifest['regions'].append(region)
        for land,_,_ in tiles:
            definition=data.land_tile(land);flags=definition['flags']
            manifest['landDefinitions'][str(land)]={**definition,'tileFlags':flags,'flags':[name for bit,name in [(0x40,'impassable'),(0x80,'wet')] if flags&bit],'passable':not bool(flags&0xc0)}
        print(region['name'],sx,sy,'connected',region['connectedRatio'],'vegetation',veg,'statics',len(statics),flush=True)
    manifest['coverage']={'regions':len(manifest['regions']),'images':len(manifest['images']),'staticPlacements':sum(len(r['statics']) for r in manifest['regions']),'missingStaticIds':sorted({i for r in manifest['regions'] for i in r['missingStaticArt']})}
    from prepare_ground_patches import analyze
    analyze(manifest,image_root=out)
    (out/'manifest.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n');data.close()
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--client',default=DEFAULT_CLASSIC);parser.add_argument('--out',default='game/assets/classic-maps');args=parser.parse_args();extract(args.client,args.out)
