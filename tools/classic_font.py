"""Wrap original unifont.mul bitmap runs in TrueType outlines, without redrawing glyphs."""
from __future__ import annotations
import struct,hashlib

def bitmap_font(raw, family='UO Classic'):
    codes=list(range(32,256))+[0x2026]; glyphs=[b'']; metrics=[(512,0)]; maximum_points=0; maximum_contours=0
    for code in codes:
        offset=struct.unpack_from('<I',raw,code*4)[0]
        if not offset: glyphs.append(b'');metrics.append((384,0));continue
        ox,oy,w,h=struct.unpack_from('<bbBB',raw,offset);stride=(w+7)//8;points=[];ends=[]
        for row in range(h):
            bits=raw[offset+4+row*stride:offset+4+(row+1)*stride]; col=0
            while col<w:
                if not bits[col//8]&(0x80>>(col%8)):col+=1;continue
                start=col
                while col<w and bits[col//8]&(0x80>>(col%8)):col+=1
                x1=(ox+start)*64;x2=(ox+col)*64;y1=(18-oy-row-1)*64;y2=y1+64
                points.extend([(x1,y1),(x1,y2),(x2,y2),(x2,y1)]);ends.append(len(points)-1)
        metrics.append((max(1,w+ox+1)*64,ox*64))
        if not points:glyphs.append(b'');continue
        maximum_points=max(maximum_points,len(points));maximum_contours=max(maximum_contours,len(ends))
        b=struct.pack('>hhhhh',len(ends),min(x for x,y in points),min(y for x,y in points),max(x for x,y in points),max(y for x,y in points))
        b+=struct.pack('>'+('H'*len(ends)),*ends)+b'\x00\x00'+bytes([1])*len(points)
        for axis in (0,1):
            prev=0
            for point in points:b+=struct.pack('>h',point[axis]-prev);prev=point[axis]
        glyphs.append(b+b'\0'*(len(b)%2))
    offsets=[0];glyf=b''
    for b in glyphs:glyf+=b;offsets.append(len(glyf))
    count=len(glyphs)
    tables={}
    tables['glyf']=glyf;tables['loca']=struct.pack('>'+('I'*len(offsets)),*offsets)
    tables['head']=struct.pack('>IIIIHHQQhhhhHHhhh',0x10000,0x10000,0,0x5F0F3CF5,11,1024,0,0,-256,-512,2048,1536,0,8,2,1,0)
    tables['hhea']=struct.pack('>IhhhHhhhhhhhhhhhH',0x10000,1152,-384,0,max(a for a,l in metrics),-256,0,2048,1,0,0,0,0,0,0,0,count)
    tables['hmtx']=b''.join(struct.pack('>Hh',a,l) for a,l in metrics)
    tables['maxp']=struct.pack('>IH'+'H'*13,0x10000,count,maximum_points,maximum_contours,0,0,2,0,0,0,0,0,0,0,0)
    # One contiguous BMP range plus mandatory sentinel. idDelta maps code32 to glyph1.
    fmt=struct.pack('>HHHHHHH',4,40,0,6,4,1,2)+struct.pack('>HHHHHHHHHHHHH',255,0x2026,65535,0,32,0x2026,65535,(1-32)&65535,(225-0x2026)&65535,1,0,0,0)
    tables['cmap']=struct.pack('>HHHHI',0,1,3,1,12)+fmt
    names=[(1,family),(2,'Regular'),(3,family+' Bitmap 1'),(4,family),(6,family.replace(' ',''))];strings=b'';records=b''
    for nid,value in names:
        encoded=value.encode('utf-16be');records+=struct.pack('>HHHHHH',3,1,0x409,nid,len(encoded),len(strings));strings+=encoded
    tables['name']=struct.pack('>HHH',0,len(names),6+12*len(names))+records+strings
    tables['post']=struct.pack('>IIhhIIIII',0x30000,0,-128,64,0,0,0,0,0)
    # OS/2 version0, 78bytes.
    os=bytearray(78);struct.pack_into('>HhHHH',os,0,0,512,400,5,0);struct.pack_into('>hhhhhhhhhh',os,10,650,600,0,75,650,600,0,350,50,300)
    os[32:42]=bytes([2,0,5,0,0,0,0,0,0,0]);struct.pack_into('>IIII',os,42,3,0,0,0);os[58:62]=b'UO  ';struct.pack_into('>HHHhhhHH',os,62,64,32,0x2026,1152,-384,0,1152,384);tables['OS/2']=bytes(os)
    def checksum(b):return sum(struct.unpack('>'+'I'*((len(b)+3)//4),b+b'\0'*((-len(b))%4)))&0xffffffff
    tags=sorted(tables);n=len(tags);power=1<<(n.bit_length()-1);header=struct.pack('>IHHHH',0x10000,n,power*16,power.bit_length()-1,n*16-power*16);directory=b'';body=b'';offset=12+n*16;positions={}
    for tag in tags:
        b=tables[tag];positions[tag]=offset;directory+=tag.encode()+struct.pack('>III',checksum(b),offset,len(b));pad=b'\0'*((-len(b))%4);body+=b+pad;offset+=len(b)+len(pad)
    result=bytearray(header+directory+body);struct.pack_into('>I',result,positions['head']+8,(0xb1b0afba-checksum(result))&0xffffffff)
    return bytes(result)

