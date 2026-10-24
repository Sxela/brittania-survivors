const { spawn } = require("node:child_process");
const path = require("node:path");
let electron;
try {
  electron = require("electron");
} catch {
  console.error(
    "Install the desktop runtime with npm install, or use Start-Survivors.cmd.",
  );
  process.exit(1);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const entry = process.argv.includes("--smoke")
  ? "../tests/browser-smoke.cjs"
  : "../desktop/main.cjs";
const child = spawn(electron, [path.resolve(__dirname, entry)], {
  stdio: "inherit",
  env,
  windowsHide: true,
});
child.on("error", (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
child.on("exit", (code) => (process.exitCode = code || 0));
