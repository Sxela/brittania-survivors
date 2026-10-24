"""Extract Classic Client sound-ID PCM samples; no decoding/resampling changes."""
from __future__ import annotations
import argparse,hashlib,json,pathlib,wave,sys
from classic_archive import UOP
from client_bodymap import create_hash
from classic_sound_roles import SELECTIONS
from extract_classic_effects import spell_registry
from classic_paths import DEFAULT_CLASSIC
# Explicit AOS/source cast sound IDs, ordered like the original spellbook.
# Polymorph changes actor appearance without a cast sound in the supplied server.
SPELL_SOUND_IDS=[0x1df,0x1e2,0x1e4,0x1f2,0x1e5,0x1e3,0x1e9,0x1e6,
 0x1e7,0x1eb,0x1e0,0xfc,0x1ef,0x1f0,0x1e9,0x1ee,
 0x1ea,0x15e,0x1fa,0x205,0x1f5,0x1fe,0x1ff,0x1f6,
 0x299,0x299,0x1e1,0x20c,0x202,0x29,0x1f8,0x1fc,
 0x212,0x201,0x3bd,0x1e9,0x213,0x204,0x20b,0x215,
 0x201,0x20a,0x307,0x3c4,0x1fa,0x1fb,0x20b,0x1fd,
 0x29,0x20b,0x208,0x20e,0x1f9,0x201,0x160,None,
 0x220,0x212,0x214,0x217,0x216,0x217,0x217,0x217]
def extract(client=DEFAULT_CLASSIC,out='game/assets/classic-audio'):
    from classic_compression import read_classic_entry
    client=pathlib.Path(client);out=pathlib.Path(out);out.mkdir(parents=True,exist_ok=True)
    package=UOP(client/'soundLegacyMUL.uop');entries={e[4]:e for e in package.entries}
    manifest={'formatVersion':1,'sourceClient':str(client),'sourceArchive':'soundLegacyMUL.uop','conversion':'Original PCM16 mono 22050Hz after 40-byte Classic sound-name/header. Wrapped in WAV; samples unchanged.','sounds':{}}
    selections=dict(SELECTIONS)
    for (role,spell),sid in zip(spell_registry().items(),SPELL_SOUND_IDS):
        if sid is not None:selections[role]=(sid,spell['source']+(' via Server/Effects.cs SendBoltEffect sound 0x29' if role in ['lightning','chain-lightning'] else ' original AOS cast/target sound'),'direct')
    for role,(sid,evidence,association) in selections.items():
        virtual=f'build/soundlegacymul/{sid:08d}.dat';entry=entries.get(create_hash(virtual))
        if entry is None:raise ValueError(f'Missing Classic sound {sid}')
        raw=read_classic_entry(package,entry);samples=raw[40:]
        if not samples or len(samples)%2:raise ValueError(f'Invalid PCM16 sound {sid}')
        name=raw[:16].split(b'\0')[0].decode('ascii','replace');filename=f'{sid:04x}-{role}.wav';destination=out/filename
        with wave.open(str(destination),'wb') as wav:wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(22050);wav.writeframes(samples)
        manifest['sounds'][role]={'src':'assets/classic-audio/'+filename,'id':sid,'idHex':hex(sid),'duration':len(samples)/44100,'sampleRate':22050,'channels':1,'frames':len(samples)//2,'sourceArchive':'soundLegacyMUL.uop','sourceVirtualPath':virtual,'sourceName':name,'sourceSha256':hashlib.sha256(raw).hexdigest(),'wavSha256':hashlib.sha256(destination.read_bytes()).hexdigest(),'association':association,'evidence':evidence}
    package.close();(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8');print(f'Classic sounds: {len(manifest["sounds"])}');return manifest
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--client',default=DEFAULT_CLASSIC);p.add_argument('--out',default='game/assets/classic-audio');a=p.parse_args();extract(a.client,a.out)
