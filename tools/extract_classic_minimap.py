"""Recover the unchanged Classic radar frame and original radar-colored sectors."""
from __future__ import annotations
import hashlib, json, pathlib, struct
from PIL import Image
from classic_data import ClassicData, DEFAULT_CLASSIC, rgb555

ROOT = pathlib.Path(__file__).resolve().parents[1]

def aperture(image):
    """The connected native 0x8421 fill, excluding similarly colored frame pixels."""
    width,height=image.size; center=(width//2,height//2)
    pending=[center]; seen={center}; pixels=image.load()
    while pending:
        x,y=pending.pop()
        for p in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
            a,b=p
            if 0<=a<width and 0<=b<height and p not in seen and pixels[a,b]==(8,8,8,255):
                seen.add(p);pending.append(p)
    rows=[]
    for y in range(height):
        xs=sorted(x for x,yy in seen if yy==y)
        if xs:
            assert xs==list(range(xs[0],xs[-1]+1)), 'Unexpected interrupted radar aperture'
            rows.append([y,xs[0],xs[-1]-xs[0]+1])
    return seen,rows

def extract(client=DEFAULT_CLASSIC):
    source=ClassicData(client); output=ROOT/'game/assets/classic-minimap';output.mkdir(parents=True,exist_ok=True)
    manifest={'formatVersion':1,'sourceClient':str(client),'gumpId':5010,'width':200,'height':200,'center':{'x':100,'y':100},'worldPixelsPerRadarPixel':22,'frame':'frame','images':{},'regions':[]}
    def save(key,image,**evidence):
        path=output/f'{key}.png';image.save(path)
        manifest['images'][key]={'src':path.relative_to(ROOT/'game').as_posix(),'width':image.width,'height':image.height,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),**evidence}
    frame=source.gump(5010)
    if frame is None:raise RuntimeError('Original small radar gump 5010 is unavailable')
    assert frame.size==(200,200)
    save('frame',frame,sourceArchive='gumpartLegacyMUL.uop',sourceGump=5010)
    points,rows=aperture(frame)
    mask=Image.new('RGBA',frame.size)
    for point in points:mask.putpixel(point,(255,255,255,255))
    save('aperture-mask',mask,sourceGump=5010,derivedFrom='Connected native 0x8421 radar fill')
    manifest['aperture']={'rows':rows,'pixelCount':len(points),'bounds':[min(x for x,y in points),min(y for x,y in points),max(x for x,y in points)+1,max(y for x,y in points)+1]}
    colors=source.file('radarcol.mul');hues=source.file('hues.mul')
    def color(index,hue=0):
        hue=(hue&0x3fff)-1
        if hue>=0:
            # ClassicUO's original radar hue path selects index 0x4000 >> 10 = 16.
            offset=(hue//8)*708+4+(hue%8)*88+16*2
            if offset+2<=len(hues):return rgb555(struct.unpack_from('<H',hues,offset)[0])
        if 0<=index<len(colors)//2:return rgb555(struct.unpack_from('<H',colors,index*2)[0])
        return (8,8,8,255)
    maps=json.loads((ROOT/'game/assets/maps/manifest.json').read_text())
    for index,region in enumerate(maps['regions']):
        highest={}
        for item in region['statics']:
            key=item['x']*64+item['y'];previous=highest.get(key)
            if previous is None or item['z']>previous['z']:highest[key]=item
        radar=Image.new('RGBA',(128,128))
        for a in range(64):
            for b in range(64):
                cell=a*64+b;tile,z,*_=region['tiles'][cell];item=highest.get(cell)
                tint=color(item['itemId']+0x4000,item['hue']) if item and item['z']>=z else color(tile)
                x=a-b+63;y=a+b
                radar.putpixel((x,y),tint);radar.putpixel((x,y+1),tint)
        key=f'region-{index}';save(key,radar,sourceArchive='radarcol.mul',sourceRegion=region['name'],sourceX=region['sourceX'],sourceY=region['sourceY'])
        manifest['regions'].append({'id':region['id'],'image':key})
    (output/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')))
    source.close()
    print(json.dumps({'frame':5010,'size':frame.size,'aperturePixels':len(points),'regions':len(manifest['regions'])}))

if __name__=='__main__':extract()
