'use strict';

/**
 * PHOENIX Online - Windows desktop shell (PRIVATE DEVELOPMENT BUILD).
 *
 * A thin Electron window around the live game. The website itself is
 * untouched by this project: the page, its styles, its scripts and the
 * Render/Supabase backend are exactly what a browser loads, so account
 * sign-in, player data and multiplayer all behave identically here.
 *
 * This process decides only WHERE page content may appear:
 *
 *   - The main window loads GAME_ORIGIN and keeps its own WebSocket for
 *     the whole lifetime of the app.
 *   - The game's fictional sites (FOOGLE, Definitely Not Amazon,
 *     PhoenixTube, ...) are same-origin pages the game opens with
 *     window.open()/target=_blank. They become real Electron child
 *     windows - separate webContents - so the main game keeps running
 *     and connected while they are open, and closing one can never close
 *     the game or drop the player's connection.
 *   - Anything from ANOTHER origin is untrusted: it is never rendered
 *     inside the app. Plain http/https links are handed to the system
 *     browser instead; every other scheme (javascript:, file:, ...) is
 *     dropped outright.
 *
 * Never published: no update feed, no auto-update, no telemetry. The
 * build output is for the owner's own devices only.
 */

const { app, BrowserWindow, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');

/** The one origin this app is allowed to show. */
const GAME_ORIGIN = 'https://phoenix-card-game-1.onrender.com';

/** Set by `npm run smoke`: load, prove child windows work, then exit. */
const SMOKE = process.argv.includes('--smoke');

/**
 * Permissions the game may ask for, and ONLY while it is the page asking.
 * The game copies room codes and diagnostics to the clipboard and uses
 * fullscreen for video; everything else (camera, microphone, notifications,
 * geolocation, ...) is refused even for the game, because it never needs
 * them.
 */
const TRUSTED_PERMISSIONS = new Set([
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'pointerLock'
]);

/* ------------------------------------------------------------------ */
/* URL policy                                                          */
/* ------------------------------------------------------------------ */

function parseUrl(href, base) {
  try {
    return new URL(href, base);
  } catch (e) {
    return null;
  }
}

function isGameUrl(href) {
  const url = parseUrl(href);
  return !!url && url.origin === GAME_ORIGIN;
}

/** Something the system browser may safely open: plain web only. */
function isWebUrl(href) {
  const url = parseUrl(href);
  return !!url && (url.protocol === 'https:' || url.protocol === 'http:');
}

/* ------------------------------------------------------------------ */
/* Window state (size/position) persists between runs                  */
/* ------------------------------------------------------------------ */

function statePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadBounds() {
  const fallback = { width: 1280, height: 840 };
  try {
    const saved = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    const keys = ['x', 'y', 'width', 'height'];
    if (saved && keys.every(k => Number.isFinite(saved[k]))) return saved;
  } catch (e) {
    // First run (or unreadable state) - the defaults are fine.
  }
  return fallback;
}

function saveBounds(win) {
  try {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    fs.writeFileSync(statePath(), JSON.stringify(win.getBounds()));
  } catch (e) {
    // Never let window bookkeeping break a session.
  }
}

/* ------------------------------------------------------------------ */
/* The window-open policy                                             */
/* ------------------------------------------------------------------ */

/**
 * Named windows the game opens (e.g. 'foogle-search'). A browser reuses
 * the tab for a repeated named open; Electron always creates a fresh
 * window, so the previous one with the same name is closed instead. That
 * keeps exactly one FOOGLE window alive AND keeps window.open() handing
 * the game a live handle, which it uses to push puzzle state into the
 * site (postMessage) and to close it when the visit expires.
 */
const namedWindows = new Map();

/**
 * Apply the policy to one webContents - the main window, every child
 * window, and any window those open later.
 */
function guard(contents) {
  // --- window.open / target=_blank ---------------------------------
  contents.setWindowOpenHandler(({ url, frameName }) => {
    const target = parseUrl(url, contents.getURL());
    if (!target) return { action: 'deny' };

    if (target.origin !== GAME_ORIGIN) {
      // Untrusted: never render it inside the app. Web links go to the
      // system browser; anything else is dropped without a trace.
      if (isWebUrl(target.href)) shell.openExternal(target.href).catch(() => {});
      return { action: 'deny' };
    }

    if (frameName && frameName !== '_blank') {
      const existing = namedWindows.get(frameName);
      if (existing && !existing.isDestroyed()) existing.close();
      namedWindows.delete(frameName);
    }

    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 1100,
        height: 820,
        autoHideMenuBar: true,
        icon: path.join(__dirname, 'icon.png'),
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webviewTag: false,
          spellcheck: false
        }
      }
    };
  });

  contents.on('did-create-window', (child, details) => {
    const name = details && details.frameName;
    if (name && name !== '_blank') namedWindows.set(name, child);
    guard(child.webContents);
  });

  // --- ordinary navigation ------------------------------------------
  // The main window never leaves the game. A link to somewhere else
  // opens in the system browser; the main game (and its WebSocket) stays
  // exactly as it was.
  contents.on('will-navigate', (event, href) => {
    if (isGameUrl(href)) return;
    event.preventDefault();
    if (isWebUrl(href)) shell.openExternal(href).catch(() => {});
  });

  contents.on('will-redirect', (event, href) => {
    if (isGameUrl(href)) return;
    event.preventDefault();
    if (isWebUrl(href)) shell.openExternal(href).catch(() => {});
  });
}

