const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.setName("Britannia Survivors");
const smoke = process.argv.includes("--smoke");
if (smoke)
  app.setPath("userData", path.resolve(process.cwd(), ".cache/packaged-smoke"));
let server;
if (!app.requestSingleInstanceLock()) app.quit();
app.whenReady().then(async () => {
  // A stable origin keeps localStorage saves available between launches.
  process.env.PORT = smoke ? (process.env.BRITANNIA_SMOKE_PORT || "18788") : "8788";
  ({ server } = await import("../tools/serve.mjs"));
  if (!server.listening)
    await new Promise((resolve) => server.once("listening", resolve));
  const win = new BrowserWindow({
    show: !smoke,
    width: 1440,
    height: 960,
    minWidth: 700,
    minHeight: 650,
    backgroundColor: "#0c1410",
    title: "Britannia Survivors",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: smoke,
      backgroundThrottling: !smoke,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== `http://127.0.0.1:${server.address().port}`)
      event.preventDefault();
  });
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);
});
app.on("window-all-closed", () => {
  server?.close();
  app.quit();
});
