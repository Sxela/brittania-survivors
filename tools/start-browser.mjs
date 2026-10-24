import { spawn } from "node:child_process";
import { server } from "./serve.mjs";
function open() {
  const url = "http://127.0.0.1:8787";
  if (process.platform === "win32")
    spawn("cmd.exe", ["/c", "start", "", url], {
      windowsHide: true,
      stdio: "ignore",
    });
  else console.log(`Open ${url} in your browser.`);
}
server.once("listening", open);
server.once("error", (error) => {
  if (error.code === "EADDRINUSE") open();
  else {
    console.error(error);
    process.exitCode = 1;
  }
});
