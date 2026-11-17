const { Client } = require('discord.js-selfbot-v13');
const chalk = require('chalk');
const notifier = require('node-notifier');
const config = require('./config');
const { LiveTUI, sanitizeToSingleWidth, formatLocalTime } = require('./tui');
const { TelegramControl } = require('./telegram');

const client = new Client({
    checkUpdate: false,
});

const MINUTE_MS = 60 * 1000;

const state = {
    isStopped: false,
    isPaused: false,
    isGuardLocked: false,
    lastGuardReason: '',
    lastGuardUrl: '',
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
        'Connecting to Discord gateway...',
        'Discord window does not need focus / can stay minimized.',
    ],
};

let tui = null;
let telegramControl = null;

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp() {
    return formatLocalTime(config.runtime.timezone);
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
    } else if (!state.isGuardLocked && !state.isPaused && !state.isStopped) {
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
    const formatted = `[${timestamp()}] ${clean}`;
    state.recentLines.push(formatted);
    if (state.recentLines.length > 30) {
        state.recentLines.shift();
    }
    if (tui && tui.isAlive) {
        tui.render();
    } else {
        console.log(formatted);
    }
    if (telegramControl) {
        telegramControl.notifyActivity();
    }
}

function notifyUi(msg, prioSec = 4) {
    if (tui && tui.isAlive) {
        tui.notify(msg, prioSec);
    } else if (!String(msg).startsWith('[*] Sent "')) {
        console.log(`[${timestamp()}] ${msg}`);
    }
    if (telegramControl && String(msg).includes('updated!')) {
        telegramControl.notifyActivity();
    }
}

/**
 * Serialized command queue so commands never collide at the same second
 * or interrupt interactive prompts such as 'rpg training'
 */
function enqueueCommand(cmd, label = 'CMD', priority = false, manual = false) {
    if (state.isStopped || state.isGuardLocked) return;
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
    if (
        state.isProcessingQueue ||
        state.isStopped ||
        state.isGuardLocked ||
        state.isBusyWithPrompt
    ) {
        return;
    }
    state.isProcessingQueue = true;

    while (
        state.queue.length > 0 &&
        !state.isStopped &&
        !state.isGuardLocked &&
        !state.isBusyWithPrompt
    ) {
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
            pushFeedLine(`>>> Sent: ${cmd}`);
        } catch (err) {
            notifyUi(`[E] Failed to send "${cmd}": ${err.message}`, 6);
            pushFeedLine(`[ERROR] Failed to send ${cmd}: ${err.message}`);
        }

        const gap = randomInt(config.safety.queueGapMs.min, config.safety.queueGapMs.max);
        await sleep(gap);
    }

    state.isProcessingQueue = false;
    if (tui) tui.render();
}

/**
 * Schedules the next execution of a command with random jitter
 */
function scheduleNext(key, customDelayMs = null) {
    if (state.isStopped || state.isGuardLocked) return;
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
        if (state.isStopped || state.isGuardLocked) return;
        if (!state.isPaused && config.commands[key].enabled) {
            enqueueCommand(config.commands[key].cmd, key);
        }
        scheduleNext(key);
    }, totalWaitMs);

    if (tui) tui.render();
}

