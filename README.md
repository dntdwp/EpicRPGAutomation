# ⚔️ EPIC RPG Discord Automation (Live CLI Dashboard Edition)

An updated, lightweight Discord automation tool for **EPIC RPG** featuring a **Live CLI Status Dashboard (TUI)** inspired by `Autovirtualfisher/autofishbot` and combining ideas from `Frsxk/Epic-selfbot`, `Const-DC/EPIC-RPG-GRINDING-SELF-BOT-FOR-DISCORD`, `Mid0aria/EpicRPGFarmBot`, and `MurphyPone/epic-rpg-huntr`.

- **Headless / Background Friendly:** Connects directly through the Discord Gateway/API—the Discord client does not need window focus and can stay minimized or closed.
- **Real-Time Terminal Size Check:** The top-right corner checks your terminal dimensions in real time and verifies an exact layout fit.
- **Auto Sync from `rpg cd`:** On startup (or whenever pressing `c`), automatically parses the `cooldowns` embed (`<username> — cooldowns`) and synchronizes every countdown timer to the second.
- **Supports All 16 Working Commands:** Cycle between all 16 work commands (`chop`, `fish`, `pickup`, `mine`, `axe`, `net`, `ladder`, `pickaxe`, `bowsaw`, `boat`, `tractor`, `drill`, `chainsaw`, `bigboat`, `greenhouse`, `dynamite`) live using the `k` key.
- **Safety-First Guard Detection:** Immediately halts all queues and alerts you via terminal bell and desktop notification if EPIC GUARD is detected so you can verify manually in Discord.

---

## 🖥️ Live CLI Keybinds

| Key | Action |
| :---: | :--- |
| `p` | **Pause / Resume** automation |
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
2. Copy **[.env.example](.env.example)** to `.env` and fill in your Discord token and channel IDs:
   ```powershell
   Copy-Item .env.example .env
   ```
   ```env
   TOKEN=your_discord_token_here
   CHANNEL_ID=your_grinding_channel_id
   EVENT_CHANNEL_IDS=optional_event_channel_ids
   ARENA_CHANNEL_IDS=optional_arena_channel_ids
   MINIBOSS_CHANNEL_IDS=optional_miniboss_channel_ids
   ```
3. Customize default feature toggles and safety thresholds (optional) in **[config.js](config.js)**.
4. Start the bot:
   ```powershell
   npm start
   ```
