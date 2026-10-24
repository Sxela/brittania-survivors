import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Game } from "../game/core.mjs";

const monster = (id, adaptation = {}, visuals = {}) => ({
  id,
  name: id,
  body: 1,
  adaptation: {
    tier: 0,
    hp: 24,
    speed: 40,
    damage: 7,
    xp: 4,
    radius: 13,
    ...adaptation,
  },
  ...visuals,
});

test("server body and hue variants are reachable, seeded and preserve class identity", () => {
  const source = monster(
    "colored_rat",
    {},
    { bodyIds: [1, 2], hueIds: [0, 1153, 0x8001] },
  );
  const catalog = { monsters: [source] };
  const a = new Game(catalog, { seed: 82 });
  const b = new Game(catalog, { seed: 82 });
  const seen = new Set();
  for (let i = 0; i < 150; i++) {
    const first = a.spawnEnemy(source.id);
    assert.deepEqual(first, b.spawnEnemy(source.id));
    assert.equal(first.type, source.id);
    assert.equal(first.partialHue, !!(first.hue & 0x8000));
    seen.add(`${first.body}:${first.hue}`);
  }
  assert.equal(seen.size, 6);
  const restored = Game.restore(catalog, a.snapshot());
  for (let i = 0; i < 20; i++)
    assert.deepEqual(a.spawnEnemy(), restored.spawnEnemy());
  assert.deepEqual(a.snapshot(), restored.snapshot());
});

test("paired body and hue choices retain server constructor relationships", () => {
  const source = monster(
    "paired",
    {},
    {
      bodyIds: [1, 2],
      hueIds: [10, 20],
      visualVariants: [
        { body: 1, hue: 10, weight: 1 },
        { body: 2, hue: 20, weight: 3 },
      ],
    },
  );
  const game = new Game({ monsters: [source] }, { seed: 7 });
  const seen = new Set();
  for (let i = 0; i < 100; i++) {
    const enemy = game.spawnEnemy();
    seen.add(`${enemy.body}:${enemy.hue}`);
  }
  assert.deepEqual(seen, new Set(["1:10", "2:20"]));
});

test("explicit combat metadata is honored without inventing capabilities from names", () => {
  const catalog = {
    monsters: [
      monster("Dragon", { ranged: false }),
      monster("Lich", {}, { ranged: false }),
      monster("Archer", { ranged: true }),
      monster("Daemon"),
    ],
  };
  const game = new Game(catalog);
  assert.equal(game.spawnEnemy("Dragon").ranged, false);
  assert.equal(game.spawnEnemy("Lich").ranged, false);
  assert.equal(game.spawnEnemy("Archer").ranged, true);
  assert.equal(game.spawnEnemy("Daemon").ranged, false);
});

test("champions stay outside normal waves while every eligible encounter remains reachable", () => {
  const catalog = {
    monsters: [
      monster("rat"),
      monster("named_early", { tier: 1, bossOnly: true }),
      monster("named_late", { tier: 5, bossOnly: true }),
    ],
  };
  const game = new Game(catalog, { seed: 13 });
  assert.ok(game.enemies.every((enemy) => enemy.type === "rat"));
  game.time = game.duration;
  const bosses = new Set();
  for (let i = 0; i < 100; i++) {
    assert.equal(game.spawnEnemy().type, "rat");
    bosses.add(game.spawnEnemy(null, true).type);
  }
  assert.deepEqual(bosses, new Set(["named_early", "named_late"]));
  // Sparse catalogs must still produce a champion before their first tier unlock.
  const sparse = new Game({
    monsters: [monster("late", { tier: 5, bossOnly: true })],
  });
  assert.ok(sparse.enemies.every((enemy) => enemy.type !== "late"));
  assert.equal(sparse.spawnEnemy(null, true).type, "late");
  assert.equal(sparse.spawnEnemy("late").type, "late");
});