function extractMessageText(message) {
    const content = message?.content || '';
    const lowerContent = content.toLowerCase();

    let embedText = '';
    let embedTitle = '';
    let embedDesc = '';
    if (message?.embeds && message.embeds.length > 0) {
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
    return { content, lowerContent, embedText, embedTitle, embedDesc, combinedLower };
}

function isGuardOrJailAlert(combinedLower) {
    if (!combinedLower) return false;
    // Do not treat clearance confirmations ("Fine, I will let you go...") as a guard block
    if (
        combinedLower.includes('let you go') ||
        combinedLower.includes('be careful next time')
    ) {
        return false;
    }
    return (
        combinedLower.includes('epic guard') ||
        combinedLower.includes(':police_car:') ||
        combinedLower.includes('🚓') ||
        combinedLower.includes('stop there') ||
        combinedLower.includes('you are in the jail') ||
        combinedLower.includes('is now in the jail')
    );
}

/**
 * Locks and pauses all automation when EPIC GUARD or Jail is detected, alerting the user for manual verification
 */
function handleEpicGuard(reasonText, message = null) {
    if (state.isStopped || state.isGuardLocked) return;
    state.isGuardLocked = true;
    state.isPaused = true;

    for (const key of Object.keys(state.timers)) {
        if (state.timers[key]) {
            clearTimeout(state.timers[key]);
            state.timers[key] = null;
        }
    }
    if (state.busyTimeout) {
        clearTimeout(state.busyTimeout);
        state.busyTimeout = null;
    }
    state.isBusyWithPrompt = false;
    state.queue = [];

    const guildPart = message?.guildId || '@me';
    const chPart = message?.channel?.id || config.channelId;
    const msgPart = message?.id ? `/${message.id}` : '';
    const discordUrl = `https://discord.com/channels/${guildPart}/${chPart}${msgPart}`;

    state.lastGuardUrl = discordUrl;
    state.lastGuardReason = String(reasonText || '').slice(0, 300);

    pushFeedLine('🚨 EPIC GUARD DETECTED! Automation locked (manual verify needed).');
    notifyUi('[!] EPIC GUARD! Verify in Discord, then press "p" or Resume in Telegram.', 60);

    process.stdout.write('\x07');

    if (!config.runtime.headless && config.safety.desktopNotificationOnGuard) {
        notifier.notify({
            title: '🚨 EPIC GUARD Detected!',
            message:
                'Automation paused safely. Open Discord, complete verification manually, then Resume.',
            sound: true,
            wait: false,
        });
    }

    if (telegramControl) {
        telegramControl.sendGuardAlert(state.lastGuardReason, discordUrl);
    }

    if (tui) tui.render();
}

/**
 * Parses duration strings like "(1d 20h 4m 4s)" or "48m 20s" into milliseconds
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
 * Parses the full 'rpg cd' embed (e.g. "<username> — cooldowns")
 */
function syncFromCooldownEmbed(embed) {
    if (!embed || !embed.fields) return;
    const allLines = embed.fields.map((f) => f.value || '').join('\n').split('\n');

    const mapping = [
        // Active (automated by the bot)
        { regex: /\bdaily\b/i, type: 'active', key: 'daily' },
        { regex: /\bhunt\b/i, type: 'active', key: 'hunt' },
        { regex: /\badventure\b/i, type: 'active', key: 'adventure' },
        { regex: /\btraining\b/i, type: 'active', key: 'training' },
        { regex: /\bchop\b/i, type: 'active', key: 'work' },
        { regex: /\bfarm\b/i, type: 'active', key: 'farm' },
        { regex: /\blootbox\b/i, type: 'active', key: 'lootbox' },
        // Passive (status display & cooldown countdown)
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

    notifyUi('[*] All cooldowns synced from "rpg cd"!', 4);
    pushFeedLine('[CD Sync] Timers synchronized with EPIC RPG cooldowns embed.');
}

/**
 * Helper to click a Discord message button or fall back to sending chat text
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
                        notifyUi(`[*] Training (${labelInfo}) answered via button: ${fallbackText}`, 4);
                        pushFeedLine(`[Training ${labelInfo}] Clicked button: ${fallbackText}`);
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
            notifyUi(`[*] Training (${labelInfo}) answered via text: ${fallbackText}`, 4);
            pushFeedLine(`[Training ${labelInfo}] Sent text: ${fallbackText}`);
        } catch (err) {
            notifyUi(`[E] Failed to answer training: ${err.message}`, 5);
        }
    }

    await sleep(1200);
    setBusyLock(false);
}

/**
 * Automatically solves all 5 'rpg training' mini-game types
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
 * Finds an active (non-disabled) button on an Epic Event, Arena, or Miniboss message
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
 * Shared helper for Auto-Join (Events / Arena / Miniboss) with human-like delay and retries
 * when Discord returns "The application did not respond".
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
    notifyUi(`[*] ${tag} detected: ${name}! Clicking in ${(initDelay / 1000).toFixed(1)}s...`, 5);
    pushFeedLine(`[${tag}] Detected ${name}, attempting join...`);

    await sleep(initDelay);

    const maxRetries = joinCfg.maxRetries || 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (state.isStopped || state.isPaused) return;
        if (joinEntry.joined || joinEntry.expired) return;

        const latestMsg = message.channel?.messages?.cache?.get(message.id) || message;
        const btnNow = findActiveJoinButton(latestMsg, buttonKeyword);
        if (!btnNow) {
            pushFeedLine(`[${tag}] ${name} button already closed/ended.`);
            return;
        }

        try {
            await latestMsg.clickButton(btnNow.customId);
            if (!joinEntry.joined && !joinEntry.expired) {
                joinEntry.joined = true;
                if (state.stats[kind] !== undefined) state.stats[kind]++;
                if (tui) tui.render();
                notifyUi(`[*] Clicked ${name} button!`, 5);
                pushFeedLine(`[${tag}] Clicked ${btnNow.label || name} successfully.`);
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
                    `[!] ${tag} click failed (App didn't respond), retry ${attempt}/${maxRetries}...`,
                    4
                );
                pushFeedLine(
                    `[${tag}] App didn't respond, retrying click (${attempt}/${maxRetries})...`
                );
                await sleep(retryWait);
            } else {
                notifyUi(`[E] Failed to join ${name} after ${maxRetries} attempts.`, 5);
                pushFeedLine(`[${tag}] Failed clicking ${name}: ${err.message}`);
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
 * Handles monitored messages for Epic Events, Arena, and Miniboss across servers/channels
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

    // 1. Detect hidden/ephemeral confirmation ("Successfully joined!" / "already joined" / full)
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
        notifyUi(`[*] Discord confirmation: Successfully joined (${tag})!`, 5);
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
        notifyUi(`[!] ${tag}: full or already ended.`, 4);
        pushFeedLine(`[${tag}] Full / already ended, skipped join.`);
        return;
    }

    // 2. Detect Event / Arena / Miniboss rewards
    const ownNames = getOwnUsernamesLower();
    if (!state.handledEventRewards.has(message.id)) {
        // 2a. Epic Event result ("Players: ... Everyone got ...")
        if (combinedLower.includes('players:') && combinedLower.includes('everyone got')) {
            if (ownNames.some((n) => combinedLower.includes(n))) {
                state.handledEventRewards.add(message.id);
                const rewardMatch = embedText.match(/Everyone got\s+([^\n]+)/i);
                const rewardStr = rewardMatch
                    ? rewardMatch[1].replace(/\*\*/g, '').trim()
                    : 'Event Reward';
                state.profile.lastDrop = `Event: ${rewardStr}`;
                notifyUi(`[!] Event reward received: ${rewardStr}!`, 7);
                pushFeedLine(`🎉 [Event Reward] You got: ${rewardStr}`);
            }
            return;
        }

        // 2b. Arena result ("Ranking\n1. username (+23 🍪) - kills: ...")
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
                notifyUi(`[!] Arena finished! You earned ${rewardLabel}!`, 6);
                pushFeedLine(`🏟️ [Arena Result] You earned ${rewardLabel}!`);
            }
            return;
        }

        // 2c. Miniboss result ("... defeated ... helper(s) got X coins")
        if (
            combinedLower.includes('defeated') &&
            (combinedLower.includes('helper') || combinedLower.includes('players:')) &&
            ownNames.some((n) => combinedLower.includes(n))
        ) {
            state.handledEventRewards.add(message.id);
            const mbCoinsMatch = combinedLower.match(/(?:helper|got|earned)[^\d\n]*([\d,]+)\s*coins/i);
            const rewardLabel = mbCoinsMatch ? `+${mbCoinsMatch[1]} coins` : 'Miniboss Win';
            state.profile.lastDrop = `Miniboss: ${rewardLabel}`;
            notifyUi(`[!] Miniboss defeated! (${rewardLabel})`, 6);
            pushFeedLine(`🗡️ [Miniboss Result] Victory! (${rewardLabel})`);
            return;
        }
    }

    // 3. Prevent duplicate processing on the same button message
    if (state.handledEventMessages.has(message.id)) return;

    // 4. Detect Miniboss spawn ("<user> — miniboss" / "Type fight to help and get a reward!")
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

    // 5. Detect Arena Event ("started an arena event!" / "to join the arena!")
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

    // 6. Detect all 6 Epic Event types
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

