# Set up local game resources

The public repository and its releases contain no original game artwork, sound,
fonts, map tiles, animation frames, or client archives. Extraction code and curated
identifiers, area bounds, server-derived gameplay data and placement configuration
are included. These instructions do not grant rights to redistribute client data.

## Install the client

**[Download the official Ultima Online Classic Client](https://uo.com/client-download/)** — select Classic Client on the official page.

Download the **Classic Client** from the [official Ultima Online download page](https://uo.com/client-download/).
Install it using the official installer and let its patcher finish. Close the
client and patcher before extraction. This pipeline supports the modern Classic
UOP/MUL layout, including all six facets; an old Renaissance-only MUL installation
or the Enhanced Client is not supported. On Linux, install/patch using Wine or
copy your own complete patched Classic installation from another machine.

## One-time setup

Install Node.js 24 and Python 3.11 or newer. From the repository root:

```sh
npm ci
python -m pip install -r requirements-assets.txt
npm run assets:setup -- --client "PATH_TO_YOUR_CLASSIC_CLIENT"
npm start
```

Replace the placeholder with the installation directory, not its executable.
On systems where Python is called `python3`, run `python3 tools/setup-assets.py
--client "PATH_TO_YOUR_CLASSIC_CLIENT"` instead of the npm extraction command.
The path can alternatively be supplied through `UO_CLIENT_PATH`.

Use `--check` to validate the installation and dependency version before a long
build. No server checkout, private research, Enhanced installation, downloaded
asset bundle, Git LFS account, or external service is required. The script reads
the installation without modifying it. It creates animations, native UI/fonts,
audio, equipment, map crops and one-location-at-a-time manifests under
`game/assets/`, which Git ignores. Allow several GB of free space and additional
temporary space during extraction. Map processing can take several minutes.

After setup, `npm run desktop` opens the desktop wrapper. `npm run mobile` serves
the phone version over your local network. The source checkout is the supported
setup environment; resource-free desktop downloads require a locally generated
asset directory through `BRITANNIA_ASSETS_DIR`.

## Repeatability and failures

Pillow is pinned. Area selection, bounds, fallback art and extraction order are
fixed; no random selection or online content generation occurs. Generated
`setup-report.json` records the recipe hash, SHA-256 hashes of input files and
output resources. Compare output hashes between runs using the same exact client
revision and tool versions. Patching the client can change art, topology and
hashes; different client versions are not claimed to produce identical results.

Extraction uses a fresh staging directory. A failure preserves existing resources.
To regenerate, add `--rebuild`; the previous successful resources are kept in
`game/assets.previous/`. Move that backup elsewhere before another rebuild.
Incomplete client installations fail with a list of missing files. The one body
absent in the supported Classic data (Corporeal Brume) uses Classic spectre art;
no Enhanced art is required. The menu background is generated locally from an
extracted map instead of shipping a bitmap.

Keep generated assets, client files, screenshots and recordings out of public
commits and releases. This setup does not erase assets already published in Git
history, Git LFS, release attachments, or hosting caches; those require separate
cleanup if a repository previously distributed them.
