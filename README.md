# Britannia Survivors

**Unofficial fan project.** Britannia Survivors is a fan-made tribute to Ultima Online, originally created by Origin Systems. All rights to Ultima Online, its trademarks, and its original artwork, audio, fonts, maps and other game assets remain with Electronic Arts Inc. and their respective rights holders. This project is not affiliated with, endorsed by, or sponsored by Electronic Arts Inc. or Broadsword Online Games. No ownership of those original materials is claimed, and this notice grants no license to them. See the [official Ultima Online terms](https://uo.com/faq/).

A survivor game built with JavaScript and HTML5 Canvas, with a Windows desktop wrapper and a phone-browser layout.

For adapting another game, see the [reusable mechanics and playtesting guide](docs/game-to-survivors-mechanics.md) and the [Britannia reference profile](docs/britannia-survivors-reference.md).

Companions: [playtesting and balance workflow](docs/playtesting-and-balance-log.md), [native UI workflow](docs/nostalgic-ui-workflow.md), and [promo video workflow](docs/promo-video-workflow.md).

Choose Warrior, Magician, or Ranger. Clear local enemy waves and a boss, gather loot, enter the moongate when ready, buy upgrades, and continue to the next area. Routes increase in difficulty across 20 areas on Easy, 35 on Normal, or all 73 on Hard.

## Install and play

**Client download: [Official Ultima Online download page](https://uo.com/client-download/). Choose Classic Client.**

This repository and its Windows/Linux releases contain **no original game assets**.
Download and fully patch the Classic Client using the [official UO download page](https://uo.com/client-download/), then extract resources locally:

```sh
npm ci
python -m pip install -r requirements-assets.txt
npm run assets:setup -- --client "PATH_TO_YOUR_CLASSIC_CLIENT"
npm start
```

Use Node.js 24 and Python 3.11 or newer. See [complete setup instructions](docs/asset-setup.md) for Linux, validation, rebuilds, input/output hashes and troubleshooting. Extraction reads your installation without modifying it. It needs no private repository, server checkout or Enhanced client. Generated resources stay ignored under `game/assets/`; Git LFS is not used.

After setup use `npm run desktop` for a desktop window, or `npm run mobile` for phones on the same Wi-Fi. Mobile uses portrait UI, 150% default world zoom, tap-to-move and hold-to-steer.

Startup and area transitions show asset-loading progress, including downloaded
area data and completed artwork files. Failed startup loads show a Retry button.
Assets loaded during play, in inventories or shops, and on first use of audio,
spells or creatures show a compact progress bar while controls remain usable.

## Controls

Click to move; hold the right mouse button to steer; WASD or arrow keys also move. Space jumps through intervening walls onto clear ground. I opens the backpack, B opens the trader, and Escape pauses. Attacks cast automatically. Drag equipment onto the paperdoll; select an item for actions and comparisons. Touch controls include Dash, Bag and Shop buttons.

## Tests

```sh
npm run test:ci
```

The included tests cover portable gameplay and UI logic. Source-only CI skips checks whose local assets or server evidence are unavailable.

The export manifest lists relative filenames, sizes and SHA-256 hashes. Export tooling, private history, machine paths and credentials are excluded.

Spell progression uses independent damage/potency, area, cast-speed and lasting-effect duration improvements. Chain Lightning gains chained targets instead of area. Luck improves card rarity and bonus size. Each five improvements to a spell grant a separate, free two-choice Super Upgrade with behavior changes and tradeoffs. Spell ranks are no longer purchased. Desktop and phone load area data one location at a time.

## Windows and Linux builds

GitHub Actions runs source-only tests on Windows and Ubuntu. **Actions > Release binaries > Run workflow** builds the desktop shell without artwork, fonts, sounds, map data or other original resources, even if assets exist in the build workspace. Packaging audits the resulting payload before publishing.

Generate assets locally using the source checkout above. Set `BRITANNIA_ASSETS_DIR` to its `game/assets` folder before launching a desktop download. Missing resources open a setup page. Download formats are Windows ZIP and Linux AppImage/tar.gz, with SHA-256 checksums. Local `npm run desktop:dist -- --win` or `--linux` produces the same resource-free builds; each platform must build on its matching operating system.

Do not commit generated resources or attach them to releases. Existing Git history, LFS storage and old releases are not cleaned by updating the exporter.
