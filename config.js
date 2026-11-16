require('dotenv').config();

// Complete list of 16 Working Commands by category & unlock area (all share one 5-minute cooldown)
const WORK_COMMANDS = [
    // Tier 1 (Area 1 - 5)
    { cmd: 'rpg chop', label: 'Chop (Wood T1 - Area 1)', area: 1, category: 'Wood' },
    { cmd: 'rpg fish', label: 'Fish (Fish T1 - Area 1)', area: 1, category: 'Fish' },
    { cmd: 'rpg pickup', label: 'Pickup (Fruit T1 - Area 3)', area: 3, category: 'Fruit' },
    { cmd: 'rpg mine', label: 'Mine (Mine T1 - Area 5)', area: 5, category: 'Mine' },

    // Tier 2 (Area 3 - 6)
    { cmd: 'rpg axe', label: 'Axe (Wood T2 - Area 3)', area: 3, category: 'Wood' },
    { cmd: 'rpg net', label: 'Net (Fish T2 - Area 3)', area: 3, category: 'Fish' },
    { cmd: 'rpg ladder', label: 'Ladder (Fruit T2 - Area 4)', area: 4, category: 'Fruit' },
    { cmd: 'rpg pickaxe', label: 'Pickaxe (Mine T2 - Area 6)', area: 6, category: 'Mine' },

    // Tier 3 (Area 6 - 10)
    { cmd: 'rpg bowsaw', label: 'Bowsaw (Wood T3 - Area 6)', area: 6, category: 'Wood' },
    { cmd: 'rpg boat', label: 'Boat (Fish T3 - Area 6)', area: 6, category: 'Fish' },
    { cmd: 'rpg tractor', label: 'Tractor (Fruit T3 - Area 8)', area: 8, category: 'Fruit' },
    { cmd: 'rpg drill', label: 'Drill (Mine T3 - Area 10)', area: 10, category: 'Mine' },

    // Tier 4 (Area 9 - 12)
    { cmd: 'rpg chainsaw', label: 'Chainsaw (Wood T4 - Area 9)', area: 9, category: 'Wood' },
    { cmd: 'rpg bigboat', label: 'Bigboat (Fish T4 - Area 9)', area: 9, category: 'Fish' },
    { cmd: 'rpg greenhouse', label: 'Greenhouse (Fruit T4 - Area 11)', area: 11, category: 'Fruit' },
    { cmd: 'rpg dynamite', label: 'Dynamite (Mine T4 - Area 12)', area: 12, category: 'Mine' },
];

