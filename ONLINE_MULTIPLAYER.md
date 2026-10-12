# PHOENIX — Real multiplayer (public + private lobbies)

This version adds a **real WebSocket multiplayer server** with public and private
lobbies, host controls, and an owner admin dashboard. It keeps the updated main
menu, the approved animal portraits, single-player mode and the local multiplayer
tester.

The ONLINE MULTIPLAYER screen offers **two separate modes**:

- **PUBLIC MULTIPLAYER** — open to everyone: create a public lobby (blank invite
  code, listed in the lobby browser) or a private lobby (3–6 character code).
  Allies appear as randomly generated animal names with random emojis.
- **OWNER & FRIENDS** — the original private game: only someone with the owner
  password can create a room, friends join with the invite code, and allies are
  the **real** ones — their names, portraits and abilities. An owner room is
  private and is never listed in the public lobby browser.

The public version always randomises identities, so the private portraits and
real catalogue names never reach a public screen. The owner-gated modes (Single
Player, Multiplayer Testing, gallery) keep the portraits and names.

## Run it

1. Install **Node.js 20 or newer** from nodejs.org.
2. Extract the ZIP, open a terminal **inside the extracted folder**.
3. Run `npm install` (once, while connected to the internet).
4. Set the owner password **in the terminal** (do not put it in the website files):
   - **Windows PowerShell:** `$env:PHOENIX_OWNER_PASSWORD = "your-long-private-password"`
   - **Windows Command Prompt:** `set PHOENIX_OWNER_PASSWORD=your-long-private-password`
   - **Linux/macOS:** `export PHOENIX_OWNER_PASSWORD="your-long-private-password"`
   - Use a unique password of **at least 24 characters**. Keep it private. You must set it again in each new terminal session.
5. Run `npm start`.
6. Open **http://localhost:3000** in a browser (do not open `index.html` directly).
7. Choose **MULTIPLAYER**, then pick a mode on the ONLINE MULTIPLAYER screen:
   - **PUBLIC MULTIPLAYER**: type a name and press **CREATE LOBBY**.
     - Leave the **optional invite code blank** to make the lobby **public** — it appears in the lobby browser for everyone and gets an automatic code.
     - Type a **3–6 character code** to make the lobby **private** — it is hidden, and only people you give that code to can join.
   - **OWNER & FRIENDS**: type a name, enter the **owner password** and press **CREATE ROOM**. The room is private with the real allies; friends join with the invite code.
8. Other players open the same server URL and either pick a room from the **public lobby list** or join by typing the invite code.
9. Once five players are connected, the host presses **START MATCH**.

To play with people on your local Wi-Fi, they can open `http://YOUR-COMPUTER-LAN-IP:3000`. Your firewall may ask to allow Node.js on your private network. For friends outside your home network, deploy this Node server to a trusted HTTPS host that supports WebSockets; send them its HTTPS URL. **An invite code alone cannot connect devices without a reachable server.**

## Lobbies

- Any visitor can create a **public** lobby — no owner password needed for the PUBLIC mode.
- **Creating a public lobby** asks for an **optional invite code**. Blank = **public** (listed for everyone, automatic 6-character code); a 3–6 character code = **private** (hidden, joinable only with that exact code). Invalid or already-used custom codes are refused.
- **Owner & Friends** (the OWNER & FRIENDS tab): creating a room requires the **owner password** (validated with the same timing-safe check and IP lockout as the admin dashboard). Owner rooms are always private, get an automatic 6-character code, and are **never** listed in the lobby browser. They play with the real allies — no `publicAllies` map is ever sent to them.
- **Public** lobbies are broadcast to every connected client in the lobby browser (host name, player count, phase only — no private data).
- **Private** lobbies are invisible to everyone who does not have the invite code.
- A maximum of **5 active lobbies** is enforced across public and private together (`PHOENIX_MAX_ROOMS` to override). When the limit is reached, new creations are refused with a clear message.
- Empty lobbies are cleaned up when everyone leaves; abandoned started rooms are closed after a grace period.

## Public allies (random names + emojis)

The online game is the **public** version, so it never shows the private animal
portraits or catalogue names:

- At match creation the server gives every ally (the six draftable ones plus
  Maple) a **random animal name and a random emoji** for that room.
- The same map is sent in **every** state, so all players see identical creatures;
  the names and emojis are **re-rolled for each new match**.
