import test from "node:test";
import assert from "node:assert/strict";
import {Game,GAME_DEFAULTS} from "../game/core.mjs";
// These mechanics tests interact with creatures on the tick they spawn.
GAME_DEFAULTS.enemyArrival=0;
import { readFileSync } from "node:fs";

test("Balron uses recovered body 40 and attacks as a late-run caster", () => {
  const data = JSON.parse(readFileSync(new URL("../game/data/catalog.json", import.meta.url), "utf8"));
  const balron = data.monsters.find(m => m.id === "balron");
  assert.equal(balron.body, 40);
  assert.deepEqual(balron.stats.hits, [592, 711]);
  assert.equal(balron.adaptation.tier, 5);
  const game = new Game({...data, monsters: [balron]}, {seed: 40});
  game.enemies = [];
  game.time = game.duration;
  const boss = game.spawnEnemy(null, true, true);
  assert.equal(boss.type, "balron");
  assert.equal(boss.ranged, true);
  boss.x = 200; boss.y = 0; boss.castClock = 0;
  game.random=()=>0;
  game.finalBossSpawned = true;
  game.update(1 / 60);
  assert.ok(game.projectiles.some(p => p.hostile));
});

const catalog = {
  monsters: [
    {
      id: "rat",
      name: "Giant Rat",
      body: 215,
      adaptation: { hp: 25, damage: 8, speed: 30, xp: 20, radius: 12, tier: 1 },
    },
  ],
  weapons: [
    {
      id: "staff",
      name: "Black Staff",
      itemId: 3568,
      stats: { damageMax: 20 },
    },
  ],
  armor: [
    {
      id: "leather",
      name: "Leather Chest",
      itemId: 5068,
      stats: { armorBase: 12 },
    },
  ],
  archetypes: [{ id: "mage", name: "Mage", weapon: "staff" }],
};

function advance(game, seconds, input = {}) {
  for (let i = 0; i < Math.round(seconds * 60); i++) game.update(1 / 60, input);
}

