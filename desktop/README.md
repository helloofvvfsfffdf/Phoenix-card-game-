# PHOENIX Online — Windows desktop build

A private Electron shell around the live game at
`https://phoenix-card-game-1.onrender.com`. The website is not modified:
the window loads the same page, styles, scripts and backend a browser
does, so sign-in, player data, cards, animations and multiplayer all
behave exactly as on the public site.

**Private development build. Never publish, upload or distribute this
build** (no Game Jolt, itch.io, or any public channel).

## What the shell adds

| Behaviour | How it works |
| --- | --- |
| Standalone window (no browser UI) | Hardened `BrowserWindow`: no Node access for page code, context isolation, sandbox |
| Fictional sites (FOOGLE, Definitely Not Amazon, PhoenixTube) open in **app windows** | Same-origin `window.open` targets become real Electron child windows — separate webContents |
| Main game keeps running & connected while those windows are open | The child is its own window; the main window's WebSocket is untouched |
| Closing a fictional site never closes the game | Closing a child window has no effect on the main window |
| External links (e.g. Foogle's Google fallback) handled securely | Never rendered inside the app; plain http/https opens in the **system browser**, other schemes dropped |
| Only trusted game content in app windows | Window opens and navigation are allowed only for `phoenix-card-game-1.onrender.com` |
| Sign-in and player data persist between runs | Electron's persistent session stores the same httpOnly cookies a browser would |
| Window size/position remembered | `window-state.json` in the app's user-data folder |

The icon is Phoenix, cropped from the main-menu photo
(`assets/phoenix.jpg`).

## Requirements

- Node.js 20+ and npm
- Windows 10/11 to build the `.exe` (this project builds Windows targets)

## Develop (run unpacked)

```powershell
cd desktop
npm install
npm start
```

## Smoke test

Loads the live game in the app, opens a fictional site in a child
window, closes it, verifies the main game survived, then exits 0/1:

```powershell
npm run smoke
```

(On its first run Render may be asleep — the test allows up to 3 minutes
for the cold start.)

## Build the installers

```powershell
npm run dist
```

Output lands in `desktop/dist/` (git-ignored, never committed):

- `PHOENIX-Online-Portable-1.0.0.exe` — single-file portable build,
  runs without installing
- `PHOENIX-Online-Setup-1.0.0.exe` — NSIS installer (per-user, chooses
  Start Menu/Desktop shortcuts)

Both are **unsigned**, so Windows SmartScreen will show
"Windows protected your PC" on first run: click **More info → Run
anywhere/Run anyway**. That warning appears for any unpublished app and
is expected for a private build.

## Install / use (owner's own machines)

1. Copy either `.exe` to the machine (USB, network share, ...).
2. Portable: just double-click it. Installer: run it and follow the
   prompts (it installs per-user, no admin rights needed).
3. Sign in with your PHOENIX account as usual — the session persists
   between launches.
4. To update, rebuild on the dev machine and replace the file — there is
   no auto-update by design.

## Notes

- The shell connects to the production Render service; the backend,
  accounts and Supabase are shared with the website exactly as before.
- No auto-update, no telemetry, no additional network endpoints.
- `desktop/node_modules/` and `desktop/dist/` are git-ignored; the
  root `package.json` that Render installs is untouched by this project.
