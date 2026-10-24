# Map asset optimization

After extracting the original game assets, install the image dependency and build the optimized maps:

```sh
python -m pip install -r requirements-assets.txt
python tools/optimize-map-assets.py --workers 4
```

`node tools/build-mobile.mjs` also runs this optimizer. Set `BRITANNIA_ASSET_PYTHON` if Python has a different executable path.

The optimizer preserves the original PNGs and area manifests. It generates lossless WebP ground images, scenery atlas pages up to 1024 × 1024 pixels, and a separate index under `game/assets/optimized-locations/`. It verifies decoded pixels before publishing the index pointer. Collision, elevation, scenery positions, spawns and map dimensions stay unchanged. Atlases use two pixels of extruded padding without scaling or rotating sprites.

The game uses the optimized index when present and supports original assets when absent. It loads visible ground first, then nearby ground within a decoded bitmap budget of 160 MiB on desktop or 96 MiB on mobile. Scenery pages remain resident for the current area. Old ground bitmaps close as the camera moves; changing areas disposes the old store. Tinted scenery has a separate 32 MiB cache. Visible ground takes priority over the budget, and decoding can briefly exceed it. These limits do not measure total browser or GPU memory.

While visible ground is downloading, the shared loading indicator reports progress and simulation waits. Failed ground downloads retry. Persistent browser caching continues to apply to the WebP assets.

Verify with:

```sh
node --test tests/map-asset-store.test.mjs
python -m unittest discover -s tools -p test_optimize_map_assets.py
```

With extracted assets and Electron installed, `electron tests/map-streaming.browser.cjs` checks desktop and phone rendering against the original PNGs, camera streaming, budget eviction and stationary request counts. Its screenshots and measurements are saved under `.cache/map-streaming/`.

The October 2026 local build reduced ground files from 2.75 GB to 474 MB across 73 maps. The deployment asset graph fell from 3.19 GB to 0.93 GB. Haven and Bet-Lem Reg rendered with zero pixel differences on desktop and phone. These are local measurements, not production download timings.

Deployment needs the new optimized asset files as well as the runtime. Resuming an old uploaded archive does not add them. Publishing and deployment are separate, explicitly requested actions.

Native collision metadata also records `physicalPassable`: clear standing floors, including rooms disconnected from the initial spawn. Space teleport checks only its destination footprint, so walls along the path do not block it. Water, void, solid walls and destinations outside the exported map remain invalid. Walking still checks every intervening tile and height transition.

Enemy spawning and newly placed exit gates use the player's current connected walking area after teleporting, so entering a closed room does not leave all future encounters outside it. Normal extraction generates this metadata. Older asset banks without `physicalPassable` keep their original connected bounds until rebuilt. The current local bank has been updated across all 73 areas without regenerating artwork.