// Also watch messageUpdate because events, arena, miniboss, and guard prompts can arrive/change via message edits
client.on('messageUpdate', async (_oldMsg, newMsg) => {
    if (state.isStopped || !newMsg.channel?.id) return;

    if (
        newMsg.channel.id === config.channelId &&
        newMsg.author?.id === config.epicRpgBotId
    ) {
        const { content, embedText, combinedLower } = extractMessageText(newMsg);
        if (isGuardOrJailAlert(combinedLower)) {
            handleEpicGuard(content || embedText, newMsg);
            return;
        }
    }

    if (state.isGuardLocked) return;
    const flags = getChannelMonitorFlags(newMsg.channel.id);
    if (flags.allowEvents || flags.allowArena || flags.allowMiniboss) {
        await handleMonitoredChannelMessage(newMsg, flags);
    }
});

client.on('messageCreate', async (message) => {
    if (state.isStopped || state.isGuardLocked) return;

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

    // If a random event, arena, or miniboss spawns in the main channel, handle it per toggles
    if (config.events?.autoJoin || config.arena?.autoJoin || config.miniboss?.autoJoin) {
        handleMonitoredChannelMessage(message, {
            allowEvents: !!config.events?.autoJoin,
            allowArena: !!config.arena?.autoJoin,
            allowMiniboss: !!config.miniboss?.autoJoin,
        }).catch(() => {});
    }

    const { content, lowerContent, embedText, embedTitle, combinedLower } =
        extractMessageText(message);

    // 1. EPIC GUARD / Jail detection (lock automation and alert user to verify manually in Discord)
    if (isGuardOrJailAlert(combinedLower)) {
        handleEpicGuard(content || embedText, message);
        return;
    }

    // 2. Detect & auto-solve "rpg training" questions (all 5 locations)
    if (lowerContent.includes('is training in the')) {
        pushFeedLine(content.split('\n')[0]);
        await handleTrainingQuestion(message, content);
        return;
    }

    // 3. Detect "rpg cd" embed (e.g. "<username> — cooldowns")
    if (embedTitle.toLowerCase().includes('cooldowns') && message.embeds[0]) {
        syncFromCooldownEmbed(message.embeds[0]);
        return;
    }

    // 4. Detect "rpg inventory" embed (reads Ruby count for Mine Training)
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
        notifyUi(`[*] Inventory updated (Ruby: ${state.profile.rubies}).`, 3);
    }

    // 5. Sync single command cooldown if sent while on cooldown ("wait at least ...")
    if (combinedLower.includes('wait at least')) {
        const remainingMs = parseDurationMs(embedText || content);
        if (remainingMs) {
            if (combinedLower.includes('hunting')) {
                notifyUi('[*] Hunt still on cooldown, timer resynced.', 4);
                pushFeedLine(`Hunt cooldown remaining: ${Math.ceil(remainingMs / 1000)}s`);
                scheduleNext('hunt', remainingMs);
            } else if (combinedLower.includes('adventuring')) {
                notifyUi('[*] Adventure still on cooldown, timer resynced.', 4);
                pushFeedLine(`Adventure cooldown remaining: ${Math.ceil(remainingMs / 60000)}m`);
                scheduleNext('adventure', remainingMs);
            } else if (combinedLower.includes('training')) {
                notifyUi('[*] Training still on cooldown, timer resynced.', 4);
                scheduleNext('training', remainingMs);
            } else if (combinedLower.includes('working')) {
                notifyUi('[*] Work still on cooldown, timer resynced.', 4);
                scheduleNext('work', remainingMs);
            } else if (combinedLower.includes('farming')) {
                notifyUi('[*] Farm still on cooldown, timer resynced.', 4);
                scheduleNext('farm', remainingMs);
            } else if (combinedLower.includes('daily')) {
                notifyUi('[*] Daily still on cooldown, timer resynced.', 4);
                scheduleNext('daily', remainingMs);
            } else if (combinedLower.includes('weekly')) {
                state.passiveCdAt.weekly = Date.now() + remainingMs;
            } else if (combinedLower.includes('lootbox')) {
                notifyUi('[*] Lootbox still on cooldown, timer resynced.', 4);
                pushFeedLine(`Lootbox cooldown remaining: ${Math.ceil(remainingMs / 60000)}m`);
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
                notifyUi('[*] Lootbox still on cooldown, timer resynced.', 4);
                scheduleNext('lootbox', remainingMs);
            }
        }
        return;
    }

    // 6. Parse Profile embed (on startup, level up, or user pressing 'u' / rpg p)
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
        notifyUi('[*] Profile data (Level, XP, Money, Equipment) updated!', 3);
    }

    // 7. Push Hunt / Adventure / Training / Work result lines to center activity feed
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

        // If XP exceeded Max XP or leveled up, refresh 'rpg p' to update Level & new XP cap
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

        // Parse item drops ("<username> got 2 pumpkins", "got 1 wooden log", "got an edgy lootbox")
        const dropMatch = content.match(/\bgot\s+([^\n!]+)/i);
        if (dropMatch && !lowerContent.includes('everyone got')) {
            const cleanDrop = dropMatch[1]
                .replace(/<:[a-zA-Z0-9_]+:\d+>/g, '')
                .replace(/\*\*/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (cleanDrop) {
                state.profile.lastDrop = cleanDrop;
                notifyUi(`[!] Item drop: ${cleanDrop}!`, 4);
            }
        }
    } else if (embedTitle) {
        pushFeedLine(`[Embed] ${embedTitle}`);
    }

    // 7b. Detect EDGY lootbox purchase result ('rpg buy ed lb')
    if (
        combinedLower.includes('edgy lootbox') &&
        (combinedLower.includes('bought') || combinedLower.includes('purchased'))
    ) {
        if (state.profile.coins !== null) {
            state.profile.coins = Math.max(0, state.profile.coins - 420666);
        }
        state.profile.lastDrop = 'EDGY lootbox (Shop)';
        notifyUi('[*] Purchased EDGY lootbox (-420,666 coins)!', 5);
        if (!content) {
            pushFeedLine('[Shop] Bought 1 EDGY lootbox (-420,666 coins)');
        }
    } else if (
        (combinedLower.includes("don't have enough coins") ||
            combinedLower.includes('not enough coins')) &&
        (combinedLower.includes('lootbox') || state.lastSentCmd === 'rpg buy ed lb')
    ) {
        if (state.stats.lootbox > 0) state.stats.lootbox--;
        notifyUi('[!] Not enough coins to buy EDGY lootbox (need 420,666 coins)!', 6);
        pushFeedLine('[Shop] Not enough coins for EDGY lootbox (420,666 coins).');
    }

    // 8. Check HP & Auto-Heal
    const hpMatch =
        content.match(/remaining HP is \*\*(\d+)\/(\d+)\*\*/i) ||
        content.match(/remaining HP is (\d+)\/(\d+)/i);

    if (hpMatch) {
        const currentHp = parseInt(hpMatch[1], 10);
        const maxHp = parseInt(hpMatch[2], 10);
        const hpPercent = Math.round((currentHp / maxHp) * 100);
        state.profile.hpText = `${currentHp}/${maxHp} (${hpPercent}%)`;

        if (config.safety.autoHeal && hpPercent <= config.safety.healBelowHpPercent) {
            notifyUi(`[!] HP ${hpPercent}% <= ${config.safety.healBelowHpPercent}%, Auto-Heal triggered!`, 5);
            enqueueCommand('rpg heal', 'heals', true);
        }
    } else if (lowerContent.includes('lost fighting') || lowerContent.includes('died')) {
        state.profile.hpText = '0 (DIED!)';
        notifyUi('[!] Character died in battle! Sending rpg heal...', 8);
        if (config.safety.autoHeal) {
            enqueueCommand('rpg heal', 'heals', true);
        }
    } else if (lowerContent.includes('restored') && lowerContent.includes('life')) {
        state.profile.hpText = 'FULL (Healed)';
        notifyUi('[*] HP restored!', 3);
    }

    // 9. Auto-Buy Life Potion when out of potions
    if (
        config.safety.autoHeal &&
        config.safety.autoBuyLifePotion &&
        lowerContent.includes("don't have a life potion")
    ) {
        const amt = config.safety.buyLifePotionAmount || 5;
        notifyUi(`[*] Out of life potions! Buying ${amt} potions...`, 5);
        enqueueCommand(`rpg buy life potion ${amt}`, 'buy_potion', true);
        enqueueCommand('rpg heal', 'heals', false);
    }
});

