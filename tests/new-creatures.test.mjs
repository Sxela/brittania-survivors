import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {Game,GAME_DEFAULTS} from "../game/core.mjs";
// These mechanics tests interact with creatures on the tick they spawn.
GAME_DEFAULTS.enemyArrival=0;

const catalog = JSON.parse(
  readFileSync(new URL("../game/data/catalog.json", import.meta.url), "utf8"),
);

test("requested creatures retain RunUO body identities and hit ranges", () => {
  const expected = [
    ["giant-spider", [28], [46, 60]],
    ["bone-knight", [57], [118, 150]],
    ["lich-lord", [79], [250, 303]],
    ["dragon", [12, 59], [478, 495]],
    ["wisp", [58], [118, 135]],
    ["wyvern", [62], [125, 141]],
  ];
  for (const [id, bodies, hits] of expected) {
    const creature = catalog.monsters.find((monster) => monster.id === id);
    assert.ok(creature, `${id} is available in the source catalog`);
    assert.deepEqual(creature.bodyIds, bodies, id);
    assert.equal(creature.body, bodies[0], id);
    assert.deepEqual(creature.stats.hits, hits, id);
  }
});

test("Wisp fires hostile magic while Wyvern closes for contact attacks", () => {
  for (const [id, ranged] of [
    ["wisp", true],
    ["wyvern", false],
  ]) {
    const creature = catalog.monsters.find((monster) => monster.id === id);
    assert.equal(creature.adaptation.tier, 3);
    const game = new Game(catalog, { seed: 58 });
    game.enemies = [];
    game.spawnClock = 100;
    game.attackClock = 100;
    const enemy = game.spawnEnemy(id);
    enemy.x = 200;
    enemy.y = 0;
    enemy.castClock = 0;
    game.random=()=>0;
    assert.equal(enemy.ranged, ranged, id);
    game.update(1 / 60);
    assert.equal(
      game.projectiles.some((projectile) => projectile.hostile),
      ranged,
      id,
    );
    if (!ranged) assert.ok(enemy.x < 200, "Wyvern pursues the player");
  }
  const wyvern = catalog.monsters.find((monster) => monster.id === "wyvern");
  assert.deepEqual(wyvern.skills.Poisoning, [60.1, 80]);
  assert.deepEqual(wyvern.resistances.poison, [90, 100]);
});
