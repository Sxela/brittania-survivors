"""Read-only UOP container and catalog helpers shared by local asset setup."""
import pathlib,struct,zlib
class UOP:
 def __init__(self,path):
  self.path=pathlib.Path(path);self.file=self.path.open('rb');self.entries=[]
  magic,self.version,_,off,_,_=struct.unpack('<IIIQII',self.file.read(28))
  if magic!=0x50594d:raise ValueError('Not a Mythic package')
  seen=set()
  while off:
   if off in seen:raise ValueError('Cyclic UOP blocks')
   seen.add(off);self.file.seek(off);n,off=struct.unpack('<IQ',self.file.read(12))
   for _ in range(n):
    entry=struct.unpack('<QIIIQIH',self.file.read(34))
    if entry[0]:self.entries.append(entry)
 def read(self,entry):
  offset,header,size,rawsize,_,_,compression=entry;self.file.seek(offset+header);data=self.file.read(size)
  if compression==1:data=zlib.decompress(data)
  elif compression!=0:raise ValueError(f'Unsupported compression {compression}')
  if len(data)!=rawsize:raise ValueError('UOP member length mismatch')
  return data
 def close(self):self.file.close()

def catalog_bodies(catalog):
 """Every literal body alternative, including server visual variants."""
 wanted={400,401}
 for monster in catalog.get('monsters',[]):
  wanted.update(int(b) for b in monster.get('bodyIds',[]) if b is not None)
  if monster.get('body') is not None:wanted.add(int(monster['body']))
  wanted.update(int(v['body']) for v in monster.get('visualVariants',[]) if v.get('body') is not None)
 return wanted

def apply_material_hue_adaptations(manifest):
 """Keep ore variants distinct with server material colors, not guessed EC fields."""
 colors={107:0x979,108:0x972,109:0x96D,110:0x973,111:0x966,112:0x8AB,113:0x89F,166:0x8A5}
 for body,hue in colors.items():
  if str(body) not in manifest['animations']:continue
  manifest['animations'][str(body)]['defaultHue']=hue
  manifest['animations'][str(body)]['defaultHueEvidence']={
   'kind':'survivorMaterialColorAdaptation','originalServerBodyHue':0,
   'source':'runuo/Scripts/Misc/ResourceInfo.cs','sourceLines':[428,435],
   'explanation':'Ore-elemental material color uses the server craft-resource hue when mobile hue is zero. No original Enhanced Client default-hue override was recovered.'}

from PIL import Image
def decode_gump(data):
 width,height=struct.unpack_from('<II',data)
 if not (0<width<4096 and 0<height<4096):raise ValueError('Invalid gump bounds')
 image=Image.new('RGBA',(width,height));pixels=image.load()
 for y in range(height):
  cursor=8+struct.unpack_from('<I',data,8+y*4)[0]*4;x=0
  while x<width:
   color,length=struct.unpack_from('<HH',data,cursor);cursor+=4
   if length<1 or x+length>width:raise ValueError('Invalid gump run')
   rgb=tuple(((color>>shift)&31)*255//31 for shift in [10,5,0])
   if color:
    for px in range(x,x+length):pixels[px,y]=rgb+(255,)
   x+=length
 return image
