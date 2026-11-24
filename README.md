# Watershed Council v3: Render Deployment Package

This package is generated based on the latest version of `Watershed Council.html`, preserving its game interface, event cards, facility trees, stage objectives, and scoring rules. It adds online rooms, player identities, trade confirmations, private data isolation, reconnection support, and a directly shareable read-only spectator view.

## Updating GitHub and Render

1. Unzip the deployment package and upload **all files inside the package as well as the `src` and `scripts` folders** to the root directory of your GitHub project. The repository root should directly display `package.json`, `server.mjs`, `game-worker.mjs`, `schema.sql`, `src/`, and `scripts/`. Do not just upload a ZIP file or the original HTML.
2. If updating an existing repository, replace files of the same name with those from this package and preserve the subfolder structure. The old `game-worker.mjs`, `package.json`, and `schema.sql` all need to be updated.
3. Confirm the following in Render Web Service settings:

| Setting | Value |
|---|---|
| Runtime / Language | Node |
| Node.js | 24.x; specified in package.json. If the old service manually set `NODE_VERSION`, confirm it is also 24.x |
| Build Command | `npm run build` |
| Start Command | `npm start` |
| Root Directory | Leave empty, unless your full project is located inside a repository subfolder |
| Health Check Path (Optional) | `/api/health` |

4. After committing changes to GitHub, wait for Render to deploy automatically; if auto-deploy is disabled, trigger a manual deployment for the latest commit.
5. Open the deployed site URL and create a new **v3 room**. This package uses independent database tables and browser seat records, so ongoing rooms from previous versions will not automatically convert. Old database tables will not be deleted.

Official references: [Deploying Node Apps](https://render.com/docs/deploy-node-express-app), [Specifying Node Version](https://render.com/docs/node-version). This operation does not modify your GitHub or Render accounts directly.

## How Players and Spectators Join

- **Host:** Enter your name, select 3, 4, or 5 players, and click "Create room".
- **Players:** The host shares the "Player link / 玩家邀请", and other players join using their own devices; the host starts the game once all seats are filled.
- **Spectators:** Click **"Share spectator view / 分享观众视角"** at the top of the page and send the copied link to viewers. Spectators do not need a name, do not occupy player seats, and can join even after the game starts.
- On the homepage, viewers can also enter a room code and click "Watch this room / 观众进入".

Differences between the two links:

```text
Player:    https://your-domain.com/?room=ABC234
Spectator: https://your-domain.com/?watch=ABC234
```

Spectators can view the public board, each player's resources and built facilities, current events, active player, completed objective count, current victory points, net recharge, water history, public logs, and final standings. Secret objectives, reward cards, and future draw orders are not sent to spectators. Remaining event card compositions and probabilities are public, consistent with the original game interface.

The spectator page refreshes public state approximately every 1.8 seconds. Spectators cannot draw cards, construct facilities, adjust water allocation, trade, accept offers, or end turns; the backend will also reject operations originating without a valid player identity. Shared spectator links only contain the room code and do not include player seat tokens.

If copying links is blocked by browser restrictions, an inline text box with the manual link will be displayed on screen.

## Game Overview & Basic Rules

**3–5 players each manage a 4-tile district sharing a common underground aquifer. Players complete objectives to compete, and the player with the highest score after 8 rounds wins.**

Each round begins with the rotating starting player drawing an Event card, which affects all players' rainfall, funds, groundwater levels, flooding, and pollution. Next, players sequentially construct or upgrade facilities, pump water, trade, supply water to cities and farmlands, decide storage or recharge, and settle income and maintenance costs.

Facilities are divided into four upgrade tracks: Wells, Water Storage, Flood Control, and Pipe Network Repair. Each land tile can hold at most one facility, and each district can build a maximum of two wells. Terrain types and geology restrict valid construction locations and influence infiltration, pumping efficiency, and flood defenses.

Secret objectives span three stages: Rounds 1–3, Rounds 4–6, and Rounds 7–8. Upon entering a new stage, unfulfilled objectives expire and new ones are issued. Completing objectives grants victory points and funds; every two completed objectives grant a bonus reward card. Players may spend 2 M per turn to swap an objective.

Water can be allocated for basic needs, extra urban supply, extra irrigation, or recharge. Extra urban supply increases revenue; recharge bonuses are calculated based on positive "recharge minus pumping" figures for the round. Infiltration is blocked during flood rounds. Over-pumping, water shortages, floods, and pollution will cause personal or shared penalties.

Final scores are determined by completed objectives, round-by-round aquifer health bonuses or penalties, reward cards, accumulated funds, a 3-point bonus for the highest positive net recharger, minus penalties from shortages, flooding, and pollution.

## Saving Progress

If players refresh their browser or briefly disconnect, they can return to their assigned seat on the original device. Spectators can reopen the spectator link to resume viewing. Clearing browser data or switching devices will not automatically transfer player seat sessions.

Render's local filesystem is non-persistent by default; Free tier services lose local database state upon sleeping, restarting, or redeploying. If your official event requires state persistence across restarts, use a configured persistent disk and set `DB_PATH`. For example:

```text
Disk mount path: /var/data
DB_PATH: /var/data/game.sqlite
```

Only files inside the mounted directory path will persist. Persistent disks require a supported paid service plan; this package will not automatically purchase or modify your service tier. See [Free Service Limitations](https://render.com/docs/free) and [Persistent Disks](https://render.com/docs/disks).

## Future Modifications to Game Content

Modify `src/game.html` as your primary entry point. Then run:

```text
npm run build
```

This compiles the frontend view and backend rules from the single source HTML, updating `game-worker.mjs` to prevent value mismatches between client and server. Render executes this build step automatically during deployment, so content modifications can be committed to `src/game.html` and redeployed directly.

If adding new action buttons, changing action data schemas, or altering online connectivity flows, synchronously update `src/engine-actions.txt`, `src/online-client.js`, or `src/api.js`. Please do not directly edit the generated `game-worker.mjs` file.

No third-party dependencies are required to be installed manually. Run `npm test` under Node.js 24 to verify rules, permission checks, multi-client logic, and server recovery after restarts.

## Verification Scope

Verified coverage includes full 3/4/5-player 8-round games, event cards, tile and well placement limits, objective stage transitions, extra water supply, net recharge, objective swapping, trading and joint construction, private objectives, read-only spectator views, link sharing, concurrent requests, HTTPS proxy handling, and state recovery after database restarts.

Player and spectator views have passed isolated client logic checks. Visual checks across real browsers, mobile device compatibility tests, or live multi-player playtests were not performed; numerical game balance has not been playtested with live players. It is recommended to test one full round using player devices and a spectator window before hosting official events.

## File Reference

| File | Description |
|---|---|
| `game-worker.mjs` | Auto-generated game logic, web page templates, and room handlers |
| `server.mjs` | Main entry point for Render / Node server |
| `local-db.mjs`, `schema.sql` | Local SQLite database persistence; new version uses the `rooms_v3` table |
| `package.json` | Node version configuration, build, start, and test scripts |
| `src/game.html` | Preserved user HTML source; primary file for editing game content |
| `src/engine-actions.txt` | Online action definitions and rule constraints |
| `src/online-client.js`, `src/online.css` | Player, room management, and spectator interfaces |
| `src/api.js` | API endpoints for rooms, sessions, and read-only spectator feeds |
| `scripts/` | Build scripts and verification tools |
| `version.json` | Game version metadata and HTML checksum verification |