test("identical seeds and inputs reproduce complete simulation state", () => {
  const a = new Game(catalog, { seed: 82 }),
    b = new Game(catalog, { seed: 82 });
  for (let frame = 0; frame < 600; frame++) {
    const input = { x: Math.sin(frame / 80), y: Math.cos(frame / 80) };
    a.update(1 / 60, input);
    b.update(1 / 60, input);
    if (a.status === "levelup") {
      a.chooseUpgrade(0);
      b.chooseUpgrade(0);
    }
  }
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test("autocasting kills a creature, its experience attracts and opens upgrade choices", () => {
  const game = new Game(catalog);
  game.spawnClock = 100;
  game.enemies = [];
  const enemy = game.spawnEnemy("rat");
  enemy.x = 45;
  enemy.y = 0;
  advance(game, 2);
  assert.equal(game.kills, 1);
  assert.equal(game.player.level, 2);
  assert.equal(game.status, "levelup");
  assert.equal(game.choices.length, 3);
  assert.equal(new Set(game.choices.map((c) => c.id)).size, 3);
  const chosenSteps=1;
  assert.equal(game.chooseUpgrade(0), true);
  assert.equal(game.status, "playing");
  assert.equal(
    Object.values(game.upgrades).reduce((a, b) => a + b, 0)+game.spellLoadout.reduce((a,b)=>a+b.rank,0)+Object.keys(game.globalSpellUpgrades).length,
    chosenSteps,
  );
});

test("experience overflow awards each upgrade separately", () => {
  const game = new Game(catalog);
  game.collect({ kind: "xp", value: 150 });
  assert.equal(game.player.level, 2);
  game.checkLevel();
  assert.equal(game.player.level, 2);
  game.chooseUpgrade(0);
  assert.equal(game.player.level, 3);
  assert.equal(game.status, "levelup");
  game.chooseUpgrade(0);
  assert.equal(game.player.level, 4);
});

test("contact damage respects invulnerability, armor and death", () => {
  const game = new Game(catalog);
  game.player.armor = 3;
  game.hurtPlayer(10);
  game.hurtPlayer(10);
  assert.equal(game.player.hp, 103.35);
  game.hitClock = 0;
  game.hurtPlayer(500);
  game.update(1 / 60);
  assert.equal(game.status, "dead");
  const position = game.player.x;
  game.update(1, { x: 1 });
  assert.equal(game.player.x, position);
});

test("ranged monsters launch hostile projectiles", () => {
  const game = new Game(catalog);
  game.spawnClock = 100;
  game.attackClock = 100;
  const enemy = game.spawnEnemy({
    id: "lich",
    name: "Lich",
    adaptation: {
      hp: 500,
      ranged: true,
      speed: 20,
      damage: 8,
      radius: 15,
      xp: 10,
    },
  });
  enemy.x = 200;
  enemy.y = 0;
  enemy.castClock = 0;
  game.random=()=>0;
  game.update(1 / 60);
  assert.ok(game.projectiles.some((p) => p.hostile));
  advance(game, 1.2);
  assert.ok(game.player.hp < game.player.maxHp);
});

test("melee, nova and chain attacks deal damage without browser dependencies", () => {
  const game = new Game(catalog, { archetype: "warrior" });
  const a = game.spawnEnemy("rat"),
    b = game.spawnEnemy("rat");
  a.x = 50;
  a.y = 0;
  b.x = 55;
  b.y = 10;
  game.attack();
  assert.equal(game.kills, 2);
  game.upgrades.chain = 1;
  const c = game.spawnEnemy("rat"),
    d = game.spawnEnemy("rat");
  c.x = 160;
  c.y = 0;
  d.x = 190;
  d.y = 10;
  game.chainAttack();
  assert.ok(c.hp < c.maxHp && d.hp < d.maxHp);
  game.upgrades.nova = 1;
  game.novaClock = 0;
  c.x = 50;
  d.x = 55;
  game.update(1 / 60);
  assert.equal(game.kills, 4);
});

test("equipment and merchant purchases change effective stats and consume gold", () => {
  const game = new Game(catalog);
  const initialDamage = game.damage;
  game.collect({
    kind: "loot",
    item: game.makeItem(catalog.weapons[0], "weapon", 3),
  });
  assert.equal(game.equip(game.inventory.length - 1), true);
  assert.ok(game.damage > initialDamage);
  assert.equal(game.buy(0), false);
  game.player.gold = 200;
  const armorIndex = game.shop.findIndex((item) => item.slot === "armor");
  const price = game.shop[armorIndex].price;
  assert.equal(game.buy(armorIndex), true);
  assert.equal(game.player.gold, 200 - price);
  game.equip(game.inventory.length - 1);
  assert.ok(game.armor > 0);
  assert.equal(game.equip(999), false);
});

test("save round trip preserves pending attacks, shop, RNG and future evolution", () => {
  const original = new Game(catalog, { seed: 457 });
  advance(original, 4, { x: 0.8, y: -0.2 });
  const restored = Game.restore(
    catalog,
    JSON.parse(JSON.stringify(original.snapshot())),
  );
  assert.deepEqual(restored.snapshot(), original.snapshot());
  advance(original, 3, { x: -1 });
  advance(restored, 3, { x: -1 });
  assert.deepEqual(restored.snapshot(), original.snapshot());
  assert.throws(() => Game.restore(catalog, { version: 9 }));
});

test("pause freezes state and final champion must die before victory", () => {
  const game = new Game(catalog, { duration: 10 });
  game.pause();
  const frozen = game.snapshot();
  game.update(1, { x: 1 });
  assert.deepEqual(game.snapshot(), frozen);
  game.pause();
  game.time = 9.99;
  game.update(0.02);
  assert.equal(game.finalBossSpawned, true);
  assert.equal(game.status, "playing");
  const boss = game.enemies.find((e) => e.final);
  assert.ok(boss);
  game.hurtEnemy(boss, boss.hp + 1);
  game.update(1 / 60);
  assert.equal(game.status, "victory");
});

test("movement normalization prevents diagonal speed advantage", () => {
  const game = new Game(catalog);
  game.spawnClock = 100;
  game.update(1, { x: 1, y: 1 });
  assert.ok(
    Math.abs(Math.hypot(game.player.x, game.player.y) - game.player.speed) <
      0.0001,
  );
});

test("dash follows movement facing, protects briefly and requires cooldown", () => {
  const game = new Game(catalog);
  game.spawnClock = 100;
  game.enemies = [];
  game.update(1 / 60, { x: 0, y: -1 });
  assert.equal(game.player.dx, 0);
  assert.equal(game.player.dy, -1);
  const startY = game.player.y;
  assert.equal(game.dash(), true);
  assert.equal(game.dash(), false);
  game.hurtPlayer(50);
  assert.equal(game.player.hp, game.player.maxHp);
  advance(game, 0.2);
  assert.ok(startY - game.player.y > 140);
  advance(game, 0.2);
  game.hurtPlayer(10);
  assert.equal(game.player.hp, game.player.maxHp - 9.5);
  advance(game, 2.7);
  assert.equal(game.dash(), true);
  const saved = game.snapshot();
  assert.deepEqual(Game.restore(catalog, saved).snapshot(), saved);
});

test("spawns remain outside portrait and ultrawide viewports and enter promptly", () => {
  for (const [width, height] of [
    [360, 900],
    [2560, 1080],
  ]) {
    const game = new Game(catalog);
    game.setViewport(width, height);
    for (let i = 0; i < 80; i++) {
      const enemy = game.spawnEnemy("rat");
      const outsideX = Math.abs(enemy.x) - enemy.radius > width / 2;
      const outsideY = Math.abs(enemy.y) - enemy.radius > height / 2;
      assert.ok(outsideX || outsideY);
      // The nearest edge starts just 20 units beyond the creature's extent.
      const edgeDistance = Math.max(
        Math.abs(enemy.x) - width / 2,
        Math.abs(enemy.y) - height / 2,
      );
      assert.ok(Math.abs(edgeDistance - enemy.radius - 20) < 0.001);
    }
    game.enemies = [];
    advance(game, 0.75);
    assert.ok(game.enemies.length > 0);
  }
});

test("distant creature recycling cannot appear inside the visible camera", () => {
  const game = new Game(catalog);
  game.setViewport(2560, 1080);
  game.spawnClock = 100;
  const enemy = game.spawnEnemy("rat");
  enemy.x = 3000;
  enemy.y = 0;
  game.update(1 / 60);
  assert.ok(
    Math.abs(enemy.x) - enemy.radius > 1280 ||
      Math.abs(enemy.y) - enemy.radius > 540,
  );
  assert.ok(Math.abs(enemy.x) < 3000);
  enemy.x = 1000;
  enemy.y = 0;
  game.update(1 / 60);
  assert.ok(
    Math.abs(enemy.x - 1000) < 1,
    "visible creatures must keep moving without recycling",
  );
});

test("selling yields gold once and prevents selling equipped gear", () => {
  const game = new Game(catalog);
  assert.equal(game.sell(0), false);
  const item = game.makeItem(catalog.armor[0], "armor", 2);
  game.inventory.push(item);
  assert.equal(game.sell(1), true);
  assert.equal(game.player.gold, Math.floor(item.price / 2));
  assert.equal(game.sell(1), false);
  assert.equal(game.inventory.length, 1);
});

test("malformed saves reject invalid numbers, entities, equipment and huge arrays", () => {
  const game = new Game(catalog);
  const mutations = [
    (state) => {
      state.player.hp = NaN;
    },
    (state) => {
      state.player.speed = -30;
    },
    (state) => {
      state.player.maxHp = 0;
    },
    (state) => {
      state.player.x = Infinity;
    },
    (state) => {
      state.rng = 1.5;
    },
    (state) => {
      state.enemies = [{}];
    },
    (state) => {
      state.projectiles = [
        { x: 0, y: 0, radius: 1, vx: 0, vy: 0, life: 1, damage: 10 },
      ];
    },
    (state) => {
      state.inventory = null;
    },
    (state) => {
      state.equipment.weapon = 999;
    },
    (state) => {
      state.status = "levelup";
    },
    (state) => {
      state.enemies = new Array(1001).fill({});
    },
    (state) => {
      state.dashDirection = { x: "bad", y: 0 };
    },
    (state) => {
      state.upgrades = { bogus: 1 };
    },
  ];
  for (const mutate of mutations) {
    const state = game.snapshot();
    mutate(state);
    assert.throws(() => Game.restore(catalog, state), /invalid survivor save/);
  }
  const state = game.snapshot();
  state.update = "malicious method override";
  assert.equal(typeof Game.restore(catalog, state).update, "function");
});

test("opening creatures exist immediately nearby and targeting waits for combat range", () => {
  const game = new Game(catalog);
  assert.equal(game.enemies.length, 3);
  for (const enemy of game.enemies) {
    const range = Math.hypot(enemy.x, enemy.y);
    assert.ok(range >= 220 && range <= 320);
  }
  game.enemies = [];
  const enemy = game.spawnEnemy("rat");
  enemy.x = 600;
  enemy.y = 0;
  game.attack();
  assert.equal(game.projectiles.length, 0);
  enemy.x = 490;
  game.attack();
  assert.equal(game.projectiles.length, 1);
});
