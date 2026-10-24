"""Safety checks for the local-only setup wrapper, without proprietary fixtures."""
import importlib.util,json,pathlib,tempfile,unittest
spec=importlib.util.spec_from_file_location('setup_assets',pathlib.Path(__file__).with_name('setup-assets.py'))
setup=importlib.util.module_from_spec(spec);spec.loader.exec_module(setup)

class SetupTests(unittest.TestCase):
    def test_incomplete_client_fails_with_names(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError,'artLegacyMUL.uop'):setup.validate(pathlib.Path(folder))

    def test_validation_never_modifies_client(self):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder)
            names=setup.REQUIRED+[n for f in range(6)for n in (f'map{f}LegacyMUL.uop',f'statics{f}.mul',f'staidx{f}.mul')]
            for name in names:(root/name).write_bytes(b'fixture')
            before={p.name:setup.digest(p)for p in root.iterdir()}
            setup.validate(root)
            self.assertEqual(before,{p.name:setup.digest(p)for p in root.iterdir()})

    def test_recipe_contains_instructions_not_decoded_resources(self):
        recipe=json.loads((setup.ROOT/'tools/asset-recipe.json').read_text())
        self.assertEqual(len(recipe['windows']),73)
        forbidden={'tiles','images','pixels','palettes','frames','samples','glyphs'}
        def inspect(value):
            if isinstance(value,dict):
                self.assertFalse(forbidden.intersection(value))
                for child in value.values():inspect(child)
            elif isinstance(value,list):
                for child in value:inspect(child)
        inspect(recipe)

if __name__=='__main__':unittest.main()