- Abilities, titles and rules are unchanged — only the name and picture change. Any
  ally named inside an ability ("…chance to block Phoenix") is shown using that
  room's public name for the ally it refers to.
- The draft, the seat list, the match log, the cinematic captions and the victory
  screen all read from the public map; no portrait image is ever requested.
- The **owner-gated screen** — Single Player, Multiplayer Testing, the gallery, and the OWNER & FRIENDS online mode — never receives this map and keeps the real portraits and names exactly as before.

## Host controls (server-enforced)

- The host (first player in the room) can **kick any specific player** by seat, and can **close their own lobby**, which disconnects everyone with a notice.
- Both are validated by the server: a non-host guest that tries `kick` or `close_room` is refused with an error and the room is untouched.
- The host cannot kick themselves.

## Owner admin dashboard

The owner password (`PHOENIX_OWNER_PASSWORD`) is only needed by the operator. The dashboard is reachable from two places, and both ask for the password:

- **OWNER DASHBOARD** on the main menu — a visible option, so the operator can reach it without entering the multiplayer screen.
- **SERVER** on the ONLINE MULTIPLAYER screen.

The dashboard itself:

- See **all public and private rooms** regardless of visibility, with their invite codes.
- **Shut down any one room** while others keep running.
- **Shut down all multiplayer**: closes every room and refuses all new creations AND joins until reopened.
- **Reopen multiplayer** after a global shutdown.
- **Lock / unlock lobby creation**: locks only creation; existing lobbies keep running and can still be joined.
- Both `multiplayerOpen` and `creationLocked` are saved to a local state file (`.phoenix-server-state.json`, git-ignored) and survive a server restart.
- Admin authentication is required before any admin command is accepted. Opening the dashboard from **either** entry point prompts for the owner password; the panel is only revealed once the server accepts the password, so the main-menu option gives no access without it. A wrong password is rejected; repeated failures from one IP are temporarily locked out (3 failures within 15 minutes → 30-minute lockout).

## Rules and features

- Exactly five real people per match, one per device/browser.
- Everyone rolls dice for turn order and draft order, then each player drafts a **unique** ally (the server refuses an ally another player already holds; Ted needs at least three players).
- Server controls the deck, deals hands privately, validates legal moves and resolves effects using the existing PHOENIX rules engine.
- Players see only their own hand and their own legal move choices; other players' card counts and scores are public.
- Steal a Turn / Alvin forced decisions are handled by the server.
- Existing single-player and local tester are unchanged.

## Testing

`npm test` runs the full suite:

- 525+ unit tests for the rules engine and UI helpers (including the public ally rendering path),
- live network tests for create/join/start/play plus reconnection handling,
- **55 multiplayer/admin integration tests** covering blank-code public lobbies, custom-code private lobbies, host kick/close permission spoofing, owner shutdowns, lockdown persistence across restarts, the public ally identity map (unique names and emojis, identical for every player, never leaking catalogue names or portrait paths), explicit-leave cleanup (including started matches leaving the browser), a complete five-player match, and the **Owner & Friends** mode (password-gated private rooms that never carry public identities, are hidden from the lobby browser, are joinable by invite code, and log real ally names).

## Security notes

- The owner password is never included in the ZIP or sent to browsers; it is read from the environment at startup.
- The server refuses to start with an owner password shorter than 24 characters.
- Room snapshot messages carry only lobby metadata (code, host, player count, phase) — never hands, passwords or private data.
- This is still not comprehensive internet-facing abuse prevention: put the server behind a trusted HTTPS/WSS host with its own network rate limiting, especially if it uses a reverse proxy. Use HTTPS/WSS when hosting online so passwords are not transmitted in plaintext.

## Strong owner password

Generate a unique 32-byte random password locally in PowerShell (never share it):

```powershell
$env:PHOENIX_OWNER_PASSWORD = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

This creates a 64-character random password for the current terminal session. Copy it to a secure password manager if you need to reuse it later; otherwise a new one will be generated each time. Never add it to HTML, JavaScript, screenshots or a public repository.

**Important:** On a reverse-proxy deployment, the Node server might see every visitor as the proxy's IP, causing shared lockouts. Configure rate limiting at the trusted proxy or hosting provider before publishing. For remote access, HTTPS/WSS is mandatory so passwords are not transmitted in plaintext.