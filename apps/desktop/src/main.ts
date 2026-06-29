import { app, BrowserWindow, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
let serverProcess: ChildProcess | null = null;

function converterDir() {
  if (process.env.LITAGENT_CONVERTER_DIR) return process.env.LITAGENT_CONVERTER_DIR;
  return app.isPackaged
    ? path.join(process.resourcesPath, "converters")
    : path.join(repoRoot, "resources", "converters");
}

function startBackend() {
  if (process.env.LITAGENT_SERVER_EXTERNAL === "1") return;
  serverProcess = spawn("bun", ["run", "--filter", "@litagent/server", "start"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      LITAGENT_CONVERTER_DIR: converterDir()
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1040,
    minHeight: 720,
    title: "LitAgent",
    backgroundColor: "#f7f8fa",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const url = process.env.LITAGENT_WEB_URL ?? "http://localhost:5173";
  setTimeout(() => void win.loadURL(url), 900);
}

app.whenReady().then(() => {
  startBackend();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  serverProcess?.kill("SIGTERM");
});