function startMainLoops(forceSyncCd = false) {
    if (state.isStopped || state.isGuardLocked) return;

    // Fetch profile & inventory once (Level, XP, Money, Equipment, Ruby) then sync cooldowns
    enqueueCommand('rpg p', 'profile');
    enqueueCommand('rpg i', 'inv');
    if (forceSyncCd || config.safety.syncCooldownOnStart) {
        enqueueCommand('rpg cd', 'cd');
    }

    // Schedule enabled commands from config.commands
    for (const [key, cmdCfg] of Object.entries(config.commands)) {
        if (cmdCfg.enabled && cmdCfg.cmd) {
            if (!forceSyncCd && !config.safety.syncCooldownOnStart) {
                enqueueCommand(cmdCfg.cmd, key);
            }
            scheduleNext(key);
        }
    }
}

async function checkInitialGuardState() {
    if (!config.safety.startupGuardCheck || !state.targetChannel) return false;
    try {
        const recent = await state.targetChannel.messages.fetch({ limit: 5 });
        const sorted = Array.from(recent.values()).sort(
            (a, b) => (b.createdTimestamp || 0) - (a.createdTimestamp || 0)
        );
        const now = Date.now();

        for (const msg of sorted) {
            if (msg.author?.id !== config.epicRpgBotId) continue;
            const { content, embedText, combinedLower } = extractMessageText(msg);

            if (
                combinedLower.includes('let you go') ||
                combinedLower.includes('be careful next time') ||
                combinedLower.includes('earned ') ||
                combinedLower.includes('found and killed') ||
                combinedLower.includes('cooldowns') ||
                combinedLower.includes('profile') ||
                combinedLower.includes('inventory') ||
                combinedLower.includes('is training in the')
            ) {
                return false;
            }

            if (isGuardOrJailAlert(combinedLower)) {
                const isJail =
                    combinedLower.includes('you are in the jail') ||
                    combinedLower.includes('is now in the jail');
                const isRecentPrompt = now - (msg.createdTimestamp || 0) < 120000;
                if (isJail || isRecentPrompt) {
                    handleEpicGuard(content || embedText, msg);
                    return true;
                }
                return false;
            }
        }
    } catch (err) {
        pushFeedLine(`[WARN] Startup guard check skipped: ${err.message}`);
    }
    return false;
}

