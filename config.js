require('dotenv').config();

// Daftar lengkap 16 Working Commands berdasarkan kategori & Area Unlock (berbagi 1 cooldown 5 menit)
const WORK_COMMANDS = [
    // Tier 1 (Area 1 - 5)
    { cmd: 'rpg chop', label: 'Chop (Kayu T1 - Area 1)', area: 1, category: 'Wood' },
    { cmd: 'rpg fish', label: 'Fish (Ikan T1 - Area 1)', area: 1, category: 'Fish' },
    { cmd: 'rpg pickup', label: 'Pickup (Buah T1 - Area 3)', area: 3, category: 'Fruit' },
    { cmd: 'rpg mine', label: 'Mine (Tambang T1 - Area 5)', area: 5, category: 'Mine' },

    // Tier 2 (Area 3 - 6)
    { cmd: 'rpg axe', label: 'Axe (Kayu T2 - Area 3)', area: 3, category: 'Wood' },
    { cmd: 'rpg net', label: 'Net (Ikan T2 - Area 3)', area: 3, category: 'Fish' },
    { cmd: 'rpg ladder', label: 'Ladder (Buah T2 - Area 4)', area: 4, category: 'Fruit' },
    { cmd: 'rpg pickaxe', label: 'Pickaxe (Tambang T2 - Area 6)', area: 6, category: 'Mine' },

    // Tier 3 (Area 6 - 10)
    { cmd: 'rpg bowsaw', label: 'Bowsaw (Kayu T3 - Area 6)', area: 6, category: 'Wood' },
    { cmd: 'rpg boat', label: 'Boat (Ikan T3 - Area 6)', area: 6, category: 'Fish' },
    { cmd: 'rpg tractor', label: 'Tractor (Buah T3 - Area 8)', area: 8, category: 'Fruit' },
    { cmd: 'rpg drill', label: 'Drill (Tambang T3 - Area 10)', area: 10, category: 'Mine' },

    // Tier 4 (Area 9 - 12)
    { cmd: 'rpg chainsaw', label: 'Chainsaw (Kayu T4 - Area 9)', area: 9, category: 'Wood' },
    { cmd: 'rpg bigboat', label: 'Bigboat (Ikan T4 - Area 9)', area: 9, category: 'Fish' },
    { cmd: 'rpg greenhouse', label: 'Greenhouse (Buah T4 - Area 11)', area: 11, category: 'Fruit' },
    { cmd: 'rpg dynamite', label: 'Dynamite (Tambang T4 - Area 12)', area: 12, category: 'Mine' },
];

