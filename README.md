# ⚔️ EPIC RPG Discord Automation (Live CLI Dashboard Edition)

Project ini menggabungkan fitur terbaik dari 4 repositori referensi (`Frsxk/Epic-selfbot`, `Const-DC/EPIC-RPG-GRINDING-SELF-BOT-FOR-DISCORD`, `Mid0aria/EpicRPGFarmBot`, dan `MurphyPone/epic-rpg-huntr`) dengan tampilan **CLI Live Status (TUI)** bergaya `Autovirtualfisher/autofishbot`.

- **Tidak Perlu Fokus Window Discord:** Berjalan langsung melalui *Discord Gateway/API* di latar belakang—aplikasi Discord bisa di-*minimize* atau ditutup.
- **Verifikasi Ukuran Terminal Real-Time:** Bagian kanan atas CLI menampilkan ukuran terminal saat ini dan mengecek apakah sudah tepat sesuai ukuran ideal (harus pas, bukan kurang maupun berlebih).
- **Auto Sync dari `rpg cd`:** Saat dinyalakan (atau saat menekan tombol `c`), bot otomatis membaca embed `cooldowns` (`<username> — cooldowns`) dan menyinkronkan semua hitung mundur detik demi detik.
- **Mendukung Semua 16 Working Commands:** Bisa mengganti jenis *work* (`chop`, `fish`, `pickup`, `mine`, `axe`, `net`, `ladder`, `pickaxe`, `bowsaw`, `boat`, `tractor`, `drill`, `chainsaw`, `bigboat`, `greenhouse`, `dynamite`) langsung lewat tombol `k` di terminal.

---

## 🖥️ Pintasan Keyboard (*Keybinds*) di Live CLI

| Tombol | Fungsi |
| :---: | :--- |
| `p` | **Pause / Resume** otomatisasi |
| `h` | **Toggle Auto-Hunt** (`ON` / `OFF`) |
| `a` | **Toggle Auto-Adventure** (`ON` / `OFF`) |
| `w` | **Toggle Auto-Work** (`ON` / `OFF`) |
| `k` | **Ganti Jenis Work** (berputar melalui 16 *Working Commands* sesuai Area) |
| `f` | **Toggle Auto-Farm** (`rpg farm` — `ON` / `OFF`) |
| `l` | **Toggle Auto-Lootbox** (`rpg buy ed lb` tiap 3 jam — `ON` / `OFF`) |
| `v` | **Toggle Auto-Event** (Auto-Join Epic Events lintas server — `ON` / `OFF`) |
| `r` | **Toggle Auto-Arena** (Auto-Join Arena Event lintas server — `ON` / `OFF`) |
| `m` | **Toggle Auto-Miniboss** (Auto-Join Miniboss `FIGHT` lintas server — `ON` / `OFF`) |
| `e` | **Toggle Auto-Heal** (`ON` / `OFF`) |
| `x` | Kirim `rpg heal` manual sekarang |
| `u` | Cek Profile (`rpg p`) untuk memperbarui Level & HP di panel |
| `c` | Kirim `rpg cd` untuk menyinkronkan ulang semua timer |
| `d` | Klaim Daily (`rpg daily`) |
| `Q` | **Quit / Keluar** (`Shift+Q` atau `Ctrl+C`) |

---

## 🛠️ Daftar Lengkap 16 Working Commands (Cooldown Bersama: 5 Menit)

Semua *working command* di bawah ini berbagi satu *cooldown* yang sama (`chop | fish | pickup | mine` = **5 menit**):

| Kategori | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
| :--- | :--- | :--- | :--- | :--- |
| **🌲 Kayu (Wood)** | `rpg chop` (Area 1) | `rpg axe` (Area 3) | `rpg bowsaw` (Area 6) | `rpg chainsaw` (Area 9) |
| **🐟 Ikan (Fish)** | `rpg fish` (Area 1) | `rpg net` (Area 3) | `rpg boat` (Area 6) | `rpg bigboat` (Area 9) |
| **🍎 Buah (Fruit)** | `rpg pickup` (Area 3) | `rpg ladder` (Area 4) | `rpg tractor` (Area 8) | `rpg greenhouse` (Area 11) |
| **⛏️ Tambang (Mine)** | `rpg mine` (Area 5) | `rpg pickaxe` (Area 6) | `rpg drill` (Area 10) | `rpg dynamite` (Area 12) |

---

## 🚀 Cara Pakai

1. Install dependensi:
   ```powershell
   npm install
   ```
2. Salin **[.env.example](.env.example)** menjadi `.env` lalu isi kredensial & ID channel kamu:
   ```powershell
   Copy-Item .env.example .env
   ```
   ```env
   TOKEN=isi_token_akun_discord_kamu
   CHANNEL_ID=isi_id_channel_tempat_main
   EVENT_CHANNEL_IDS=opsional_id_channel_event
   ARENA_CHANNEL_IDS=opsional_id_channel_arena
   MINIBOSS_CHANNEL_IDS=opsional_id_channel_miniboss
   ```
3. Atur preferensi awal (opsional) di **[config.js](config.js)**.
4. Jalankan bot di terminal:
   ```powershell
   npm start
   ```