// Interactive keyboard & remote control handlers
const tuiActions = {
    onTogglePause() {
        if (state.isGuardLocked) {
            tuiActions.onResumeFromGuard();
            return;
        }
        state.isPaused = !state.isPaused;
        if (state.isPaused) {
            notifyUi('[!] Bot PAUSED. Press "p" again to resume.', 5);
            pushFeedLine('--- Bot Paused (PAUSED) ---');
        } else {
            notifyUi('[*] Bot RESUMED.', 4);
            pushFeedLine('--- Bot Resumed (RUNNING) ---');
        }
    },
    onResumeFromGuard() {
        if (!state.isGuardLocked && !state.isPaused) return;
        state.isGuardLocked = false;
        state.isPaused = false;
        state.lastGuardReason = '';
        state.lastGuardUrl = '';
        notifyUi('[*] Guard lock cleared. Syncing profile & cooldowns...', 5);
        pushFeedLine('--- Guard unlocked manually. Resuming automation ---');
        startMainLoops(true);
        if (tui) tui.render();
    },
    onToggleFeature(key) {
        const cmdCfg = config.commands[key];
        if (!cmdCfg) return;
        cmdCfg.enabled = !cmdCfg.enabled;
        const statusStr = cmdCfg.enabled ? 'ON' : 'OFF';
        notifyUi(`[*] Auto ${key.toUpperCase()} set to: ${statusStr}`, 4);
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
        notifyUi(`[*] Work switched to: ${nextItem.label} ("${nextItem.cmd}")`, 5);
        pushFeedLine(`[Work] Work command switched to: ${nextItem.label}`);
    },
    onToggleEvents() {
        config.events.autoJoin = !config.events.autoJoin;
        const statusStr = config.events.autoJoin ? 'ON' : 'OFF';
        notifyUi(`[*] Auto-Join Epic Events set to: ${statusStr}`, 4);
        pushFeedLine(`[Config] Auto-Join Events -> ${statusStr}`);
    },
    onToggleArena() {
        config.arena.autoJoin = !config.arena.autoJoin;
        const statusStr = config.arena.autoJoin ? 'ON' : 'OFF';
        notifyUi(`[*] Auto-Join Arena set to: ${statusStr}`, 4);
        pushFeedLine(`[Config] Auto-Join Arena -> ${statusStr}`);
    },
    onToggleMiniboss() {
        config.miniboss.autoJoin = !config.miniboss.autoJoin;
        const statusStr = config.miniboss.autoJoin ? 'ON' : 'OFF';
        notifyUi(`[*] Auto-Join Miniboss set to: ${statusStr}`, 4);
        pushFeedLine(`[Config] Auto-Join Miniboss -> ${statusStr}`);
    },
    onToggleHeal() {
        config.safety.autoHeal = !config.safety.autoHeal;
        const statusStr = config.safety.autoHeal ? 'ON' : 'OFF';
        notifyUi(`[*] Auto-Heal set to: ${statusStr}`, 4);
        pushFeedLine(`[Config] Auto-Heal -> ${statusStr}`);
    },
    onManualCommand(cmd, label) {
        notifyUi(`[*] Queuing manual command: "${cmd}"`, 3);
        if (cmd === 'rpg p') {
            enqueueCommand('rpg p', 'profile', false, true);
            enqueueCommand('rpg i', 'inv', false, true);
        } else {
            enqueueCommand(cmd, label, false, true);
        }
    },
    onQuit() {
        if (state.isStopped) return;
        state.isStopped = true;
        Object.values(state.timers).forEach((t) => {
            if (t) clearTimeout(t);
        });
        if (state.busyTimeout) {
            clearTimeout(state.busyTimeout);
            state.busyTimeout = null;
        }
        if (telegramControl) {
            telegramControl.stop();
        }
        if (tui) {
            tui.stop(chalk.yellow('\n[!] Bot stopped by user (Quit).\n'));
        } else {
            console.log(chalk.yellow('\n[!] Bot stopped cleanly.\n'));
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
        notifyUi(`[*] Connected as ${client.user.tag} in ${state.profile.channelName}`, 5);
        pushFeedLine(`Logged in: ${client.user.tag} (${state.profile.channelName})`);
    } catch (err) {
        if (tui) {
            tui.stop(
                chalk.red(
                    `\n[E] Failed to access CHANNEL_ID (${config.channelId}): ${err.message}\n`
                )
            );
        } else {
            console.error(
                chalk.red(
                    `\n[E] Failed to access CHANNEL_ID (${config.channelId}): ${err.message}\n`
                )
            );
        }
        process.exit(1);
    }

    // Pre-fetch event, arena, and miniboss channels (deduplicated per channelId)
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
            pushFeedLine(`[Monitor ${roles.join('+')}] Watching #${chObj.name || chId}`);
        } catch (err) {
            pushFeedLine(`[Monitor ${roles.join('+')}] Failed to access channel ${chId}: ${err.message}`);
        }
    }

    const guardPendingOnStart = await checkInitialGuardState();
    if (!guardPendingOnStart) {
        startMainLoops(false);
    }

    if (telegramControl) {
        telegramControl.sendStartupNotice().catch(() => {});
    }
});