test("old saves default to uncolored creatures and reject malformed hue flags", () => {
  const catalog = { monsters: [monster("rat")] };
  const game = new Game(catalog);
  const oldSave = game.snapshot();
  for (const enemy of oldSave.enemies) {
    delete enemy.hue;
    delete enemy.partialHue;
  }
  const restored = Game.restore(catalog, oldSave);
  assert.ok(
    restored.enemies.every(
      (enemy) => enemy.hue === 0 && enemy.partialHue === false,
    ),
  );
  for (const hue of [-1, 0x10000, 1.1, "1153", null]) {
    const save = game.snapshot();
    save.enemies[0].hue = hue;
    assert.throws(() => Game.restore(catalog, save), /invalid survivor save/);
  }
  const save = game.snapshot();
  save.enemies[0].partialHue = "true";
  assert.throws(() => Game.restore(catalog, save), /invalid survivor save/);
});

test("every catalog monster can spawn under its own class and survive a save round trip", () => {
  const catalog = JSON.parse(
    readFileSync(new URL("../game/data/catalog.json", import.meta.url), "utf8"),
  );
  assert.equal(
    new Set(catalog.monsters.map((source) => source.id)).size,
    catalog.monsters.length,
  );
  const game = new Game(catalog, { seed: 193 });
  game.enemies = [];
  for (const source of catalog.monsters) {
    assert.ok(
      Number.isInteger(source.adaptation.tier) &&
        source.adaptation.tier >= 0 &&
        source.adaptation.tier <= 5,
      source.id,
    );
    const enemy = game.spawnEnemy(source.id);
    assert.equal(enemy.type, source.id);
    assert.ok(
      Number.isInteger(enemy.body) && enemy.body >= 0 && enemy.body <= 0xffff,
      `${source.id}: body`,
    );
    assert.ok(
      Number.isInteger(enemy.hue) && enemy.hue >= 0 && enemy.hue <= 0xffff,
      `${source.id}: hue`,
    );
    if (typeof source.adaptation.ranged === "boolean")
      assert.equal(enemy.ranged, source.adaptation.ranged, source.id);
  }
  assert.deepEqual(
    Game.restore(catalog, game.snapshot()).snapshot(),
    game.snapshot(),
  );
});

test("Paragons retain server hue and creature identity with survival stat adaptation", () => {
  const catalog = {
    monsters: [
      monster("rat", { paragonEligible: true }, { hue: 0x8001 }),
      monster("excluded", { paragonEligible: false }),
      monster("named", { paragonEligible: true, bossOnly: true }),
    ],
    enemyModifiers: [
      {
        id: "paragon",
        name: "Paragon",
        hue: 0x501,
        adaptation: {
          startsAt: 120,
          chance: 0.03,
          hpMultiplier: 2,
          damageMultiplier: 1.3,
          speedMultiplier: 1.1,
          xpMultiplier: 2,
        },
      },
    ],
  };
  const game = new Game(catalog, { seed: 7 });
  const normal = game.spawnEnemy("rat", false, false, { modifier: null });
  const paragon = game.spawnEnemy("rat", false, false, { modifier: "paragon" });
  assert.equal(paragon.type, normal.type);
  assert.equal(paragon.body, normal.body);
  assert.equal(paragon.name, "rat (Paragon)");
  assert.equal(paragon.hue, 0x501);
  assert.equal(paragon.partialHue, false);
  assert.equal(paragon.baseHue, 0x8001);
  assert.equal(paragon.basePartialHue, true);
  assert.equal(paragon.hp, normal.hp * 2);
  assert.equal(paragon.damage, normal.damage * 1.3);
  assert.equal(paragon.xp, normal.xp * 2);
  for (const [type, boss, final] of [
    ["excluded", false, false],
    ["named", false, false],
    ["rat", true, false],
    ["rat", true, true],
  ]) {
    assert.equal(
      game.spawnEnemy(type, boss, final, { modifier: "paragon" }).modifier,
      undefined,
    );
  }
  assert.equal(
    game.spawnEnemy("rat").modifier,
    undefined,
    "automatic conversion unlocks at 120 seconds",
  );
  game.time = 121;
  const restored = Game.restore(catalog, game.snapshot());
  let converted = 0;
  for (let i = 0; i < 300; i++) {
    const next = game.spawnEnemy("rat");
    assert.deepEqual(next, restored.spawnEnemy("rat"));
    if (next.modifier === "paragon") converted++;
  }
  assert.ok(
    converted > 0 && converted < 30,
    "seeded rare conversion is reachable",
  );
  assert.deepEqual(game.snapshot(), restored.snapshot());
});
