const { Client } = require('discord.js-selfbot-v13');
const chalk = require('chalk');
const notifier = require('node-notifier');
const config = require('./config');
const { LiveTUI, sanitizeToSingleWidth } = require('./tui');

const client = new Client({
    checkUpdate: false,
});

const MINUTE_MS = 60 * 1000;

const state = {
    isStopped: false,
    isPaused: false,
    isBusyWithPrompt: false,
    busyTimeout: null,
    targetChannel: null,
    timers: {},
    nextRunAt: {
        hunt: null,
        adventure: null,
        training: null,
        work: null,
        farm: null,
        lootbox: null,
        daily: null,
    },
    passiveCdAt: {
        weekly: null,
        card_hand: null,
        vote: null,
        duel: null,
        quest: null,
        horse: null,
        arena: null,
        dungeon: null,
    },
    queue: [],
    isProcessingQueue: false,
    lastSentCmd: '',
    stats: {
        hunt: 0,
        adventure: 0,
        training: 0,
        work: 0,
        farm: 0,
        lootbox: 0,
        daily: 0,
        heals: 0,
        events: 0,
        arena: 0,
        miniboss: 0,
    },
    profile: {
        username: 'Connecting...',
        channelName: '',
        level: '-',
        area: '-',
        currentXp: null,
        maxXp: null,
        at: '-',
        def: '-',
        hpText: '-',
        coins: null,
        bank: 0,
        equipment: '-',
        rubies: 0,
        sessionCoins: 0,
        sessionXp: 0,
        lastDrop: 'None',
    },
    handledEventMessages: new Set(),
    handledEventRewards: new Set(),
    pendingJoinByChannel: new Map(),
    recentLines: [
        'Menghubungkan ke gateway Discord...',
        'Window Discord tidak perlu dibuka / bisa di-minimize.',
    ],
};

let tui = null;

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp() {
    return new Date().toLocaleTimeString('id-ID', { hour12: false });
}

function setBusyLock(locked, maxDurationMs = 8000) {
    state.isBusyWithPrompt = locked;
    if (state.busyTimeout) {
        clearTimeout(state.busyTimeout);
        state.busyTimeout = null;
    }
    if (locked) {
        state.busyTimeout = setTimeout(() => {
            state.isBusyWithPrompt = false;
            state.busyTimeout = null;
            if (tui) tui.render();
            processQueue();
        }, maxDurationMs);
    } else {
        processQueue();
    }
    if (tui) tui.render();
}

function pushFeedLine(line) {
    const clean = sanitizeToSingleWidth(
        String(line)
            .replace(/\*\*/g, '')
            .replace(/<:[a-zA-Z0-9_]+:\d+>/g, '')
    );
    if (!clean) return;
    state.recentLines.push(`[${timestamp()}] ${clean}`);
    if (state.recentLines.length > 25) {
        state.recentLines.shift();
    }
    if (tui) tui.render();
}

function notifyUi(msg, prioSec = 4) {
    if (tui && tui.isAlive) {
        tui.notify(msg, prioSec);
    } else {
        console.log(`[${timestamp()}] ${msg}`);
    }
}

/**
 * Antrean pengiriman pesan agar command tidak pernah tabrakan di detik yang sama
 * atau mengganggu prompt interaktif seperti 'rpg training'
 */
function enqueueCommand(cmd, label = 'CMD', priority = false, manual = false) {
    if (state.isStopped) return;
    if (state.isPaused && !manual) return;

    if (priority) {
        state.queue.unshift({ cmd, label });
    } else {
        if (state.queue.some((item) => item.cmd === cmd)) return;
        state.queue.push({ cmd, label });
    }
    if (tui) tui.render();
    processQueue();
}

async function processQueue() {
    if (state.isProcessingQueue || state.isStopped || state.isBusyWithPrompt) return;
    state.isProcessingQueue = true;

    while (state.queue.length > 0 && !state.isStopped && !state.isBusyWithPrompt) {
        const { cmd, label } = state.queue.shift();
        try {
            if (!state.targetChannel) {
                state.targetChannel = await client.channels.fetch(config.channelId);
            }

            if (label === 'training' || cmd.toLowerCase().includes('rpg training')) {
                setBusyLock(true, 10000);
            }

            state.lastSentCmd = cmd;
            await state.targetChannel.send(cmd);

            if (config.commands[label]?.enabled) {
                scheduleNext(label);
            }

            if (state.stats[label] !== undefined) {
                state.stats[label]++;
                notifyUi(`[*] Sent "${cmd}" (${label.toUpperCase()} #${state.stats[label]})`, 3);
            } else {
                notifyUi(`[*] Sent "${cmd}"`, 3);
            }
            pushFeedLine(`>>> Dikirim: ${cmd}`);
        } catch (err) {
            notifyUi(`[E] Gagal kirim "${cmd}": ${err.message}`, 6);
            pushFeedLine(`[ERROR] Gagal kirim ${cmd}: ${err.message}`);
        }

        const gap = randomInt(config.safety.queueGapMs.min, config.safety.queueGapMs.max);
        await sleep(gap);
    }

    state.isProcessingQueue = false;
    if (tui) tui.render();
}

/**
 * Menjadwalkan eksekusi command berikutnya dengan jeda acak (random jitter)
 */
function scheduleNext(key, customDelayMs = null) {
    if (state.isStopped) return;
    const cmdCfg = config.commands[key];

    if (state.timers[key]) {
        clearTimeout(state.timers[key]);
        state.timers[key] = null;
    }

    if (!cmdCfg) return;

    const jitterMs =
        randomInt(
            config.safety.randomJitterSeconds.min,
            config.safety.randomJitterSeconds.max
        ) * 1000;

    const baseMs =
        customDelayMs !== null
            ? customDelayMs
            : cmdCfg.cooldownMinutes * MINUTE_MS * config.safety.cdReductionMultiplier;

    const totalWaitMs = Math.max(2000, Math.round(baseMs + jitterMs));
    state.nextRunAt[key] = Date.now() + totalWaitMs;

    if (!cmdCfg.enabled) {
        if (tui) tui.render();
        return;
    }

    state.timers[key] = setTimeout(() => {
        if (state.isStopped) return;
        if (!state.isPaused && config.commands[key].enabled) {
            enqueueCommand(config.commands[key].cmd, key);
        }
        scheduleNext(key);
    }, totalWaitMs);

    if (tui) tui.render();
}

/**
 * Menghentikan semua aktivitas jika EPIC GUARD muncul, memberi tahu user untuk verifikasi manual
 */
