import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

SPEC=importlib.util.spec_from_file_location('map_optimizer',Path(__file__).with_name('optimize-map-assets.py'))
OPT=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(OPT)

class OptimizeMapsTests(unittest.TestCase):
    def test_optimization_preserves_pixels_geometry_and_deterministic_outputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            game=Path(temporary)/'game';assets=game/'assets';(assets/'mobile-locations').mkdir(parents=True)
            images={}
            for key,size in [('grounds/test',(30,27)),('statics/a',(9,17)),('statics/b',(14,11)),('statics/wide',(1025,7))]:
                image=Image.new('RGBA',size)
                image.putdata([(i%256,(i*7)%256,(i*13)%256,0 if i%3==0 else 255)for i in range(size[0]*size[1])])
                file=assets/(key+'.png');file.parent.mkdir(parents=True,exist_ok=True);image.save(file)
                images[key]={'src':file.relative_to(game).as_posix(),'width':size[0],'height':size[1]}
            region={'areaId':'test','grounds':[{'image':'grounds/test','left':-31,'top':42,'width':30,'height':27}],
                    'statics':[{'image':'statics/a','x':1,'y':2,'z':17,'hue':45,'bounds':[8,16,0,0]}],
                    'tiles':[[1,2]],'blocked':[4],'mainPassable':[1,2],'spawn':{'x':20,'y':30}}
            source={'images':images,'regions':[region]}
            raw=json.dumps(source).encode();(assets/'mobile-locations/test.json').write_bytes(raw)
            index={'formatVersion':1,'areas':{'test':{'src':'assets/mobile-locations/test.json','name':'Test'}}}
            (assets/'mobile-locations/manifest.json').write_text(json.dumps(index))
            original={key:hashlib.sha256((game/entry['src']).read_bytes()).hexdigest()for key,entry in images.items()}
            with contextlib.redirect_stdout(io.StringIO()):OPT.optimize(game,2)
            optimized_index=assets/'optimized-locations/manifest.json';first=optimized_index.read_bytes()
            entry=json.loads(first)['areas']['test'];optimized=json.loads((game/entry['src']).read_text())
            self.assertEqual(optimized['regions'],source['regions'])
            self.assertEqual((assets/'mobile-locations/test.json').read_bytes(),raw)
            for key,entry in optimized['images'].items():
                with Image.open(game/entry['src']) as atlas:restored=atlas.convert('RGBA')
                if entry.get('atlas'):
                    x,y=entry['atlas']['x'],entry['atlas']['y'];restored=restored.crop((x,y,x+entry['width'],y+entry['height']))
                with Image.open(game/images[key]['src']) as original_image:self.assertEqual(restored.tobytes(),original_image.convert('RGBA').tobytes())
                self.assertEqual(hashlib.sha256((game/entry['src']).read_bytes()).hexdigest(),entry['sha256'])
            self.assertNotIn('atlas',optimized['images']['statics/wide'])
            with contextlib.redirect_stdout(io.StringIO()):OPT.optimize(game,2)
            self.assertEqual(optimized_index.read_bytes(),first)
            for key,entry in images.items():self.assertEqual(hashlib.sha256((game/entry['src']).read_bytes()).hexdigest(),original[key])
            self.assertIn('optimizedIndex',json.loads((assets/'mobile-locations/manifest.json').read_text()))

    def test_identical_concurrent_output_writes_are_safe(self):
        with tempfile.TemporaryDirectory() as temporary:
            file=Path(temporary)/'same.webp';data=b'content-addressed-output'
            with ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(lambda _:OPT.atomic_write(file,data),range(20)))
            self.assertEqual(file.read_bytes(),data)
            self.assertEqual(list(file.parent.glob('.building-*')),[])

    def test_resource_paths_cannot_escape_the_assets(self):
        with tempfile.TemporaryDirectory() as temporary:
            game=Path(temporary);(game/'assets').mkdir()
            for src in ['../private','assets/../private','assets/'+'C'+':/private','assets/a\\b']:
                with self.assertRaises(ValueError):OPT.resource(game,src)

if __name__=='__main__':unittest.main()