module.exports = {
    // Official EPIC RPG Discord bot user ID (do not change)
    epicRpgBotId: '555955826880413696',

    // Credentials loaded from .env
    token: process.env.TOKEN || '',
    channelId: process.env.CHANNEL_ID || '',

    // All Working Command options (cycle live in TUI with 'k')
    workCommandsList: WORK_COMMANDS,

    // ==========================================
    // MAIN GRINDING COMMAND SETTINGS
    // ==========================================
    commands: {
        hunt: {
            enabled: true,
            cmd: 'rpg hunt',
            cooldownMinutes: 1, // Base Hunt cooldown = 1 minute
        },
        adventure: {
            enabled: true,
            cmd: 'rpg adventure',
            cooldownMinutes: 60, // Base Adventure cooldown = 60 minutes (1 hour)
        },
        // Training (unlocked at Area 2, 15-minute cooldown, auto-solves all 5 mini-games)
        training: {
            enabled: true,
            cmd: 'rpg training',
            cooldownMinutes: 15, // Base Training cooldown = 15 minutes
        },
        // Working command (all 16 commands share the same 5-minute cooldown)
        work: {
            enabled: true,
            cmd: 'rpg axe', // Press 'k' in the terminal to cycle work type
            cooldownMinutes: 5, // Base Work cooldown = 5 minutes
        },
        // Farm (unlocked at Area 4, 10-minute cooldown)
        farm: {
            enabled: true,
            cmd: 'rpg farm',
            cooldownMinutes: 10,
        },
        // Auto-buy EDGY lootbox when off cooldown (Base CD = 3 hours = 180 min, costs 420,666 coins, Level 10+)
        lootbox: {
            enabled: true,
            cmd: 'rpg buy ed lb',
            cooldownMinutes: 180, // Base Lootbox cooldown = 3 hours
        },
        daily: {
            enabled: true,
            cmd: 'rpg daily',
            cooldownMinutes: 1440, // 24 hours
        },
    },

    // ==========================================
    // AUTO-JOIN EPIC EVENTS (MULTI-SERVER)
    // ==========================================
    events: {
        // Automatically click event action buttons (CUT / LURE / SUMMON / CATCH / FIGHT)
        autoJoin: true,

        // Monitored event channel IDs (can be across different servers)
        channelIds: (process.env.EVENT_CHANNEL_IDS || '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean),

        // Maximum retries if Discord returns "The application did not respond"
        maxRetries: 3,

        // Human-like delay before the initial button click (ms)
        initialDelayMs: {
            min: 900,
            max: 1800,
        },

        // Delay before retrying a failed interaction (ms)
        retryDelayMs: {
            min: 1500,
            max: 2500,
        },
    },

    // ==========================================
    // AUTO-JOIN ARENA (MULTI-SERVER)
    // ==========================================
    arena: {
        // Automatically click the '⚔️ join' button on arena events
        autoJoin: true,

        // Monitored arena channel IDs
        channelIds: (process.env.ARENA_CHANNEL_IDS || '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean),

        // Maximum retries if Discord returns "The application did not respond"
        maxRetries: 3,

        // Human-like delay before the initial button click (ms)
        initialDelayMs: {
            min: 1800,
            max: 3200,
        },

        // Delay before retrying a failed interaction (ms)
        retryDelayMs: {
            min: 1500,
            max: 2500,
        },
    },

    // ==========================================
    // AUTO-JOIN MINIBOSS (MULTI-SERVER)
    // ==========================================
    miniboss: {
        // Automatically click the '🗡️ FIGHT' button on miniboss spawns
        autoJoin: true,

        // Monitored miniboss channel IDs (falls back to ARENA_CHANNEL_IDS if omitted)
        channelIds: (
            process.env.MINIBOSS_CHANNEL_IDS ||
            process.env.ARENA_CHANNEL_IDS ||
            ''
        )
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean),

        // Maximum retries if Discord returns "The application did not respond"
        maxRetries: 3,

        // Human-like delay before the initial button click (ms)
        initialDelayMs: {
            min: 1800,
            max: 3200,
        },

        // Delay before retrying a failed interaction (ms)
        retryDelayMs: {
            min: 1500,
            max: 2500,
        },
    },

    // ==========================================
    // SAFETY & AUTO-HEAL SETTINGS
    // ==========================================
    safety: {
        // Automatically run 'rpg cd' on startup to sync all cooldown timers
        syncCooldownOnStart: true,

        // Automatically send 'rpg heal' when HP drops below the threshold
        autoHeal: true,

        // Trigger heal when remaining HP <= this percentage
        healBelowHpPercent: 75,

        // Automatically buy life potions when out of potions while healing
        autoBuyLifePotion: true,
        buyLifePotionAmount: 5,

        // Additional random jitter (seconds) added to scheduled commands
        randomJitterSeconds: {
            min: 3,
            max: 8,
        },

        // Delay between queued commands (ms)
        queueGapMs: {
            min: 2500,
            max: 4500,
        },

        // Patreon donator cooldown reduction multiplier (1.0 = 0%, 0.9 = -10%, 0.8 = -20%, 0.65 = -35%)
        cdReductionMultiplier: 1.0,

        // Show a desktop notification when EPIC GUARD is detected
        desktopNotificationOnGuard: true,
    },
};