/* ------------------------------------------------------------------ */
/* Session hardening                                                   */
/* ------------------------------------------------------------------ */

function hardenSession() {
  const defaultSession = session.defaultSession;

  defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const trusted = isGameUrl(webContents && webContents.getURL());
    callback(!!(trusted && TRUSTED_PERMISSIONS.has(permission)));
  });

  defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const trusted = isGameUrl(webContents && webContents.getURL());
    return !!(trusted && TRUSTED_PERMISSIONS.has(permission));
  });
}

/* ------------------------------------------------------------------ */
/* Smoke test: prove load + child windows + independence              */
/* ------------------------------------------------------------------ */

function runSmoke(mainWindow) {
  let done = false;
  const fail = message => {
    if (done) return;
    done = true;
    console.error('SMOKE FAIL: ' + message);
    app.exit(1);
  };

  const timer = setTimeout(() => fail('timed out waiting for the game to load'), 180000);

  mainWindow.webContents.once('did-fail-load', (event, code, desc, url, isMainFrame) => {
    if (isMainFrame) fail('main window failed to load: ' + desc + ' (' + code + ')');
  });

  mainWindow.webContents.once('did-finish-load', async () => {
    try {
      const url = mainWindow.webContents.getURL();
      if (!isGameUrl(url)) return fail('main window loaded ' + url);
      console.log('SMOKE main window loaded: ' + url);

      // The game's own window.open must produce an Electron child window.
      const childLoaded = new Promise((resolve, reject) => {
        mainWindow.webContents.once('did-create-window', child => {
          child.webContents.once('did-finish-load', () => resolve(child));
          child.webContents.once('did-fail-load', (event, code, desc, u, isMainFrame) => {
            if (isMainFrame) reject(new Error('child failed to load: ' + desc + ' (' + code + ')'));
          });
        });
      });

      await mainWindow.webContents.executeJavaScript(
        "window.open('/foogle.html', 'smoke-foogle'); true"
      );

      const child = await childLoaded;
      const childUrl = child.webContents.getURL();
      if (!isGameUrl(childUrl)) return fail('child window loaded ' + childUrl);
      console.log('SMOKE fictional-site child window opened: ' + childUrl);

      // Closing the fictional site must leave the main game untouched.
      child.close();
      await new Promise(resolve => setTimeout(resolve, 500));

      if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
        return fail('main window died when the child closed');
      }
      console.log('SMOKE main game unaffected by closing the fictional site');

      clearTimeout(timer);
      done = true;
      console.log('SMOKE PASS');
      app.exit(0);
    } catch (error) {
      fail((error && error.message) || String(error));
    }
  });
}

/* ------------------------------------------------------------------ */
/* Main window                                                         */
/* ------------------------------------------------------------------ */

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow(
    Object.assign(
      {
        title: 'PHOENIX Online',
        icon: path.join(__dirname, 'icon.png'),
        backgroundColor: '#0b0d12',
        show: false,
        autoHideMenuBar: true,
        minWidth: 960,
        minHeight: 600,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webviewTag: false,
          spellcheck: false
        }
      },
      loadBounds()
    )
  );

  // Show as soon as the page has painted, or after 10s regardless, so a
  // slow Render cold start never leaves an invisible window behind.
  const showSoon = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  };
  mainWindow.webContents.once('did-finish-load', showSoon);
  setTimeout(showSoon, 10000);

  mainWindow.on('close', () => saveBounds(mainWindow));
  mainWindow.on('closed', () => {
    mainWindow = null;
    // The main game window IS the app. Child windows (fictional sites)
    // may outlive nothing: when the game closes, everything closes.
    app.quit();
  });

  if (SMOKE) runSmoke(mainWindow);

  mainWindow.loadURL(GAME_ORIGIN);
  return mainWindow;
}

/* ------------------------------------------------------------------ */
/* App lifecycle                                                       */
/* ------------------------------------------------------------------ */

const hasLock = app.requestSingleInstanceLock();

if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('web-contents-created', (event, contents) => guard(contents));

  app.whenReady().then(() => {
    hardenSession();
    createMainWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