function handleEpicGuard(reasonText) {
    if (state.isStopped) return;
    state.isStopped = true;

    Object.values(state.timers).forEach((t) => {
        if (t) clearTimeout(t);
    });
    state.queue = [];

    pushFeedLine('🚨 EPIC GUARD TERDETEKSI! Bot dihentikan otomatis.');
    notifyUi('[!] EPIC GUARD TERDETEKSI! Segera cek Discord!', 30);

    process.stdout.write('\x07');

    const exitMsg =
        chalk.bgRed.white.bold('\n 🚨 PERINGATAN: EPIC GUARD TERDETEKSI! 🚨 \n') +
        chalk.yellow(
            'Bot dihentikan otomatis demi keamanan akun kamu.\nSilakan buka Discord dan selesaikan verifikasi secara manual!\n'
        ) +
        chalk.gray(`Detail: ${String(reasonText).slice(0, 200)}\n`);

    if (config.safety.desktopNotificationOnGuard) {
        notifier.notify({
            title: '🚨 EPIC GUARD Terdeteksi!',
            message:
                'Otomatisasi dihentikan. Segera buka Discord dan selesaikan verifikasi secara manual.',
            sound: true,
            wait: false,
        });
    }

    setTimeout(() => {
        if (tui) tui.stop(exitMsg);
        process.exit(0);
    }, 1500);
}

/**
 * Parsing durasi dari teks seperti "(1d 20h 4m 4s)" atau "48m 20s" ke milidetik
 */
function parseDurationMs(text) {
    if (!text) return null;
    let totalMs = 0;
    const dMatch = text.match(/(\d+)\s*d/i);
    const hMatch = text.match(/(\d+)\s*h/i);
    const mMatch = text.match(/(\d+)\s*m/i);
    const sMatch = text.match(/(\d+)\s*s/i);

    if (dMatch) totalMs += parseInt(dMatch[1], 10) * 86400 * 1000;
    if (hMatch) totalMs += parseInt(hMatch[1], 10) * 3600 * 1000;
    if (mMatch) totalMs += parseInt(mMatch[1], 10) * 60 * 1000;
    if (sMatch) totalMs += parseInt(sMatch[1], 10) * 1000;

    return totalMs > 0 ? totalMs : null;
}

/**
 * Parsing embed penuh dari 'rpg cd' (contoh: "<username> — cooldowns")
 */
function syncFromCooldownEmbed(embed) {
    if (!embed || !embed.fields) return;
    const allLines = embed.fields.map((f) => f.value || '').join('\n').split('\n');

    const mapping = [
        // Active (bisa di-auto oleh bot)
        { regex: /\bdaily\b/i, type: 'active', key: 'daily' },
        { regex: /\bhunt\b/i, type: 'active', key: 'hunt' },
        { regex: /\badventure\b/i, type: 'active', key: 'adventure' },
        { regex: /\btraining\b/i, type: 'active', key: 'training' },
        { regex: /\bchop\b/i, type: 'active', key: 'work' },
        { regex: /\bfarm\b/i, type: 'active', key: 'farm' },
        { regex: /\blootbox\b/i, type: 'active', key: 'lootbox' },
        // Passive (pemberitahuan status & hitung mundur cooldown)
        { regex: /\bweekly\b/i, type: 'passive', key: 'weekly' },
        { regex: /\bcard hand\b/i, type: 'passive', key: 'card_hand' },
        { regex: /\bvote\b/i, type: 'passive', key: 'vote' },
        { regex: /\bduel\b/i, type: 'passive', key: 'duel' },
        { regex: /\bquest\b/i, type: 'passive', key: 'quest' },
        { regex: /\bhorse\b/i, type: 'passive', key: 'horse' },
        { regex: /\barena\b/i, type: 'passive', key: 'arena' },
        { regex: /\bdungeon\b/i, type: 'passive', key: 'dungeon' },
    ];

    for (const rawLine of allLines) {
        const line = rawLine.trim();
        for (const item of mapping) {
            if (item.regex.test(line)) {
                const parenMatch = line.match(/\(([^)]+)\)/);
                const remMs = parenMatch ? parseDurationMs(parenMatch[1]) : 0;

                if (item.type === 'active') {
                    const cfg = config.commands[item.key];
                    if (remMs && remMs > 0) {
                        scheduleNext(item.key, remMs);
                    } else {
                        state.nextRunAt[item.key] = Date.now();
                        if (cfg && cfg.enabled && !state.isPaused) {
                            enqueueCommand(cfg.cmd, item.key);
                            scheduleNext(item.key);
                        }
                    }
                } else {
                    state.passiveCdAt[item.key] = remMs && remMs > 0 ? Date.now() + remMs : Date.now();
                }
            }
        }
    }

    notifyUi('[*] Semua Cooldown berhasil disinkronkan dari "rpg cd"!', 4);
    pushFeedLine('[CD Sync] Timer disinkronkan dengan embed cooldowns EPIC RPG.');
}

/**
 * Helper untuk klik tombol di pesan Discord atau fallback kirim teks di chat
 */
async function answerTrainingPrompt(message, buttonMatcherFn, fallbackText, labelInfo) {
    setBusyLock(true, 6000);
    await sleep(randomInt(1100, 2100));

    let clicked = false;
    if (message.components && message.components.length > 0) {
        for (const row of message.components) {
            if (!row.components) continue;
            for (const btn of row.components) {
                if (buttonMatcherFn(btn)) {
                    try {
                        await message.clickButton(btn.customId);
                        clicked = true;
                        notifyUi(`[*] Training (${labelInfo}) dijawab via tombol: ${fallbackText}`, 4);
                        pushFeedLine(`[Training ${labelInfo}] Klik tombol: ${fallbackText}`);
                    } catch (_) {
                        clicked = false;
                    }
                    break;
                }
            }
            if (clicked) break;
        }
    }

    if (!clicked && fallbackText !== null && fallbackText !== undefined) {
        try {
            await message.channel.send(String(fallbackText));
            notifyUi(`[*] Training (${labelInfo}) dijawab via teks: ${fallbackText}`, 4);
            pushFeedLine(`[Training ${labelInfo}] Jawab teks: ${fallbackText}`);
        } catch (err) {
            notifyUi(`[E] Gagal jawab training: ${err.message}`, 5);
        }
    }

    await sleep(1200);
    setBusyLock(false);
}

/**
 * Menyelesaikan 5 jenis pertanyaan 'rpg training' secara otomatis
 */
