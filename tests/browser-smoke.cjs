// Run with an Electron executable: electron tests/browser-smoke.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const out = path.resolve(__dirname, "../.cache/screenshots");
app.setPath("userData", path.resolve(__dirname, "../.cache/electron-smoke"));
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const errors = [];
  const win = new BrowserWindow({
    width: 1440,
    height: 1000,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      offscreen: true,
    },
  });
  win.webContents.on("console-message", (details) => {
    if (details.level === "error") errors.push(details.message);
  });
  win.webContents.on("render-process-gone", (_event, details) =>
    errors.push(JSON.stringify(details)),
  );
  try {
    await win.loadURL("http://127.0.0.1:8787");
    await new Promise((r) => setTimeout(r, 1800));
    fs.writeFileSync(
      path.join(out, "menu.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await win.webContents.executeJavaScript("window.britannia.start()");
    await new Promise((r) => setTimeout(r, 4000));
    const state = await win.webContents.executeJavaScript(
      `(()=>{const g=window.britannia.game;return {status:g.status,time:g.time,enemies:g.enemies.length,images:Object.keys(window.britannia.manifest.images).length,animations:Object.keys(window.britannia.manifest.animations).length}})()`,
    );
    if (state.status !== "playing" || state.time < 2)
      throw Error("Game did not advance: " + JSON.stringify(state));
    fs.writeFileSync(
      path.join(out, "game.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await win.webContents.executeJavaScript("window.britannia.inventory()");
    if (
      !(await win.webContents.executeJavaScript(
        'document.querySelector("#dialog").textContent.includes("Equipment")',
      ))
    )
      throw Error("Backpack not rendered");
    fs.writeFileSync(
      path.join(out, "inventory.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    if (errors.length) throw Error(errors.join("\n"));
    const report = { ok: true, state, errors };
    fs.writeFileSync(
      path.join(out, "smoke.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    app.exit(0);
  } catch (e) {
    fs.writeFileSync(
      path.join(out, "smoke.json"),
      JSON.stringify({ ok: false, error: e.stack, errors }, null, 2),
    );
    console.error(e);
    app.exit(1);
  }
});
