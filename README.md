# ⚔️ EPIC RPG Discord Automation (Live CLI Dashboard Edition)

An updated, lightweight Discord automation tool for **EPIC RPG** featuring a **Live CLI Status Dashboard (TUI)** inspired by `Autovirtualfisher/autofishbot` and combining ideas from `Frsxk/Epic-selfbot`, `Const-DC/EPIC-RPG-GRINDING-SELF-BOT-FOR-DISCORD`, `Mid0aria/EpicRPGFarmBot`, and `MurphyPone/epic-rpg-huntr`.

- **Headless / Background Friendly:** Connects directly through the Discord Gateway/API—runs either with a full Live CLI Dashboard (`npm start`) or in **Headless / Non-TUI mode** (`npm run headless` or automatically on VMs/Docker without TTY).
- **Telegram Control Panel & Push Alerts:** Optional remote control dashboard in Telegram with inline ON/OFF buttons, live cooldown/stats view, and instant **EPIC GUARD** alerts containing a direct **Open Verify Channel** button to Discord plus one-tap **Resume** after manual verification.
- **Real-Time Terminal Size Check:** In Live TUI mode, the top-right corner checks your terminal dimensions in real time and verifies an exact layout fit.
- **Auto Sync from `rpg cd`:** On startup (or via `c` / Telegram `Sync CD`), automatically parses the `cooldowns` embed (`<username> — cooldowns`) and synchronizes every countdown timer to the second.
- **Supports All 16 Working Commands:** Cycle between all 16 work commands live using `k` in the TUI or the work button in Telegram.
- **Safety-First Guard Lock:** Immediately pauses and clears all queues if EPIC GUARD or jail state is detected—never solves or bypasses CAPTCHAs—keeping the process safely locked until you manually verify in Discord and resume.

> **Repository Versions:**
> - **`main` / `vm` (`v2.0-vm`):** Full VM-ready edition (Headless/Non-TUI mode, Telegram Control Panel with live auto-update, timezone support, Pause-on-Guard, and `Dockerfile`) — also works locally with Live TUI (`npm start`).
> - **`local` (`v1.0-local`):** Lightweight local-only Live CLI Dashboard edition (no Telegram/Headless/Docker). Clone with `git clone -b local https://github.com/dntdwp/EpicRPGAutomation.git`.

---

## 🖥️ Live CLI Keybinds

| Key | Action |
| :---: | :--- |
| `p` | **Pause / Resume** automation (also unlocks after manual EPIC GUARD verify) |
| `h` | **Toggle Auto-Hunt** (`ON` / `OFF`) |
| `a` | **Toggle Auto-Adventure** (`ON` / `OFF`) |
| `t` | **Toggle Auto-Training** (`ON` / `OFF`) |
| `w` | **Toggle Auto-Work** (`ON` / `OFF`) |
| `k` | **Cycle Work Type** (rotates through all 16 working commands) |
| `f` | **Toggle Auto-Farm** (`rpg farm` — `ON` / `OFF`) |
| `l` | **Toggle Auto-Lootbox** (`rpg buy ed lb` every 3h — `ON` / `OFF`) |
| `v` | **Toggle Auto-Event** (cross-server Epic Events auto-join — `ON` / `OFF`) |
| `r` | **Toggle Auto-Arena** (cross-server Arena auto-join — `ON` / `OFF`) |
| `m` | **Toggle Auto-Miniboss** (cross-server Miniboss `FIGHT` auto-join — `ON` / `OFF`) |
| `e` | **Toggle Auto-Heal** (`ON` / `OFF`) |
| `x` | Send `rpg heal` manually right away |
| `u` | Check Profile & Inventory (`rpg p` + `rpg i`) to update stats |
| `c` | Send `rpg cd` to resync all cooldown timers |
| `d` | Claim Daily (`rpg daily`) |
| `Q` | **Quit** (`Shift+Q` or `Ctrl+C`) |

---

## 📱 Telegram Control Panel (Optional, Recommended for VMs)

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env` to enable remote monitoring and inline controls:

- **Commands:** `/panel` (or `/start`), `/live`, `/pause`, `/resume`, `/cd`, `/profile`, `/daily`, `/logs`, `/stop`, `/help`
- **Inline Buttons:** Pause/Resume, Refresh, Sync CD, individual ON/OFF toggles (`Hunt`, `Adv`, `Train`, `Work`, `Farm`, `LB`, `Daily`, `Event`, `Arena`, `Miniboss`, `Heal`), Cycle Work Type, Heal Now, Check Profile/Inv, Claim Daily, Live Auto-Update toggle, Recent Logs, and Stop confirmation.
- **Hybrid Live Auto-Update:** Safely auto-refreshes the panel periodically (default every 12s) and shortly after activity changes with built-in debounce & rate-limit backoff.
- **Live Info Parity:** Displays profile & stats, session counters, all 7 active timers, all 8 passive cooldowns (`Weekly`, `Card Hand`, `Vote`, `Duel`, `Quest`, `Horse`, `Arena`, `Dungeon`), and recent activity lines.
- **EPIC GUARD Push Notification:** Sends an urgent alert locked to your `TELEGRAM_CHAT_ID` with a direct **`Open Verify Channel`** link to Discord and a **`Resume (After Verify)`** button once you complete verification manually in Discord.

---

## 🛠️ All 16 Working Commands (Shared 5-Minute Cooldown)

All working commands below share the same 5-minute cooldown (`chop | fish | pickup | mine`):

| Category | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
| :--- | :--- | :--- | :--- | :--- |
| **🌲 Wood** | `rpg chop` (Area 1) | `rpg axe` (Area 3) | `rpg bowsaw` (Area 6) | `rpg chainsaw` (Area 9) |
| **🐟 Fish** | `rpg fish` (Area 1) | `rpg net` (Area 3) | `rpg boat` (Area 6) | `rpg bigboat` (Area 9) |
| **🍎 Fruit** | `rpg pickup` (Area 3) | `rpg ladder` (Area 4) | `rpg tractor` (Area 8) | `rpg greenhouse` (Area 11) |
| **⛏️ Mine** | `rpg mine` (Area 5) | `rpg pickaxe` (Area 6) | `rpg drill` (Area 10) | `rpg dynamite` (Area 12) |

---

## 🚀 Getting Started

1. Install dependencies:
   ```powershell
   npm install
   ```
2. Copy **[.env.example](.env.example)** to `.env` and fill in your credentials:
   ```powershell
   Copy-Item .env.example .env
   ```
   ```env
   TOKEN=your_discord_token_here
   CHANNEL_ID=your_grinding_channel_id
   EVENT_CHANNEL_IDS=optional_event_channel_ids
   ARENA_CHANNEL_IDS=optional_arena_channel_ids
   MINIBOSS_CHANNEL_IDS=optional_miniboss_channel_ids
   HEADLESS=false
   TELEGRAM_BOT_TOKEN=optional_telegram_bot_token
   TELEGRAM_CHAT_ID=optional_your_telegram_user_id
   ```
3. Customize default feature toggles and safety thresholds (optional) in **[config.js](config.js)**.
4. Run locally with Live TUI or in Headless mode:
   ```powershell
   npm start
   # or headless plain-text logs (for servers / VMs):
   npm run headless
   ```

### 🐳 Running on a VM with Docker
```bash
docker build -t epic-rpg-bot .
docker run -d --name epic-rpg-bot --restart unless-stopped --env-file .env epic-rpg-bot
```
