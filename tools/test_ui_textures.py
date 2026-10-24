import pathlib,sys,unittest
from PIL import Image
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
from extract_classic_ui import seamless_interior

class TextureTests(unittest.TestCase):
    def test_native_interior_tiles_exclude_borders_and_match_at_every_join(self):
        source=Image.new('RGBA',(40,40),(0,0,0,255))
        for x in range(8,32):
            for y in range(8,32):source.putpixel((x,y),(x,y,100,255))
        tile=seamless_interior(source)
        self.assertNotIn((0,0,0,255),list(tile.getdata()))
        for y in range(tile.height):
            self.assertEqual(tile.getpixel((0,y)),tile.getpixel((tile.width-1,y)))
            self.assertEqual(tile.getpixel((tile.width//2-1,y)),tile.getpixel((tile.width//2,y)))
        for x in range(tile.width):
            self.assertEqual(tile.getpixel((x,0)),tile.getpixel((x,tile.height-1)))
            self.assertEqual(tile.getpixel((x,tile.height//2-1)),tile.getpixel((x,tile.height//2)))

if __name__=='__main__':unittest.main()
