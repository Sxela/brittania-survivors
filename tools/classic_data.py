"""Read-only Classic Client art, gumps, tile data, sound and original maps."""
from __future__ import annotations
import pathlib, re, struct
from PIL import Image
from classic_archive import UOP
from client_bodymap import create_hash
from classic_compression import read_classic_entry

from classic_paths import DEFAULT_CLASSIC

def rgb555(value):
    return ((value >> 10 & 31)*255//31, (value >> 5 & 31)*255//31, (value & 31)*255//31, 255)

class ClassicData:
    def __init__(self, client=DEFAULT_CLASSIC, use_patches=False):
        self.client=pathlib.Path(client); self.packages={}; self.raw={}; self.use_patches=use_patches
        self.tiles=(self.client/'tiledata.mul').read_bytes()
        self.gump_defs={}
        for line in (self.client/'gump.def').read_text(errors='replace').splitlines():
            match=re.match(r'\s*(\d+)\s*\{([^}]+)\}\s*(\d+)',line)
            if match:self.gump_defs[int(match[1])]=([int(n) for n in re.findall(r'-?\d+',match[2])],int(match[3]))

    def member(self, archive, virtual):
        if archive not in self.packages:
            package=UOP(self.client/archive); self.packages[archive]=(package,{e[4]:e for e in package.entries})
        package,entries=self.packages[archive]; entry=entries.get(create_hash(virtual))
        return None if entry is None else read_classic_entry(package,entry)

    def file(self,name):
        if name not in self.raw:self.raw[name]=(self.client/name).read_bytes()
        return self.raw[name]

    def tile(self,item):
        offset=512*(4+32*30)+(item//32)*(4+32*41)+4+(item%32)*41
        if offset+41>len(self.tiles):return {'animation':0,'flags':0,'layer':0,'height':0,'name':''}
        return {'flags':struct.unpack_from('<Q',self.tiles,offset)[0], 'layer':self.tiles[offset+9], 'animation':struct.unpack_from('<H',self.tiles,offset+14)[0], 'height':self.tiles[offset+20], 'name':self.tiles[offset+21:offset+41].split(b'\0')[0].decode('latin1')}

    def land_tile(self,item):
        offset=(item//32)*(4+32*30)+4+(item%32)*30
        return {'flags':struct.unpack_from('<Q',self.tiles,offset)[0], 'texture':struct.unpack_from('<H',self.tiles,offset+8)[0], 'name':self.tiles[offset+10:offset+30].split(b'\0')[0].decode('latin1')}

    def art(self,item):
        data=self.member('artLegacyMUL.uop',f'build/artlegacymul/{item+0x4000:08d}.tga')
        if not data or len(data)<8:return None
        width,height=struct.unpack_from('<HH',data,4)
        if not 0<width<4096 or not 0<height<4096:return None
        image=Image.new('RGBA',(width,height)); pixels=image.load(); start=8+height*2
        for y in range(height):
            cursor=start+struct.unpack_from('<H',data,8+y*2)[0]*2; x=0
            while cursor+4<=len(data):
                skip,count=struct.unpack_from('<HH',data,cursor);cursor+=4
                if not skip and not count:break
                x+=skip
                for _ in range(count):
                    color=struct.unpack_from('<H',data,cursor)[0];cursor+=2
                    if 0<=x<width and color:pixels[x,y]=rgb555(color)
                    x+=1
        return image

    def resolve_gump(self,item):
        if self.member('gumpartLegacyMUL.uop',f'build/gumpartlegacymul/{item:08d}.tga') is not None:return item,0
        for alternative in self.gump_defs.get(item,([],0))[0]:
            if alternative>=0 and self.member('gumpartLegacyMUL.uop',f'build/gumpartlegacymul/{alternative:08d}.tga') is not None:return alternative,self.gump_defs[item][1]
        return item,0

    def gump(self,item):
        item,_=self.resolve_gump(item)
        data=self.member('gumpartLegacyMUL.uop',f'build/gumpartlegacymul/{item:08d}.tga')
        if data is None:return None
        from classic_archive import decode_gump
        return decode_gump(data)

    def sound(self,item):return self.member('soundLegacyMUL.uop',f'build/soundlegacymul/{item:08d}.dat')

    def land(self,item):
        data=self.member('artLegacyMUL.uop',f'build/artlegacymul/{item:08d}.tga')
        if not data:return None
        image=Image.new('RGBA',(44,44));pixels=image.load();cursor=0
        for y in range(44):
            count=2*(y+1) if y<22 else 2*(44-y);left=(44-count)//2
            for x in range(left,left+count):
                pixels[x,y]=rgb555(struct.unpack_from('<H',data,cursor)[0]);cursor+=2
        return image

    def map_block(self,block,facet=0):
        patches=self.diff_blocks(facet,False)
        if block in patches:
            data=self.file(f'mapdif{facet}.mul');offset=patches[block]*196+4
            return [struct.unpack_from('<Hb',data,offset+i*3) for i in range(64)]
        chunk=block//4096
        key=(facet,chunk)
        if key not in self.raw:self.raw[key]=self.member(f'map{facet}LegacyMUL.uop',f'build/map{facet}legacymul/{chunk:08d}.dat')
        data=self.raw[key];offset=block%4096*196+4
        return [struct.unpack_from('<Hb',data,offset+i*3) for i in range(64)]

    def statics_block(self,block,facet=0):
        patches=self.diff_blocks(facet,True)
        patched=block in patches
        index=self.file(f'stadifi{facet}.mul' if patched else f'staidx{facet}.mul')
        offset,length,_=struct.unpack_from('<iii',index,(patches[block] if patched else block)*12)
        if offset<0 or length<=0:return []
        data=self.file(f'stadif{facet}.mul' if patched else f'statics{facet}.mul')
        return [struct.unpack_from('<HBBbH',data,p) for p in range(offset,offset+length,7)]

    def diff_blocks(self,facet,statics=True):
        """Source diffs replace whole blocks, including explicitly empty patches.

        Optional legacy mode mirrors RunUO Server/TileMatrixPatch.cs. The modern
        client default follows Scripts/Misc/MapDefinitions.cs:41 (disabled).
        Never merge obsolete base statics
        into a patched block. Clients without a complete patch set use the base.
        """
        key=('diff',facet,statics)
        if key not in self.raw:
            prefix='stadif' if statics else 'mapdif'
            names=[f'{prefix}l{facet}.mul',f'{prefix}{facet}.mul']
            if statics:names.append(f'stadifi{facet}.mul')
            if self.use_patches and all((self.client/name).exists() for name in names):
                raw=self.file(names[0]);self.raw[key]={block:i for i,(block,) in enumerate(struct.iter_unpack('<i',raw))}
            else:self.raw[key]={}
        return self.raw[key]

    def close(self):
        for package,_ in self.packages.values():package.close()