module.exports = {
    // ID resmi bot EPIC RPG (jangan diubah)
    epicRpgBotId: '555955826880413696',

    // Kredensial diambil dari file .env
    token: process.env.TOKEN || '',
    channelId: process.env.CHANNEL_ID || '',

    // Daftar semua opsi Working Command (bisa diganti live lewat tombol 'k' di TUI)
    workCommandsList: WORK_COMMANDS,

    // ==========================================
    // PENGATURAN FITUR UTAMA (GRINDING CHANNEL)
    // ==========================================
    commands: {
        hunt: {
            enabled: true,
            cmd: 'rpg hunt',
            cooldownMinutes: 1, // Base CD Hunt = 1 menit
        },
        adventure: {
            enabled: true,
            cmd: 'rpg adventure',
            cooldownMinutes: 60, // Base CD Adventure = 60 menit (1 jam)
        },
        // Training (terbuka di Area 2, cooldown 15 menit, otomatis jawab 5 mini-game)
        training: {
            enabled: true,
            cmd: 'rpg training',
            cooldownMinutes: 15, // Base CD Training = 15 menit
        },
        // Working command (semua 16 jenis berbagi cooldown 5 menit yang sama)
        work: {
            enabled: true,
            cmd: 'rpg axe', // Tekan 'k' di terminal untuk ganti jenis work (chop/fish/pickup/mine/axe/dll)
            cooldownMinutes: 5, // Base CD Work = 5 menit
        },
        // Farm (terbuka di Area 4, cooldown 10 menit)
        farm: {
            enabled: true,
            cmd: 'rpg farm',
            cooldownMinutes: 10,
        },
        // Auto beli EDGY lootbox saat cooldown ready (Base CD = 3 jam = 180 menit, harga 420,666 coins, syarat Level 10+)
        lootbox: {
            enabled: true,
            cmd: 'rpg buy ed lb',
            cooldownMinutes: 180, // Base CD Lootbox = 3 jam
        },
        daily: {
            enabled: true,
            cmd: 'rpg daily',
            cooldownMinutes: 1440, // 24 jam
        },
    },

    // ==========================================
    // PENGATURAN AUTO-JOIN EPIC EVENTS (MULTI-SERVER)
    // ==========================================
    events: {
        // Otomatis klik tombol hijau (CUT / LURE / SUMMON / CATCH / FIGHT) di channel event
        autoJoin: true,

        // Daftar ID channel event yang dipantau (bisa beda server dengan channel grinding)
        channelIds: (process.env.EVENT_CHANNEL_IDS || '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean),

        // Maksimal percobaan klik ulang jika muncul "The application did not respond"
        maxRetries: 3,

        // Jeda manusiawi sebelum klik pertama (dalam milidetik)
        initialDelayMs: {
            min: 900,
            max: 1800,
        },

        // Jeda tunggu sebelum klik ulang jika interaksi gagal (dalam milidetik)
        retryDelayMs: {
            min: 1500,
            max: 2500,
        },
    },

    // ==========================================
    // PENGATURAN AUTO-JOIN ARENA (MULTI-SERVER)
    // ==========================================
    arena: {
        // Otomatis klik tombol '⚔️ join' saat ada arena event di channel pantauan
        autoJoin: true,

        // Daftar ID channel Arena yang dipantau (bisa beda server dengan channel grinding)
        channelIds: (process.env.ARENA_CHANNEL_IDS || '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean),

        // Maksimal percobaan klik ulang jika muncul "The application did not respond"
        maxRetries: 3,

        // Jeda manusiawi sebelum klik pertama (dalam milidetik)
        initialDelayMs: {
            min: 1800,
            max: 3200,
        },

        // Jeda tunggu sebelum klik ulang jika interaksi gagal (dalam milidetik)
        retryDelayMs: {
            min: 1500,
            max: 2500,
        },
    },

    // ==========================================
    // PENGATURAN AUTO-JOIN MINIBOSS (MULTI-SERVER)
    // ==========================================
    miniboss: {
        // Otomatis klik tombol '🗡️ FIGHT' saat ada miniboss di channel pantauan
        autoJoin: true,

        // Daftar ID channel Miniboss yang dipantau (default sama dengan channel Arena)
        channelIds: (
            process.env.MINIBOSS_CHANNEL_IDS ||
            process.env.ARENA_CHANNEL_IDS ||
            ''
        )
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean),

        // Maksimal percobaan klik ulang jika muncul "The application did not respond"
        maxRetries: 3,

        // Jeda manusiawi sebelum klik pertama (dalam milidetik)
        initialDelayMs: {
            min: 1800,
            max: 3200,
        },

        // Jeda tunggu sebelum klik ulang jika interaksi gagal (dalam milidetik)
        retryDelayMs: {
            min: 1500,
            max: 2500,
        },
    },

    // ==========================================
    // PENGATURAN KEAMANAN & AUTO-HEAL
    // ==========================================
    safety: {
        // Otomatis cek 'rpg cd' saat bot pertama kali dinyalakan agar timer langsung sinkron
        syncCooldownOnStart: true,

        // Otomatis ketik 'rpg heal' saat HP berkurang habis Hunt / Adventure
        autoHeal: true,

        // Heal jika sisa HP <= persentase ini
        healBelowHpPercent: 75,

        // Otomatis beli life potion jika habis saat mau heal
        autoBuyLifePotion: true,
        buyLifePotionAmount: 5,

        // Jeda acak tambahan (dalam detik) di setiap command agar lebih natural
        randomJitterSeconds: {
            min: 3,
            max: 8,
        },

        // Jeda antar pengiriman command jika ada antrean (dalam milidetik)
        queueGapMs: {
            min: 2500,
            max: 4500,
        },

        // Pengurangan cooldown donator Patreon (1 = normal/0%, 0.9 = -10%, 0.8 = -20%, 0.65 = -35%)
        cdReductionMultiplier: 1.0,

        // Munculkan notifikasi Windows jika terkena EPIC GUARD
        desktopNotificationOnGuard: true,
    },
};