function startBot() {
    if (!config.token || config.token.trim() === '') {
        console.log(
            chalk.red.bold(
                '\n[E] TOKEN is missing! Please open your .env file and set your Discord TOKEN.\n'
            )
        );
        process.exit(1);
    }
    if (!config.channelId || config.channelId.trim() === '') {
        console.log(
            chalk.red.bold(
                '\n[E] CHANNEL_ID is missing! Please open your .env file and set your target CHANNEL_ID.\n'
            )
        );
        process.exit(1);
    }

    if (!config.runtime.headless) {
        tui = new LiveTUI(state, config, tuiActions);
        tui.start();
        tui.notify('[*] Connecting to Discord Gateway...', 4);
    } else {
        console.log(`[${timestamp()}] [*] Running in Headless / Non-TUI mode.`);
        console.log(`[${timestamp()}] [*] Connecting to Discord Gateway...`);
    }

    if (config.telegram.enabled) {
        telegramControl = new TelegramControl(state, config, tuiActions, {
            info: (msg) => pushFeedLine(msg),
            error: (msg) => pushFeedLine(msg),
        });
        telegramControl.start();
    } else if (config.runtime.headless) {
        console.log(
            `[${timestamp()}] [!] Telegram remote panel disabled (set TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID in .env to enable).`
        );
    }

    client.login(config.token).catch((err) => {
        const msg = `\n[E] Failed to log in to Discord. Check your TOKEN in .env!\nDetails: ${err.message}\n`;
        if (tui) {
            tui.stop(chalk.red.bold(msg));
        } else {
            console.error(chalk.red.bold(msg));
        }
        process.exit(1);
    });
}

process.on('SIGINT', () => tuiActions.onQuit());
process.on('SIGTERM', () => tuiActions.onQuit());

// Crash protection: catch unhandledRejection (e.g., HTTP 400 / code 50035 when an event button closes right before click)
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
        notifyUi('[!] Event button closed before click (expired).', 4);
        pushFeedLine('[Event] Button closed/expired before click.');
        return;
    }

    const msg = reason?.message || String(reason);
    notifyUi(`[!] Async warning: ${msg}`, 4);
    pushFeedLine(`[WARN] ${msg}`);
});

process.on('uncaughtException', (err) => {
    notifyUi(`[!] System error: ${err.message}`, 5);
    pushFeedLine(`[ERR] ${err.message}`);
});

client.on('error', (err) => {
    notifyUi(`[!] Discord client error: ${err.message}`, 5);
    pushFeedLine(`[Client Error] ${err.message}`);
});

startBot();
