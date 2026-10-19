# Local card playground

Double-click **Start Local Playground.cmd** in the `phoenix-online` folder, or run:

```text
node tests/start-local-play.js
```

Open **http://127.0.0.1:4318/tests/local-play.html**. Choose 2–5 players and press
**Start test room**. The opening dice and ally draft are automatic; every card
decision after that is yours. The active player's real card controls appear
first in a full-width game screen. Click a card, choose a target if prompted,
then use the player tabs labelled **CHOOSE** or **PLAY A CARD** to switch players.
The green instruction above the screen tells you whose input is needed.
Impostor needs at least four players. Speed requires reacting separately in the
two participant panels, so one person controlling both is not a fairness test.

The local server binds to this computer only. All eight new cards are enabled
inside this process only, using temporary state and no Supabase credentials.
Practice hands contain one of each drawable card; this is not a natural deal or
valid whole-deck conservation fixture. No production catalogue toggle is changed,
no accounts are needed, and no production progress/statistics can be written.

Use **Stop / silence players** to remove the panels and stop their audio, or close
the page. Stop the server with **Ctrl+C** in its terminal. Nothing is deployed.
If port 4318 is occupied, stop the previous local test server before starting.

The launcher waits for each panel's account-availability check before entering
multiplayer, so the default signed-out state cannot accidentally open a sign-in
modal. If you have an older playground page open, refresh that page first and
start a new test room. Do not try to register an account on this isolated server.