async function handleTrainingQuestion(message, content) {
    const lower = content.toLowerCase();

    // 1. FIELD: "What's the **fifth** letter of <:Apple:...>?"
    if (lower.includes('is training in the field')) {
        const ordMap = {
            first: 0,
            second: 1,
            third: 2,
            fourth: 3,
            fifth: 4,
            sixth: 5,
        };
        const ordMatch =
            lower.match(/what's the \*\*([a-z]+)\*\* letter of/i) ||
            lower.match(/what's the ([a-z]+) letter of/i);
        const word = lower.includes('banana') ? 'banana' : 'apple';
        const idx = ordMatch && ordMap[ordMatch[1]] !== undefined ? ordMap[ordMatch[1]] : 0;
        const letter = word[idx] || 'a';
        const targetCustomId = `training_${letter}`;

        await answerTrainingPrompt(
            message,
            (btn) =>
                (btn.customId && btn.customId.toLowerCase() === targetCustomId) ||
                (btn.label && btn.label.toLowerCase() === letter),
            letter,
            `Field (${word}[${idx + 1}] = ${letter.toUpperCase()})`
        );
        return true;
    }

    // 2. RIVER: "What kind of fish is this?"
    if (lower.includes('is training in the river')) {
        let fishNum = '1';
        let fishLabel = 'normie fish';
        if (lower.includes('epicfish')) {
            fishNum = '3';
            fishLabel = 'epic fish';
        } else if (lower.includes('goldenfish')) {
            fishNum = '2';
            fishLabel = 'golden fish';
        }

        await answerTrainingPrompt(
            message,
            (btn) =>
                (btn.label && btn.label.toLowerCase() === fishLabel) ||
                (btn.customId && btn.customId.toLowerCase().includes(fishLabel.replace(/\s+/g, ''))),
            fishNum,
            `River (${fishLabel})`
        );
        return true;
    }

    // 3. CASINO: "Is this a **four leaf clover** ? :four_leaf_clover:"
    if (lower.includes('is training in the... casino')) {
        const qMatch = lower.match(/is this a \*\*(.+?)\*\*\s*\?\s*([^\n]+)/i);
        const item = qMatch ? qMatch[1].trim() : '';
        const emojiPart = qMatch ? qMatch[2].trim() : '';

        let isMatch = false;
        if (
            item === 'four leaf clover' &&
            (emojiPart.includes('four_leaf_clover') || emojiPart.includes('🍀'))
        ) {
            isMatch = true;
        } else if (
            item === 'diamond' &&
            (emojiPart.includes('gem') || emojiPart.includes('💎'))
        ) {
            isMatch = true;
        } else if (item === 'gold' && emojiPart.includes('gold')) {
            isMatch = true;
        } else if (
            item === 'gift' &&
            (emojiPart.includes('gift') || emojiPart.includes('🎁'))
        ) {
            isMatch = true;
        } else if (
            item === 'coin' &&
            (emojiPart.includes('coin') || emojiPart.includes('🪙'))
        ) {
            isMatch = true;
        } else if (
            item === 'dice' &&
            (emojiPart.includes('game_die') ||
                emojiPart.includes('dice') ||
                emojiPart.includes('🎲'))
        ) {
            isMatch = true;
        }

        const ans = isMatch ? 'yes' : 'no';
        await answerTrainingPrompt(
            message,
            (btn) =>
                (btn.label && btn.label.toLowerCase() === ans) ||
                (btn.customId && btn.customId.toLowerCase().includes(ans)),
            ans,
            `Casino (${ans.toUpperCase()})`
        );
        return true;
    }

    // 4. FOREST: "How many <:woodenlog:...> do you see?"
    if (lower.includes('is training in the forest')) {
        const qMatch = content.match(/how many\s+(\S+)\s+do you see\?/i);
        let count = 0;
        if (qMatch) {
            const targetEmoji = qMatch[1].trim();
            const allOccurrences = content.split(targetEmoji).length - 1;
            count = Math.max(0, allOccurrences - 1);
        }
        const countStr = String(count);

        await answerTrainingPrompt(
            message,
            (btn) =>
                (btn.label && btn.label.trim() === countStr) ||
                (btn.customId && btn.customId.endsWith(countStr)),
            countStr,
            `Forest (${countStr} logs)`
        );
        return true;
    }

    // 5. MINE: "Do you have more than **15** <:ruby:...> ?"
    if (lower.includes('is training in the mine')) {
        const numMatch =
            lower.match(/more than \*\*(\d+)\*\*/i) || lower.match(/more than (\d+)/i);
        const threshold = numMatch ? parseInt(numMatch[1], 10) : 0;
        const ans = state.profile.rubies > threshold ? 'yes' : 'no';

        await answerTrainingPrompt(
            message,
            (btn) =>
                (btn.label && btn.label.toLowerCase() === ans) ||
                (btn.customId && btn.customId.toLowerCase().includes(ans)),
            ans,
            `Mine (Rubies: ${state.profile.rubies} > ${threshold} => ${ans.toUpperCase()})`
        );
        return true;
    }

    return false;
}

/**
 * Mencari tombol aktif pada pesan Epic Event atau Arena
 */
function findActiveJoinButton(message, preferredKeyword = null) {
    if (!message.components || message.components.length === 0) return null;
    let fallbackBtn = null;
    for (const row of message.components) {
        if (!row.components) continue;
        for (const btn of row.components) {
            if (!btn.disabled && btn.customId) {
                if (!fallbackBtn) fallbackBtn = btn;
                if (preferredKeyword) {
                    const kw = preferredKeyword.toLowerCase();
                    const lbl = (btn.label || '').toLowerCase();
                    const cid = (btn.customId || '').toLowerCase();
                    if (lbl.includes(kw) || cid.includes(kw)) return btn;
                }
            }
        }
    }
    return preferredKeyword ? null : fallbackBtn;
}

/**
 * Helper bersama untuk Auto-Join Epic Event / Arena lengkap dengan jeda manusiawi & Auto-Retry
 * jika Discord membalas "The application did not respond".
 */
async function attemptJoinWithRetry(message, { kind, name, tag, buttonKeyword, joinCfg }) {
    const channelId = message.channel.id;
    const joinEntry = {
        messageId: message.id,
        name,
        kind,
        tag,
        joined: false,
        expired: false,
    };
    state.pendingJoinByChannel.set(channelId, joinEntry);

    const initDelay = randomInt(
        joinCfg.initialDelayMs?.min || 1000,
        joinCfg.initialDelayMs?.max || 2200
    );
    notifyUi(`[*] ${tag} terdeteksi: ${name}! Klik dalam ${(initDelay / 1000).toFixed(1)}s...`, 5);
    pushFeedLine(`[${tag}] Terdeteksi ${name}, mencoba join...`);

    await sleep(initDelay);

    const maxRetries = joinCfg.maxRetries || 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (state.isStopped || state.isPaused) return;
        if (joinEntry.joined || joinEntry.expired) return;

        const latestMsg = message.channel?.messages?.cache?.get(message.id) || message;
        const btnNow = findActiveJoinButton(latestMsg, buttonKeyword);
        if (!btnNow) {
            pushFeedLine(`[${tag}] Tombol ${name} sudah ditutup/selesai.`);
            return;
        }

        try {
            await latestMsg.clickButton(btnNow.customId);
            if (!joinEntry.joined && !joinEntry.expired) {
                joinEntry.joined = true;
                if (state.stats[kind] !== undefined) state.stats[kind]++;
                if (tui) tui.render();
                notifyUi(`[*] Berhasil klik tombol ${name}!`, 5);
                pushFeedLine(`[${tag}] Klik tombol ${btnNow.label || name} berhasil.`);
            }
            return;
        } catch (err) {
            if (joinEntry.joined || joinEntry.expired) return;

            if (attempt < maxRetries) {
                const retryWait = randomInt(
                    joinCfg.retryDelayMs?.min || 1500,
                    joinCfg.retryDelayMs?.max || 2500
                );
                notifyUi(
                    `[!] Klik ${tag} gagal (App didn't respond), retry ${attempt}/${maxRetries}...`,
                    4
                );
                pushFeedLine(
                    `[${tag}] App didn't respond, mencoba klik ulang (${attempt}/${maxRetries})...`
                );
                await sleep(retryWait);
            } else {
                notifyUi(`[E] Gagal join ${name} setelah ${maxRetries}x klik.`, 5);
                pushFeedLine(`[${tag}] Gagal klik ${name}: ${err.message}`);
            }
        }
    }
}

function getOwnUsernamesLower() {
    return [client.user?.username, client.user?.globalName]
        .filter(Boolean)
        .map((n) => n.toLowerCase());
}

/**
 * Menangani pesan di channel pantauan Epic Events dan Arena (lintas server/channel)
 */
async function handleMonitoredChannelMessage(
    message,
    { allowEvents = false, allowArena = false, allowMiniboss = false }
) {
    if (state.isStopped || state.isPaused) return;
    if (!allowEvents && !allowArena && !allowMiniboss) return;
    if (message.author?.id !== config.epicRpgBotId) return;

    const channelId = message.channel.id;
    const content = message.content || '';
    const lowerContent = content.toLowerCase();

    let embedText = '';
    if (message.embeds && message.embeds.length > 0) {
        const emb = message.embeds[0];
        embedText = [
            emb.author?.name || '',
            emb.title || '',
            emb.description || '',
            emb.footer?.text || '',
            ...(emb.fields ? emb.fields.map((f) => `${f.name}: ${f.value}`) : []),
        ].join('\n');
    }
    const combinedLower = `${lowerContent}\n${embedText.toLowerCase()}`;

    // 1. Deteksi konfirmasi hidden/ephemeral ("Successfully joined!" / "already joined" / penuh)
    if (
        combinedLower.includes('successfully joined') ||
        combinedLower.includes('already joined')
    ) {
        const pending = state.pendingJoinByChannel.get(channelId);
        if (pending && !pending.joined) {
            pending.joined = true;
            if (state.stats[pending.kind] !== undefined) state.stats[pending.kind]++;
            if (tui) tui.render();
        }
        const tag = pending?.tag || (allowArena && !allowEvents ? 'Arena/MB' : 'Event');
        notifyUi(`[*] Konfirmasi Discord: Successfully joined (${tag})!`, 5);
        pushFeedLine(`[${tag}] ✅ Successfully joined! (${pending?.name || tag})`);
        return;
    }

    if (
        combinedLower.includes('miniboss is full') ||
        combinedLower.includes('cannot join') ||
        combinedLower.includes('already ended')
    ) {
        const pending = state.pendingJoinByChannel.get(channelId);
        if (pending) pending.joined = true;
        const tag = pending?.tag || 'Monitor';
        notifyUi(`[!] ${tag}: penuh atau sudah berakhir.`, 4);
        pushFeedLine(`[${tag}] Penuh / sudah selesai, batal join.`);
        return;
    }

    // 2. Deteksi hasil akhir Event / Arena / Miniboss
    const ownNames = getOwnUsernamesLower();
    if (!state.handledEventRewards.has(message.id)) {
        // 2a. Hasil Epic Event ("Players: ... Everyone got ...")
        if (combinedLower.includes('players:') && combinedLower.includes('everyone got')) {
            if (ownNames.some((n) => combinedLower.includes(n))) {
                state.handledEventRewards.add(message.id);
                const rewardMatch = embedText.match(/Everyone got\s+([^\n]+)/i);
                const rewardStr = rewardMatch
                    ? rewardMatch[1].replace(/\*\*/g, '').trim()
                    : 'Event Reward';
                state.profile.lastDrop = `Event: ${rewardStr}`;
                notifyUi(`[!] Hadiah Event didapat: ${rewardStr}!`, 7);
                pushFeedLine(`🎉 [Event Reward] Kamu dapat: ${rewardStr}`);
            }
            return;
        }

        // 2b. Hasil Arena ("Ranking\n1. username (+23 🍪) - kills: ...")
        if (
            combinedLower.includes('players:') &&
            combinedLower.includes('ranking') &&
            (combinedLower.includes('cookies') || combinedLower.includes('arena'))
        ) {
            if (ownNames.some((n) => combinedLower.includes(n))) {
                state.handledEventRewards.add(message.id);
                const lines = embedText.split('\n');
                let cookiesWon = null;
                for (const line of lines) {
                    const rankMatch = line.trim().match(/^\d+\.\s*([^(]+)\(\+?([\d,]+)/);
                    if (rankMatch) {
                        const cleanPlayer = rankMatch[1].replace(/[*_~`]/g, '').trim().toLowerCase();
                        if (ownNames.some((n) => cleanPlayer.includes(n))) {
                            cookiesWon = rankMatch[2];
                            break;
                        }
                    }
                }
                const rewardLabel = cookiesWon ? `+${cookiesWon} cookies` : 'Arena cookies';
                state.profile.lastDrop = `Arena: ${rewardLabel}`;
                notifyUi(`[!] Arena selesai! Kamu dapat ${rewardLabel}!`, 6);
                pushFeedLine(`🏟️ [Arena Result] Kamu dapat ${rewardLabel}!`);
            }
            return;
        }

        // 2c. Hasil Miniboss ("... defeated ... helper(s) got X coins")
        if (
            combinedLower.includes('defeated') &&
            (combinedLower.includes('helper') || combinedLower.includes('players:')) &&
            ownNames.some((n) => combinedLower.includes(n))
        ) {
            state.handledEventRewards.add(message.id);
            const mbCoinsMatch = combinedLower.match(/(?:helper|got|earned)[^\d\n]*([\d,]+)\s*coins/i);
            const rewardLabel = mbCoinsMatch ? `+${mbCoinsMatch[1]} coins` : 'Miniboss Win';
            state.profile.lastDrop = `Miniboss: ${rewardLabel}`;
            notifyUi(`[!] Miniboss berhasil dikalahkan! (${rewardLabel})`, 6);
            pushFeedLine(`🗡️ [Miniboss Result] Menang! (${rewardLabel})`);
            return;
        }
    }

    // 3. Cegah pemrosesan ganda pada pesan tombol yang sama
    if (state.handledEventMessages.has(message.id)) return;

    // 4. Deteksi kemunculan Miniboss ("klonixg — miniboss" / "Type fight to help and get a reward!")
    if (
        allowMiniboss &&
        combinedLower.includes('miniboss') &&
        (combinedLower.includes('to help and get a reward') ||
            combinedLower.includes('chance to win'))
    ) {
        if (
            ownNames.some(
                (n) =>
                    combinedLower.includes(`${n} — miniboss`) ||
                    combinedLower.includes(`help ${n} defeat`)
            )
        ) {
            return;
        }
        const fightBtn = findActiveJoinButton(message, 'fight');
        if (!fightBtn) return;

        state.handledEventMessages.add(message.id);
        trimHandledSet(state.handledEventMessages);

        await attemptJoinWithRetry(message, {
            kind: 'miniboss',
            name: 'Miniboss (FIGHT)',
            tag: 'Miniboss',
            buttonKeyword: 'fight',
            joinCfg: config.miniboss,
        });
        return;
    }

    // 5. Deteksi kemunculan Arena Event ("started an arena event!" / "to join the arena!")
    if (
        allowArena &&
        (combinedLower.includes('started an arena event') ||
            combinedLower.includes('to join the arena!'))
    ) {
        if (ownNames.some((n) => combinedLower.includes(`${n} started an arena event`))) {
            return;
        }
        const joinBtn = findActiveJoinButton(message, 'join');
        if (!joinBtn) return;

        state.handledEventMessages.add(message.id);
        trimHandledSet(state.handledEventMessages);

        await attemptJoinWithRetry(message, {
            kind: 'arena',
            name: 'Arena Event (join)',
            tag: 'Arena',
            buttonKeyword: 'join',
            joinCfg: config.arena,
        });
        return;
    }

    // 6. Deteksi kemunculan 6 jenis Epic Event
    if (allowEvents) {
        const eventTypes = [
            { match: 'an epic tree has just grown', name: 'Epic Tree (CUT)' },
            { match: 'a megalodon has spawned', name: 'Megalodon (LURE)' },
            { match: 'a lootbox summoning has started', name: 'Lootbox Summon (SUMMON)' },
            { match: "it's raining coins", name: 'Coin Rain (CATCH)' },
            { match: 'a legendary boss just spawned', name: 'Legendary Boss (FIGHT)' },
            { match: 'god accidentally dropped', name: 'GOD Coin (CATCH)' },
        ];

        const matchedEvent = eventTypes.find((ev) => combinedLower.includes(ev.match));
        if (!matchedEvent) return;

        const activeBtn = findActiveJoinButton(message);
        if (!activeBtn) return;

        state.handledEventMessages.add(message.id);
        trimHandledSet(state.handledEventMessages);

        await attemptJoinWithRetry(message, {
            kind: 'events',
            name: matchedEvent.name,
            tag: 'Event',
            buttonKeyword: null,
            joinCfg: config.events,
        });
    }
}

function trimHandledSet(setObj, maxSize = 150) {
    if (setObj.size > maxSize) {
        const firstId = setObj.values().next().value;
        setObj.delete(firstId);
    }
}

function getChannelMonitorFlags(channelId) {
    const isEventCh = (config.events?.channelIds || []).includes(channelId);
    const isArenaCh = (config.arena?.channelIds || []).includes(channelId);
    const isMinibossCh = (config.miniboss?.channelIds || []).includes(channelId);
    return {
        isEventCh,
        isArenaCh,
        isMinibossCh,
        allowEvents: isEventCh && !!config.events?.autoJoin,
        allowArena: isArenaCh && !!config.arena?.autoJoin,
        allowMiniboss: isMinibossCh && !!config.miniboss?.autoJoin,
    };
}

// Pantau juga messageUpdate karena event, arena & miniboss sering muncul/selesai via edit pesan
client.on('messageUpdate', async (_oldMsg, newMsg) => {
    if (state.isStopped || !newMsg.channel?.id) return;
    const flags = getChannelMonitorFlags(newMsg.channel.id);
    if (flags.allowEvents || flags.allowArena || flags.allowMiniboss) {
        await handleMonitoredChannelMessage(newMsg, flags);
    }
});

client.on('messageCreate', async (message) => {
    if (state.isStopped) return;

    const flags = getChannelMonitorFlags(message.channel.id);
    if (
        (flags.isEventCh || flags.isArenaCh || flags.isMinibossCh) &&
        message.channel.id !== config.channelId
    ) {
        await handleMonitoredChannelMessage(message, flags);
        return;
    }

    if (message.channel.id !== config.channelId) return;
    if (message.author.id !== config.epicRpgBotId) return;

    // Jika di channel pribadi muncul random event, arena, atau miniboss, ikut tangani sesuai toggle
    if (config.events?.autoJoin || config.arena?.autoJoin || config.miniboss?.autoJoin) {
        handleMonitoredChannelMessage(message, {
            allowEvents: !!config.events?.autoJoin,
            allowArena: !!config.arena?.autoJoin,
            allowMiniboss: !!config.miniboss?.autoJoin,
        }).catch(() => {});
    }

    const content = message.content || '';
    const lowerContent = content.toLowerCase();

    let embedText = '';
    let embedTitle = '';
    let embedDesc = '';
    if (message.embeds && message.embeds.length > 0) {
        const emb = message.embeds[0];
        embedTitle = emb.author?.name || emb.title || '';
        embedDesc = emb.description || '';
        embedText = [
            embedTitle,
            embedDesc,
            emb.footer?.text || '',
            ...(emb.fields ? emb.fields.map((f) => `${f.name}: ${f.value}`) : []),
        ].join(' ');
    }
    const combinedLower = `${lowerContent} ${embedText.toLowerCase()}`;

    // 1. Deteksi EPIC GUARD (wajib berhenti & minta user verifikasi manual di Discord)
    if (
        combinedLower.includes('epic guard') ||
        combinedLower.includes(':police_car:') ||
        combinedLower.includes('🚓') ||
        combinedLower.includes('stop there')
    ) {
        handleEpicGuard(content || embedText);
        return;
    }

    // 2. Deteksi & Jawab Otomatis Pertanyaan "rpg training" (5 lokasi)
    if (lowerContent.includes('is training in the')) {
        pushFeedLine(content.split('\n')[0]);
        await handleTrainingQuestion(message, content);
        return;
    }

    // 3. Deteksi Embed "rpg cd" (contoh: "<username> — cooldowns")
    if (embedTitle.toLowerCase().includes('cooldowns') && message.embeds[0]) {
        syncFromCooldownEmbed(message.embeds[0]);
        return;
    }

    // 4. Deteksi Embed "rpg inventory" (untuk membaca jumlah Ruby agar Mine Training akurat)
    if (embedTitle.toLowerCase().includes('inventory') && message.embeds[0]?.fields) {
        for (const f of message.embeds[0].fields) {
            const val = f.value || '';
            const rubyMatch = val.match(/\*\*ruby\*\*:\s*([\d,]+)/i);
            if (rubyMatch) {
                state.profile.rubies = parseInt(rubyMatch[1].replace(/,/g, ''), 10) || 0;
            } else if (
                f.name.toLowerCase().includes('items') &&
                !val.toLowerCase().includes('ruby')
            ) {
                state.profile.rubies = 0;
            }
        }
        notifyUi(`[*] Inventory diperbarui (Ruby: ${state.profile.rubies}).`, 3);
    }

    // 5. Sinkronisasi Cooldown tunggal jika command dikirim saat masih cooldown ("wait at least ...")
    if (combinedLower.includes('wait at least')) {
        const remainingMs = parseDurationMs(embedText || content);
        if (remainingMs) {
            if (combinedLower.includes('hunting')) {
                notifyUi('[*] Hunt masih cooldown, jadwal disinkronkan ulang.', 4);
                pushFeedLine(`Cooldown Hunt tersisa: ${Math.ceil(remainingMs / 1000)}s`);
                scheduleNext('hunt', remainingMs);
            } else if (combinedLower.includes('adventuring')) {
                notifyUi('[*] Adventure masih cooldown, jadwal disinkronkan ulang.', 4);
                pushFeedLine(`Cooldown Adventure tersisa: ${Math.ceil(remainingMs / 60000)}m`);
                scheduleNext('adventure', remainingMs);
            } else if (combinedLower.includes('training')) {
                notifyUi('[*] Training masih cooldown, jadwal disinkronkan ulang.', 4);
                scheduleNext('training', remainingMs);
            } else if (combinedLower.includes('working')) {
                notifyUi('[*] Work masih cooldown, jadwal disinkronkan ulang.', 4);
                scheduleNext('work', remainingMs);
            } else if (combinedLower.includes('farming')) {
                notifyUi('[*] Farm masih cooldown, jadwal disinkronkan ulang.', 4);
                scheduleNext('farm', remainingMs);
            } else if (combinedLower.includes('daily')) {
                notifyUi('[*] Daily masih cooldown, jadwal disinkronkan ulang.', 4);
                scheduleNext('daily', remainingMs);
            } else if (combinedLower.includes('weekly')) {
                state.passiveCdAt.weekly = Date.now() + remainingMs;
            } else if (combinedLower.includes('lootbox')) {
                notifyUi('[*] Lootbox masih cooldown, jadwal disinkronkan ulang.', 4);
                pushFeedLine(`Cooldown Lootbox tersisa: ${Math.ceil(remainingMs / 60000)}m`);
                scheduleNext('lootbox', remainingMs);
            } else if (combinedLower.includes('card')) {
                state.passiveCdAt.card_hand = Date.now() + remainingMs;
            } else if (combinedLower.includes('duel')) {
                state.passiveCdAt.duel = Date.now() + remainingMs;
            } else if (combinedLower.includes('quest')) {
                state.passiveCdAt.quest = Date.now() + remainingMs;
            } else if (combinedLower.includes('horse')) {
                state.passiveCdAt.horse = Date.now() + remainingMs;
            } else if (combinedLower.includes('arena')) {
                state.passiveCdAt.arena = Date.now() + remainingMs;
            } else if (combinedLower.includes('dungeon') || combinedLower.includes('miniboss')) {
                state.passiveCdAt.dungeon = Date.now() + remainingMs;
            } else if (state.lastSentCmd === 'rpg buy ed lb') {
                notifyUi('[*] Lootbox masih cooldown, jadwal disinkronkan ulang.', 4);
                scheduleNext('lootbox', remainingMs);
            }
        }
        return;
    }

    // 6. Parsing Profile Embed (saat startup, level up, atau user tekan 'u' / rpg p)
    if (embedTitle.toLowerCase().includes('profile') && message.embeds[0]?.fields) {
        for (const f of message.embeds[0].fields) {
            const fname = (f.name || '').toLowerCase();
            const val = f.value || '';

            const lvlMatch = val.match(/\*\*Level\*\*:\s*(\d+)/i);
            if (lvlMatch) state.profile.level = lvlMatch[1];

            const xpMatch = val.match(/\*\*XP\*\*:\s*([\d,]+)\s*\/\s*([\d,]+)/i);
            if (xpMatch) {
                state.profile.currentXp = parseInt(xpMatch[1].replace(/,/g, ''), 10) || 0;
                state.profile.maxXp = parseInt(xpMatch[2].replace(/,/g, ''), 10) || 1;
            }

            const areaMatch = val.match(/\*\*Area\*\*:\s*([^\n]+)/i);
            if (areaMatch) state.profile.area = areaMatch[1].trim();

            const atMatch = val.match(/\*\*AT\*\*:\s*([\d,]+)/i);
            if (atMatch) state.profile.at = atMatch[1];

            const defMatch = val.match(/\*\*DEF\*\*:\s*([\d,]+)/i);
            if (defMatch) state.profile.def = defMatch[1];

            const hpFieldMatch = val.match(/\*\*LIFE\*\*:\s*(\d+)\/(\d+)/i);
            if (hpFieldMatch) {
                const cHp = parseInt(hpFieldMatch[1], 10);
                const mHp = parseInt(hpFieldMatch[2], 10);
                const pct = mHp > 0 ? Math.round((cHp / mHp) * 100) : 100;
                state.profile.hpText = `${cHp}/${mHp} (${pct}%)`;
            }

            const coinsMatch = val.match(/\*\*Coins\*\*:\s*([\d,]+)/i);
            if (coinsMatch) {
                state.profile.coins = parseInt(coinsMatch[1].replace(/,/g, ''), 10) || 0;
            }

            const bankMatch = val.match(/\*\*Bank\*\*:\s*([\d,]+)/i);
            if (bankMatch) {
                state.profile.bank = parseInt(bankMatch[1].replace(/,/g, ''), 10) || 0;
            }

            if (fname.includes('equip')) {
                const eqLines = val
                    .split('\n')
                    .map((line) => {
                        const emojiNameMatch = line.match(/<:([a-zA-Z0-9_]+):\d+>/);
                        const bracketMatch = line.match(/\[([^\]]+)\]/);
                        const plainText = line
                            .replace(/<:[a-zA-Z0-9_]+:\d+>/g, '')
                            .replace(/\*\*/g, '')
                            .trim();
                        if (plainText && !plainText.startsWith('[')) {
                            return plainText;
                        }
                        if (emojiNameMatch && bracketMatch) {
                            const rawName = emojiNameMatch[1]
                                .replace(/sword$/i, '')
                                .replace(/armor$/i, '')
                                .replace(/tier(\d+)mount/i, 'HrsT$1')
                                .replace(/horse.*$/i, 'Hrs');
                            return `${rawName}[${bracketMatch[1]}]`;
                        }
                        if (bracketMatch) return `[${bracketMatch[1]}]`;
                        return plainText;
                    })
                    .filter(Boolean);
                if (eqLines.length > 0) {
                    state.profile.equipment = eqLines.join(' / ');
                }
            }
        }
        notifyUi('[*] Data Profile (Level, XP, Money, Equipment) diperbarui!', 3);
    }

    // 7. Tampilkan pesan hasil Hunt / Adventure / Training / Work di panel tengah
    if (content) {
        const lines = content.split('\n').filter((l) => l.trim().length > 0);
        for (const l of lines) {
            pushFeedLine(l);
        }

        const rewardMatch = content.match(/Earned\s+([\d,]+)\s+coins\s+and\s+([\d,]+)\s+XP/i);
        if (rewardMatch) {
            const coins = parseInt(rewardMatch[1].replace(/,/g, ''), 10) || 0;
            const xp = parseInt(rewardMatch[2].replace(/,/g, ''), 10) || 0;
            state.profile.sessionCoins += coins;
            state.profile.sessionXp += xp;
            if (state.profile.coins !== null) state.profile.coins += coins;
            if (state.profile.currentXp !== null) state.profile.currentXp += xp;
        } else {
            const trainXpMatch = content.match(/earned\s+([\d,]+)\s+xp/i);
            if (trainXpMatch) {
                const xp = parseInt(trainXpMatch[1].replace(/,/g, ''), 10) || 0;
                state.profile.sessionXp += xp;
                if (state.profile.currentXp !== null) state.profile.currentXp += xp;
            }
        }

        // Jika XP sudah melewati Max XP atau ada pesan level up, otomatis cek 'rpg p' untuk update level & batas XP baru
        if (
            lowerContent.includes('leveled up') ||
            lowerContent.includes('+1 level') ||
            (state.profile.maxXp && state.profile.currentXp >= state.profile.maxXp)
        ) {
            if (state.profile.maxXp && state.profile.currentXp >= state.profile.maxXp) {
                state.profile.currentXp = 0;
            }
            enqueueCommand('rpg p', 'profile');
        }

        const rubyGainMatch = content.match(/(\d+)\s+<:ruby:/i);
        if (rubyGainMatch && lowerContent.includes('got')) {
            state.profile.rubies += parseInt(rubyGainMatch[1], 10) || 0;
        }

        // Parse semua jenis item drop ("<username> got 2 pumpkins", "got 1 wooden log", "got an edgy lootbox")
        const dropMatch = content.match(/\bgot\s+([^\n!]+)/i);
        if (dropMatch && !lowerContent.includes('everyone got')) {
            const cleanDrop = dropMatch[1]
                .replace(/<:[a-zA-Z0-9_]+:\d+>/g, '')
                .replace(/\*\*/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (cleanDrop) {
                state.profile.lastDrop = cleanDrop;
                notifyUi(`[!] Dapat item: ${cleanDrop}!`, 4);
            }
        }
    } else if (embedTitle) {
        pushFeedLine(`[Embed] ${embedTitle}`);
    }

    // 7b. Deteksi hasil pembelian EDGY lootbox ('rpg buy ed lb')
    if (
        combinedLower.includes('edgy lootbox') &&
        (combinedLower.includes('bought') || combinedLower.includes('purchased'))
    ) {
        if (state.profile.coins !== null) {
            state.profile.coins = Math.max(0, state.profile.coins - 420666);
        }
        state.profile.lastDrop = 'EDGY lootbox (Shop)';
        notifyUi('[*] Berhasil membeli EDGY lootbox (-420.666 coins)!', 5);
        if (!content) {
            pushFeedLine('[Shop] Berhasil beli 1 EDGY lootbox (-420,666 coins)');
        }
    } else if (
        (combinedLower.includes("don't have enough coins") ||
            combinedLower.includes('not enough coins')) &&
        (combinedLower.includes('lootbox') || state.lastSentCmd === 'rpg buy ed lb')
    ) {
        if (state.stats.lootbox > 0) state.stats.lootbox--;
        notifyUi('[!] Koin kurang untuk beli EDGY lootbox (butuh 420.666 coins)!', 6);
        pushFeedLine('[Shop] Koin tidak cukup untuk beli EDGY lootbox (420,666 coins).');
    }

    // 8. Cek HP & Auto-Heal
    const hpMatch =
        content.match(/remaining HP is \*\*(\d+)\/(\d+)\*\*/i) ||
        content.match(/remaining HP is (\d+)\/(\d+)/i);

    if (hpMatch) {
        const currentHp = parseInt(hpMatch[1], 10);
        const maxHp = parseInt(hpMatch[2], 10);
        const hpPercent = Math.round((currentHp / maxHp) * 100);
        state.profile.hpText = `${currentHp}/${maxHp} (${hpPercent}%)`;

        if (config.safety.autoHeal && hpPercent <= config.safety.healBelowHpPercent) {
            notifyUi(`[!] HP ${hpPercent}% <= ${config.safety.healBelowHpPercent}%, Auto-Heal aktif!`, 5);
            enqueueCommand('rpg heal', 'heals', true);
        }
    } else if (lowerContent.includes('lost fighting') || lowerContent.includes('died')) {
        state.profile.hpText = '0 (DIED!)';
        notifyUi('[!] Karakter kalah bertarung! Mengirim rpg heal...', 8);
        if (config.safety.autoHeal) {
            enqueueCommand('rpg heal', 'heals', true);
        }
    } else if (lowerContent.includes('restored') && lowerContent.includes('life')) {
        state.profile.hpText = 'FULL (Healed)';
        notifyUi('[*] HP berhasil dipulihkan!', 3);
    }

    // 9. Auto-Buy Life Potion jika habis
    if (
        config.safety.autoHeal &&
        config.safety.autoBuyLifePotion &&
        lowerContent.includes("don't have a life potion")
    ) {
        const amt = config.safety.buyLifePotionAmount || 5;
        notifyUi(`[*] Life potion habis! Membeli ${amt} potion...`, 5);
        enqueueCommand(`rpg buy life potion ${amt}`, 'buy_potion', true);
        enqueueCommand('rpg heal', 'heals', false);
    }
});

// Handler interaktif untuk tombol keyboard di Live TUI
const tuiActions = {
    onTogglePause() {
        state.isPaused = !state.isPaused;
        if (state.isPaused) {
            notifyUi('[!] Bot PAUSED (dijeda). Tekan "p" lagi untuk lanjut.', 5);
            pushFeedLine('--- Bot Dijeda (PAUSED) ---');
        } else {
            notifyUi('[*] Bot RESUMED (dilanjutkan).', 4);
            pushFeedLine('--- Bot Dilanjutkan (RUNNING) ---');
        }
    },
    onToggleFeature(key) {
        const cmdCfg = config.commands[key];
        if (!cmdCfg) return;
        cmdCfg.enabled = !cmdCfg.enabled;
        const statusStr = cmdCfg.enabled ? 'ON' : 'OFF';
        notifyUi(`[*] Auto ${key.toUpperCase()} diubah ke: ${statusStr}`, 4);
        pushFeedLine(`[Config] Auto ${key.toUpperCase()} -> ${statusStr}`);

        if (cmdCfg.enabled) {
            const now = Date.now();
            const nextAt = state.nextRunAt[key];
            if (!nextAt || nextAt <= now) {
                enqueueCommand(cmdCfg.cmd, key);
                scheduleNext(key);
            } else {
                scheduleNext(key, nextAt - now);
            }
        } else {
            if (state.timers[key]) {
                clearTimeout(state.timers[key]);
                state.timers[key] = null;
            }
        }
    },
    onCycleWorkType() {
        const list = config.workCommandsList || [];
        if (list.length === 0) return;
        const currentCmd = config.commands.work.cmd;
        const idx = list.findIndex((item) => item.cmd === currentCmd);
        const nextItem = list[(idx + 1) % list.length];
        config.commands.work.cmd = nextItem.cmd;
        notifyUi(`[*] Work diganti ke: ${nextItem.label} ("${nextItem.cmd}")`, 5);
        pushFeedLine(`[Work] Jenis Work diubah ke: ${nextItem.label}`);
    },
    onToggleEvents() {
        config.events.autoJoin = !config.events.autoJoin;
        const statusStr = config.events.autoJoin ? 'ON' : 'OFF';
        notifyUi(`[*] Auto-Join Epic Events diubah ke: ${statusStr}`, 4);
        pushFeedLine(`[Config] Auto-Join Events -> ${statusStr}`);
    },
    onToggleArena() {
        config.arena.autoJoin = !config.arena.autoJoin;
        const statusStr = config.arena.autoJoin ? 'ON' : 'OFF';
        notifyUi(`[*] Auto-Join Arena diubah ke: ${statusStr}`, 4);
        pushFeedLine(`[Config] Auto-Join Arena -> ${statusStr}`);
    },
    onToggleMiniboss() {
        config.miniboss.autoJoin = !config.miniboss.autoJoin;
        const statusStr = config.miniboss.autoJoin ? 'ON' : 'OFF';
        notifyUi(`[*] Auto-Join Miniboss diubah ke: ${statusStr}`, 4);
        pushFeedLine(`[Config] Auto-Join Miniboss -> ${statusStr}`);
    },
    onToggleHeal() {
        config.safety.autoHeal = !config.safety.autoHeal;
        const statusStr = config.safety.autoHeal ? 'ON' : 'OFF';
        notifyUi(`[*] Auto-Heal diubah ke: ${statusStr}`, 4);
        pushFeedLine(`[Config] Auto-Heal -> ${statusStr}`);
    },
    onManualCommand(cmd, label) {
        notifyUi(`[*] Menjadwalkan manual command: "${cmd}"`, 3);
        if (cmd === 'rpg p') {
            enqueueCommand('rpg p', 'profile', false, true);
            enqueueCommand('rpg i', 'inv', false, true);
        } else {
            enqueueCommand(cmd, label, false, true);
        }
    },
    onQuit() {
        state.isStopped = true;
        Object.values(state.timers).forEach((t) => {
            if (t) clearTimeout(t);
        });
        if (tui) {
            tui.stop(chalk.yellow('\n[!] Bot dihentikan oleh pengguna (Quit).\n'));
        }
        client.destroy();
        process.exit(0);
    },
};

client.on('ready', async () => {
    state.profile.username = client.user.tag;

    try {
        state.targetChannel = await client.channels.fetch(config.channelId);
        state.profile.channelName = `#${state.targetChannel.name || config.channelId}`;
        notifyUi(`[*] Terhubung sebagai ${client.user.tag} di ${state.profile.channelName}`, 5);
        pushFeedLine(`Login berhasil: ${client.user.tag} (${state.profile.channelName})`);
    } catch (err) {
        if (tui) {
            tui.stop(
                chalk.red(
                    `\n[E] Gagal mengakses CHANNEL_ID (${config.channelId}): ${err.message}\n`
                )
            );
        }
        process.exit(1);
    }

    // Pre-fetch channel event, arena, & miniboss (dideduplikasi per channelId)
    const monitorRolesByChannel = new Map();
    const addRole = (ids, role) => {
        for (const chId of ids || []) {
            if (!monitorRolesByChannel.has(chId)) monitorRolesByChannel.set(chId, []);
            monitorRolesByChannel.get(chId).push(role);
        }
    };
    addRole(config.events?.channelIds, 'Event');
    addRole(config.arena?.channelIds, 'Arena');
    addRole(config.miniboss?.channelIds, 'Miniboss');

    for (const [chId, roles] of monitorRolesByChannel.entries()) {
        try {
            const chObj = await client.channels.fetch(chId);
            pushFeedLine(`[Monitor ${roles.join('+')}] Memantau #${chObj.name || chId}`);
        } catch (err) {
            pushFeedLine(`[Monitor ${roles.join('+')}] Gagal akses channel ${chId}: ${err.message}`);
        }
    }

    // Cek profile & inventory sekali di awal (untuk menampilkan Level, XP X/Y, Money, Equipment, dan Ruby) lalu cek Cooldown
    enqueueCommand('rpg p', 'profile');
    enqueueCommand('rpg i', 'inv');
    if (config.safety.syncCooldownOnStart) {
        enqueueCommand('rpg cd', 'cd');
    }

    // Jadwalkan command yang aktif di config.commands
    for (const [key, cmdCfg] of Object.entries(config.commands)) {
        if (cmdCfg.enabled && cmdCfg.cmd) {
            if (!config.safety.syncCooldownOnStart) {
                enqueueCommand(cmdCfg.cmd, key);
            }
            scheduleNext(key);
        }
    }
});

function startBot() {
    if (!config.token || config.token.trim() === '') {
        console.log(
            chalk.red.bold(
                '\n[E] TOKEN belum diisi! Silakan buka file .env dan isi TOKEN Discord kamu.\n'
            )
        );
        process.exit(1);
    }
    if (!config.channelId || config.channelId.trim() === '') {
        console.log(
            chalk.red.bold(
                '\n[E] CHANNEL_ID belum diisi! Silakan buka file .env dan isi CHANNEL_ID tempat bermain.\n'
            )
        );
        process.exit(1);
    }

    tui = new LiveTUI(state, config, tuiActions);
    tui.start();
    tui.notify('[*] Menghubungkan ke Discord Gateway...', 4);

    client.login(config.token).catch((err) => {
        if (tui) {
            tui.stop(
                chalk.red.bold(
                    `\n[E] Gagal login ke Discord. Cek kembali TOKEN di file .env!\nDetail: ${err.message}\n`
                )
            );
        }
        process.exit(1);
    });
}

// Anti-Crash: tangkap unhandledRejection (misal HTTP 400 / code 50035 dari clickButton saat event baru saja tutup)
process.on('unhandledRejection', (reason) => {
    const failedMsgId = reason?.requestData?.json?.message_id;
    const isExpiredInteraction =
        reason?.path === '/interactions' && (reason?.code === 50035 || reason?.httpStatus === 400);

    if (failedMsgId) {
        for (const pending of state.pendingJoinByChannel.values()) {
            if (pending.messageId === failedMsgId) {
                pending.expired = true;
            }
        }
    }

    if (isExpiredInteraction) {
        notifyUi('[!] Tombol event sudah ditutup sebelum diklik (expired).', 4);
        pushFeedLine('[Event] Tombol sudah ditutup/kadaluarsa sebelum diklik.');
        return;
    }

    const msg = reason?.message || String(reason);
    notifyUi(`[!] Peringatan async: ${msg}`, 4);
    pushFeedLine(`[WARN] ${msg}`);
});

process.on('uncaughtException', (err) => {
    notifyUi(`[!] Peringatan sistem: ${err.message}`, 5);
    pushFeedLine(`[ERR] ${err.message}`);
});

client.on('error', (err) => {
    notifyUi(`[!] Discord client error: ${err.message}`, 5);
    pushFeedLine(`[Client Error] ${err.message}`);
});

startBot();
