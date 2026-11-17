const { formatCompactCoins, formatCountdown, formatLocalTime } = require('./tui');

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Lightweight Telegram Bot API control panel using Node's native fetch().
 * Strictly locked to the configured TELEGRAM_CHAT_ID owner.
 */
class TelegramControl {
    constructor(state, config, actions, logger = {}) {
        this.state = state;
        this.config = config;
        this.actions = actions;
        this.logInfo = logger.info || (() => {});
        this.logError = logger.error || (() => {});

        this.botToken = config.telegram.botToken;
        this.chatId = String(config.telegram.chatId);
        this.pollTimeoutSec = config.telegram.pollTimeoutSec || 25;
        this.apiBase = `https://api.telegram.org/bot${this.botToken}`;

        this.offset = 0;
        this.panelMessageId = null;
        this.confirmingStop = false;
        this.stopped = false;
        this.pollAbortController = null;

        this.liveEnabled = config.telegram.liveAutoUpdate !== false;
        this.liveIntervalSec = config.telegram.liveIntervalSec || 12;
        this.liveInterval = null;
        this.activityDebounceTimer = null;
        this.lastEditAt = 0;
        this.backoffUntil = 0;
        this.isEditingPanel = false;
    }

    _redact(str) {
        if (!this.botToken) return String(str);
        return String(str).split(this.botToken).join('[REDACTED]');
    }

    async _callApi(method, payload = {}, externalSignal = null) {
        const timeoutMs =
            method === 'getUpdates' ? (this.pollTimeoutSec + 10) * 1000 : 15000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const onExternalAbort = () => controller.abort();
        if (externalSignal) {
            if (externalSignal.aborted) controller.abort();
            else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
        }

        try {
            const res = await fetch(`${this.apiBase}/${method}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });

            const data = await res.json();
            if (!data.ok) {
                const err = new Error(data.description || `Telegram API error (${res.status})`);
                if (data.parameters?.retry_after) {
                    err.retryAfterSec = Number(data.parameters.retry_after) || 5;
                }
                throw err;
            }
            return data.result;
        } finally {
            clearTimeout(timer);
            if (externalSignal) {
                externalSignal.removeEventListener('abort', onExternalAbort);
            }
        }
    }

    _formatTimer(key) {
        const cfg = this.config.commands[key];
        const nextAt = this.state.nextRunAt[key];
        const now = Date.now();
        if (!cfg || !cfg.enabled) {
            return nextAt && nextAt > now ? `${formatCountdown(nextAt - now)} (OFF)` : 'OFF';
        }
        if (this.state.isGuardLocked) return 'GUARD LOCK';
        if (this.state.isPaused) return 'PAUSED';
        return formatCountdown(nextAt ? Math.max(0, nextAt - now) : 0);
    }

    _formatPassiveTimer(key) {
        const nextAt = this.state.passiveCdAt?.[key];
        if (nextAt === undefined || nextAt === null) return '-';
        const rem = Math.max(0, nextAt - Date.now());
        return rem > 0 ? formatCountdown(rem) : 'READY';
    }

    buildPanelText() {
        const p = this.state.profile;
        const s = this.state.stats || {};
        let statusBadge = '🟢 RUNNING';
        if (this.state.isStopped) statusBadge = '🛑 STOPPED';
        else if (this.state.isGuardLocked) statusBadge = '🚨 EPIC GUARD LOCKED (Verify in Discord)';
        else if (this.state.isPaused) statusBadge = '⏸️ PAUSED';
        else if (this.state.isBusyWithPrompt) statusBadge = '🏋️ TRAINING...';
        else if (this.state.isProcessingQueue) statusBadge = '📤 SENDING';

        const xpPct =
            p.currentXp !== null && p.maxXp
                ? ` (${Math.min(100, Math.round((p.currentXp / p.maxXp) * 100))}%)`
                : '';
        const xpLine =
            p.currentXp !== null && p.maxXp
                ? `${p.currentXp.toLocaleString('en-US')}/${p.maxXp.toLocaleString('en-US')}${xpPct} [+${p.sessionXp.toLocaleString('en-US')}]`
                : `+${p.sessionXp.toLocaleString('en-US')} session XP`;

        const coinsLine =
            p.coins !== null
                ? `${formatCompactCoins(p.coins)} (Bank: ${formatCompactCoins(p.bank || 0)}) [+${p.sessionCoins.toLocaleString('en-US')}]`
                : `+${p.sessionCoins.toLocaleString('en-US')} session coins`;

        const workCmd = (this.config.commands.work.cmd || 'rpg axe')
            .replace(/^rpg\s+/i, '')
            .toUpperCase();

        const recentLines = this.state.recentLines.slice(-20).map((l) => {
            const sLine = String(l);
            const trimmed = sLine.length > 100 ? `${sLine.slice(0, 97)}...` : sLine;
            return `• <code>${escapeHtml(trimmed)}</code>`;
        });

        const modeLabel = this.config.runtime.headless ? 'Headless VM' : 'Live TUI';
        const nowStr = formatLocalTime(this.config.runtime.timezone);
        const liveLabel = this.liveEnabled ? `Live (${this.liveIntervalSec}s)` : 'Manual';

        const headerSection = [
            `⚔️ <b>EPIC RPG BOT — CONTROL PANEL</b>`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `<b>Status:</b> ${statusBadge}`,
            `👤 <b>Account:</b> ${escapeHtml(p.username)} (${escapeHtml(p.channelName || this.config.channelId)})`,
            `⭐ <b>Level:</b> ${escapeHtml(p.level)} | <b>Area:</b> ${escapeHtml(p.area)}`,
            `📊 <b>XP:</b> ${escapeHtml(xpLine)}`,
            `❤️ <b>HP:</b> ${escapeHtml(p.hpText)} | <b>AT:</b> ${escapeHtml(p.at)} <b>DEF:</b> ${escapeHtml(p.def)}`,
            `💰 <b>Money:</b> ${escapeHtml(coinsLine)}`,
            `🎒 <b>Equip:</b> ${escapeHtml(p.equipment)}`,
            `💎 <b>Ruby:</b> ${escapeHtml(p.rubies ?? 0)} | <b>Drop:</b> ${escapeHtml(p.lastDrop || 'None')}`,
            ``,
            `📈 <b>Session Stats</b>`,
            `• Hunt: <code>${s.hunt || 0}</code> | Adv/Trn: <code>${s.adventure || 0}/${s.training || 0}</code> | Work/Frm: <code>${s.work || 0}/${s.farm || 0}</code>`,
            `• Evt/Arn/MB: <code>${s.events || 0}/${s.arena || 0}/${s.miniboss || 0}</code> | LB/Heals: <code>${s.lootbox || 0}/${s.heals || 0}</code>`,
            ``,
            `⏱️ <b>Active Timers</b>`,
            `• Hunt: <code>${escapeHtml(this._formatTimer('hunt'))}</code> | Farm: <code>${escapeHtml(this._formatTimer('farm'))}</code>`,
            `• Adv: <code>${escapeHtml(this._formatTimer('adventure'))}</code> | LB: <code>${escapeHtml(this._formatTimer('lootbox'))}</code>`,
            `• Train: <code>${escapeHtml(this._formatTimer('training'))}</code> | Daily: <code>${escapeHtml(this._formatTimer('daily'))}</code>`,
            `• Work (${escapeHtml(workCmd)}): <code>${escapeHtml(this._formatTimer('work'))}</code>`,
            ``,
            `⏳ <b>Passive Cooldowns</b>`,
            `• Weekly: <code>${escapeHtml(this._formatPassiveTimer('weekly'))}</code> | Card: <code>${escapeHtml(this._formatPassiveTimer('card_hand'))}</code>`,
            `• Vote: <code>${escapeHtml(this._formatPassiveTimer('vote'))}</code> | Duel: <code>${escapeHtml(this._formatPassiveTimer('duel'))}</code>`,
            `• Quest: <code>${escapeHtml(this._formatPassiveTimer('quest'))}</code> | Horse: <code>${escapeHtml(this._formatPassiveTimer('horse'))}</code>`,
            `• Arena: <code>${escapeHtml(this._formatPassiveTimer('arena'))}</code> | Dungeon: <code>${escapeHtml(this._formatPassiveTimer('dungeon'))}</code>`,
            ``,
        ].join('\n');

        const footerSection = [
            `━━━━━━━━━━━━━━━━━━━━`,
            `Updated: <code>${nowStr}</code> | <code>${modeLabel}</code> | Sync: <code>${liveLabel}</code> | Q: <code>${this.state.queue.length}</code>`,
        ].join('\n');

        // Keep message strictly under Telegram's 4096-character limit
        const kept = [...recentLines];
        while (
            kept.length > 1 &&
            headerSection.length + kept.join('\n').length + footerSection.length + 40 > 3850
        ) {
            kept.shift();
        }

        const recentHeader = `📜 <b>Recent Activity (${kept.length})</b>`;
        const recentBlock = kept.length > 0 ? kept.join('\n') : '• <i>No activity yet</i>';
        return `${headerSection}\n${recentHeader}\n${recentBlock}\n${footerSection}`;
    }

    buildPanelKeyboard() {
        const sw = (v) => (v ? 'ON' : 'OFF');
        const cmds = this.config.commands;
        const workShort = (cmds.work.cmd || 'rpg axe').replace(/^rpg\s+/i, '').toUpperCase();

        if (this.confirmingStop) {
            return {
                inline_keyboard: [
                    [
                        { text: '✅ Yes, Stop Bot', callback_data: 'act:stop_confirm' },
                        { text: '❌ Cancel', callback_data: 'act:stop_cancel' },
                    ],
                ],
            };
        }

        const rows = [];

        if (this.state.isGuardLocked) {
            const guardRow = [];
            if (this.state.lastGuardUrl) {
                guardRow.push({ text: '🔗 Open Verify Channel', url: this.state.lastGuardUrl });
            }
            guardRow.push({
                text: '▶️ Resume (After Verify)',
                callback_data: 'act:resume_guard',
            });
            rows.push(guardRow);
        }

        const pauseLabel = this.state.isPaused || this.state.isGuardLocked ? '▶️ Resume' : '⏸️ Pause';

        rows.push(
            [
                { text: pauseLabel, callback_data: 'act:toggle_pause' },
                { text: '🔄 Refresh', callback_data: 'act:refresh' },
                { text: '⏱️ Sync CD', callback_data: 'act:sync_cd' },
            ],
            [
                { text: `⚔️ Hunt: ${sw(cmds.hunt.enabled)}`, callback_data: 'toggle:hunt' },
                { text: `🧭 Adv: ${sw(cmds.adventure.enabled)}`, callback_data: 'toggle:adventure' },
                { text: `🏋️ Train: ${sw(cmds.training.enabled)}`, callback_data: 'toggle:training' },
            ],
            [
                { text: `🪓 Work: ${sw(cmds.work.enabled)}`, callback_data: 'toggle:work' },
                { text: `🔁 ${workShort}`, callback_data: 'act:cycle_work' },
                { text: `🌾 Farm: ${sw(cmds.farm.enabled)}`, callback_data: 'toggle:farm' },
            ],
            [
                { text: `📦 LB: ${sw(cmds.lootbox.enabled)}`, callback_data: 'toggle:lootbox' },
                { text: `📅 Daily: ${sw(cmds.daily.enabled)}`, callback_data: 'toggle:daily' },
                { text: `🎉 Event: ${sw(this.config.events?.autoJoin)}`, callback_data: 'toggle:events' },
            ],
            [
                { text: `🏟️ Arena: ${sw(this.config.arena?.autoJoin)}`, callback_data: 'toggle:arena' },
                { text: `🗡️ MB: ${sw(this.config.miniboss?.autoJoin)}`, callback_data: 'toggle:miniboss' },
                { text: `❤️ Heal: ${sw(this.config.safety?.autoHeal)}`, callback_data: 'toggle:heal' },
            ],
            [
                { text: '💊 Heal Now', callback_data: 'act:heal_now' },
                { text: '👤 Profile', callback_data: 'act:check_profile' },
                { text: '🎁 Claim Daily', callback_data: 'act:claim_daily' },
            ],
            [
                {
                    text: this.liveEnabled ? `🟢 Live: ${this.liveIntervalSec}s` : '⚪ Live: OFF',
                    callback_data: 'act:toggle_live',
                },
                { text: '📜 Logs', callback_data: 'act:logs' },
                { text: '🛑 Stop Bot', callback_data: 'act:stop_prompt' },
            ]
        );

        return { inline_keyboard: rows };
    }

    async sendMessage(text, replyMarkup = null) {
        const payload = {
            chat_id: this.chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        return this._callApi('sendMessage', payload);
    }

    async sendOrUpdatePanel(forceNew = false, targetMessageId = null, isAuto = false) {
        if (this.isEditingPanel && isAuto) return;
        const text = this.buildPanelText();
        const replyMarkup = this.buildPanelKeyboard();
        const msgId = targetMessageId || this.panelMessageId;

        if (!forceNew && msgId) {
            this.isEditingPanel = true;
            try {
                await this._callApi('editMessageText', {
                    chat_id: this.chatId,
                    message_id: msgId,
                    text,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    reply_markup: replyMarkup,
                });
                this.panelMessageId = msgId;
                this.lastEditAt = Date.now();
                return;
            } catch (err) {
                if (err.message.includes('message is not modified')) {
                    this.lastEditAt = Date.now();
                    return;
                }
                if (err.retryAfterSec) {
                    this.backoffUntil = Date.now() + (err.retryAfterSec + 1) * 1000;
                    if (isAuto) return;
                }
                if (isAuto && err.message.includes('message to edit not found')) {
                    this.panelMessageId = null;
                    return;
                }
                if (isAuto) return;
            } finally {
                this.isEditingPanel = false;
            }
        }

        if (isAuto) return;
        const sent = await this.sendMessage(text, replyMarkup);
        if (sent?.message_id) {
            this.panelMessageId = sent.message_id;
            this.lastEditAt = Date.now();
        }
    }

    notifyActivity() {
        if (
            !this.liveEnabled ||
            !this.panelMessageId ||
            this.stopped ||
            this.confirmingStop ||
            this.activityDebounceTimer
        ) {
            return;
        }
        const now = Date.now();
        const minGapWait = Math.max(0, this.lastEditAt + 4000 - now);
        const backoffWait = Math.max(0, this.backoffUntil - now);
        const delayMs = Math.max(2500, minGapWait, backoffWait);

        this.activityDebounceTimer = setTimeout(() => {
            this.activityDebounceTimer = null;
            this._autoRefreshPanel();
        }, delayMs);
    }

    async _autoRefreshPanel() {
        if (
            !this.liveEnabled ||
            !this.panelMessageId ||
            this.stopped ||
            this.confirmingStop ||
            Date.now() < this.backoffUntil
        ) {
            return;
        }
        try {
            await this.sendOrUpdatePanel(false, this.panelMessageId, true);
        } catch (_) {}
    }

    async sendGuardAlert(reasonText, discordChannelUrl) {
        const snippet = escapeHtml(String(reasonText || '').slice(0, 300));
        const text = [
            `🚨 <b>EPIC GUARD DETECTED!</b>`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `All automation has been <b>PAUSED (LOCKED)</b> safely.`,
            ``,
            `<b>Details:</b>`,
            `<code>${snippet || 'EPIC GUARD check triggered'}</code>`,
            ``,
            `👉 <b>Next steps:</b>`,
            `1. Tap <b>Open Verify Channel</b> to open Discord and solve the verification manually.`,
            `2. Once cleared in Discord, tap <b>Resume (After Verify)</b> below.`,
        ].join('\n');

        const row1 = [];
        if (discordChannelUrl && discordChannelUrl.startsWith('https://discord.com/channels/')) {
            row1.push({ text: '🔗 Open Verify Channel', url: discordChannelUrl });
        }
        const row2 = [
            { text: '▶️ Resume (After Verify)', callback_data: 'act:resume_guard' },
            { text: '📊 Open Panel', callback_data: 'act:open_panel' },
        ];

        const keyboard = row1.length > 0 ? [row1, row2] : [row2];
        try {
            await this.sendMessage(text, { inline_keyboard: keyboard });
            if (this.panelMessageId) {
                await this.sendOrUpdatePanel(false, this.panelMessageId);
            }
        } catch (err) {
            this.logError(`[Telegram] Failed to send guard alert: ${this._redact(err.message)}`);
        }
    }

    async sendStartupNotice() {
        try {
            await this.sendOrUpdatePanel(true);
        } catch (err) {
            this.logError(`[Telegram] Failed to send startup panel: ${this._redact(err.message)}`);
        }
    }

    async _sendRecentLogs() {
        const lines = this.state.recentLines.slice(-25).map((l) => {
            const sLine = String(l);
            const trimmed = sLine.length > 120 ? `${sLine.slice(0, 117)}...` : sLine;
            return `• <code>${escapeHtml(trimmed)}</code>`;
        });
        while (lines.length > 1 && lines.join('\n').length > 3600) {
            lines.shift();
        }
        const body = lines.length > 0 ? lines.join('\n') : '<i>No activity logs yet.</i>';
        await this.sendMessage(`📜 <b>Recent Activity Logs (${lines.length})</b>\n\n${body}`, {
            inline_keyboard: [[{ text: '📊 Open Panel', callback_data: 'act:open_panel' }]],
        });
    }

    async _handleCommand(text) {
        const cmd = text.trim().split(/\s+/)[0].toLowerCase().split('@')[0];
        switch (cmd) {
            case '/start':
            case '/panel':
            case '/status':
                this.confirmingStop = false;
                await this.sendOrUpdatePanel(true);
                break;
            case '/pause':
                if (!this.state.isPaused) this.actions.onTogglePause();
                await this.sendOrUpdatePanel(true);
                break;
            case '/resume':
                if (this.state.isGuardLocked) {
                    this.actions.onResumeFromGuard();
                } else if (this.state.isPaused) {
                    this.actions.onTogglePause();
                }
                await this.sendOrUpdatePanel(true);
                break;
            case '/cd':
                if (this.state.isGuardLocked) {
                    await this.sendMessage('🚨 Locked by EPIC GUARD! Verify in Discord and /resume first.');
                    break;
                }
                this.actions.onManualCommand('rpg cd', 'cd');
                await this.sendMessage('⏱️ Queued <code>rpg cd</code>. Tap Refresh shortly.');
                break;
            case '/profile':
            case '/p':
                if (this.state.isGuardLocked) {
                    await this.sendMessage('🚨 Locked by EPIC GUARD! Verify in Discord and /resume first.');
                    break;
                }
                this.actions.onManualCommand('rpg p', 'profile');
                await this.sendMessage('👤 Queued <code>rpg p</code> &amp; <code>rpg i</code>.');
                break;
            case '/daily':
                if (this.state.isGuardLocked) {
                    await this.sendMessage('🚨 Locked by EPIC GUARD! Verify in Discord and /resume first.');
                    break;
                }
                this.actions.onManualCommand('rpg daily', 'daily');
                await this.sendMessage('🎁 Queued <code>rpg daily</code>.');
                break;
            case '/log':
            case '/logs':
                await this._sendRecentLogs();
                break;
            case '/live':
                this.liveEnabled = !this.liveEnabled;
                await this.sendOrUpdatePanel(false, this.panelMessageId);
                await this.sendMessage(
                    this.liveEnabled
                        ? `🟢 Live auto-update enabled (every ${this.liveIntervalSec}s + on activity).`
                        : '⚪ Live auto-update paused (use Refresh button anytime).'
                );
                break;
            case '/stop':
                this.confirmingStop = true;
                await this.sendOrUpdatePanel(true);
                break;
            case '/help':
                await this.sendMessage(
                    [
                        `🤖 <b>Telegram Control Commands</b>`,
                        `/panel — Open live button control panel`,
                        `/live — Toggle live auto-update ON/OFF`,
                        `/pause — Pause automation`,
                        `/resume — Resume automation (or unlock after manual EPIC GUARD verify)`,
                        `/cd — Sync cooldowns (rpg cd)`,
                        `/profile — Refresh profile &amp; inventory`,
                        `/daily — Claim daily (rpg daily)`,
                        `/logs — View last 25 activity lines`,
                        `/stop — Stop bot process safely`,
                    ].join('\n')
                );
                break;
            default:
                break;
        }
    }

    async _handleCallback(query) {
        const data = query.data || '';
        const msgId = query.message?.message_id || null;
        let toast = 'Updated';

        if (data === 'act:open_panel') {
            this.confirmingStop = false;
            await this.sendOrUpdatePanel(true);
            toast = 'Opened panel';
        } else if (data === 'act:resume_guard') {
            this.confirmingStop = false;
            if (this.state.isGuardLocked) {
                this.actions.onResumeFromGuard();
                toast = 'Resumed! Syncing cooldowns...';
            } else if (this.state.isPaused) {
                this.actions.onTogglePause();
                toast = 'Resumed!';
            } else {
                toast = 'Already running';
            }
            await this.sendOrUpdatePanel(false, this.panelMessageId || msgId);
        } else if (data === 'act:toggle_pause') {
            this.confirmingStop = false;
            if (this.state.isGuardLocked) {
                this.actions.onResumeFromGuard();
                toast = 'Guard unlocked & resumed!';
            } else {
                this.actions.onTogglePause();
                toast = this.state.isPaused ? 'Bot paused' : 'Bot resumed';
            }
            await this.sendOrUpdatePanel(false, msgId);
        } else if (data === 'act:refresh') {
            this.confirmingStop = false;
            await this.sendOrUpdatePanel(false, msgId);
            toast = 'Panel refreshed';
        } else if (data === 'act:sync_cd') {
            if (this.state.isGuardLocked) {
                toast = 'EPIC GUARD active! Verify in Discord first.';
            } else {
                this.actions.onManualCommand('rpg cd', 'cd');
                toast = 'Queued rpg cd';
            }
            await this.sendOrUpdatePanel(false, msgId);
        } else if (data === 'act:cycle_work') {
            this.actions.onCycleWorkType();
            await this.sendOrUpdatePanel(false, msgId);
            toast = `Work -> ${this.config.commands.work.cmd}`;
        } else if (data === 'act:heal_now') {
            if (this.state.isGuardLocked) {
                toast = 'EPIC GUARD active! Verify in Discord first.';
            } else {
                this.actions.onManualCommand('rpg heal', 'heals');
                toast = 'Queued rpg heal';
            }
            await this.sendOrUpdatePanel(false, msgId);
        } else if (data === 'act:check_profile') {
            if (this.state.isGuardLocked) {
                toast = 'EPIC GUARD active! Verify in Discord first.';
            } else {
                this.actions.onManualCommand('rpg p', 'profile');
                toast = 'Queued rpg p & rpg i';
            }
            await this.sendOrUpdatePanel(false, msgId);
        } else if (data === 'act:claim_daily') {
            if (this.state.isGuardLocked) {
                toast = 'EPIC GUARD active! Verify in Discord first.';
            } else {
                this.actions.onManualCommand('rpg daily', 'daily');
                toast = 'Queued rpg daily';
            }
            await this.sendOrUpdatePanel(false, msgId);
        } else if (data === 'act:toggle_live') {
            this.liveEnabled = !this.liveEnabled;
            await this.sendOrUpdatePanel(false, msgId);
            toast = this.liveEnabled
                ? `Live Auto-Update ON (${this.liveIntervalSec}s)`
                : 'Live Auto-Update OFF';
        } else if (data === 'act:logs') {
            await this._sendRecentLogs();
            toast = 'Sent recent logs';
        } else if (data === 'act:stop_prompt') {
            this.confirmingStop = true;
            await this.sendOrUpdatePanel(false, msgId);
            toast = 'Confirm stop?';
        } else if (data === 'act:stop_cancel') {
            this.confirmingStop = false;
            await this.sendOrUpdatePanel(false, msgId);
            toast = 'Cancelled';
        } else if (data === 'act:stop_confirm') {
            await this._callApi('answerCallbackQuery', {
                callback_query_id: query.id,
                text: 'Stopping bot...',
            }).catch(() => {});
            await this.sendMessage('🛑 Bot stopped remotely via Telegram.').catch(() => {});
            this.actions.onQuit();
            return;
        } else if (data.startsWith('toggle:')) {
            const target = data.slice('toggle:'.length);
            if (target === 'events') {
                this.actions.onToggleEvents();
                toast = `Events -> ${this.config.events.autoJoin ? 'ON' : 'OFF'}`;
            } else if (target === 'arena') {
                this.actions.onToggleArena();
                toast = `Arena -> ${this.config.arena.autoJoin ? 'ON' : 'OFF'}`;
            } else if (target === 'miniboss') {
                this.actions.onToggleMiniboss();
                toast = `Miniboss -> ${this.config.miniboss.autoJoin ? 'ON' : 'OFF'}`;
            } else if (target === 'heal') {
                this.actions.onToggleHeal();
                toast = `Auto-Heal -> ${this.config.safety.autoHeal ? 'ON' : 'OFF'}`;
            } else if (this.config.commands[target]) {
                this.actions.onToggleFeature(target);
                toast = `${target.toUpperCase()} -> ${this.config.commands[target].enabled ? 'ON' : 'OFF'}`;
            }
            await this.sendOrUpdatePanel(false, msgId);
        }

        await this._callApi('answerCallbackQuery', {
            callback_query_id: query.id,
            text: toast,
        }).catch(() => {});
    }

    start() {
        this.stopped = false;
        this.logInfo('[Telegram] Control panel polling started.');
        if (this.liveInterval) clearInterval(this.liveInterval);
        this.liveInterval = setInterval(() => {
            if (
                this.liveEnabled &&
                this.panelMessageId &&
                !this.stopped &&
                !this.confirmingStop &&
                Date.now() >= this.backoffUntil &&
                Date.now() - this.lastEditAt >= (this.liveIntervalSec - 1) * 1000
            ) {
                this._autoRefreshPanel();
            }
        }, this.liveIntervalSec * 1000);

        this._pollLoop().catch((err) => {
            if (!this.stopped) {
                this.logError(`[Telegram] Polling stopped unexpectedly: ${this._redact(err.message)}`);
            }
        });
    }

    stop() {
        this.stopped = true;
        if (this.liveInterval) {
            clearInterval(this.liveInterval);
            this.liveInterval = null;
        }
        if (this.activityDebounceTimer) {
            clearTimeout(this.activityDebounceTimer);
            this.activityDebounceTimer = null;
        }
        if (this.pollAbortController) {
            try {
                this.pollAbortController.abort();
            } catch (_) {}
        }
    }

    async _pollLoop() {
        const startedAtSec = Math.floor(Date.now() / 1000);

        while (!this.stopped) {
            try {
                this.pollAbortController = new AbortController();
                const updates = await this._callApi(
                    'getUpdates',
                    {
                        offset: this.offset,
                        timeout: this.pollTimeoutSec,
                        allowed_updates: ['message', 'callback_query'],
                    },
                    this.pollAbortController.signal
                );

                for (const upd of updates || []) {
                    this.offset = upd.update_id + 1;

                    if (upd.message) {
                        const fromChatId = String(upd.message.chat?.id || '');
                        const msgDate = upd.message.date || startedAtSec;
                        // Ignore unauthorized users and stale backlog messages older than 90s before startup
                        if (fromChatId !== this.chatId) continue;
                        if (msgDate < startedAtSec - 90) continue;
                        if (upd.message.text) {
                            await this._handleCommand(upd.message.text);
                        }
                    } else if (upd.callback_query) {
                        const fromChatId = String(upd.callback_query.message?.chat?.id || '');
                        if (fromChatId !== this.chatId) {
                            await this._callApi('answerCallbackQuery', {
                                callback_query_id: upd.callback_query.id,
                                text: 'Unauthorized',
                                show_alert: true,
                            }).catch(() => {});
                            continue;
                        }
                        await this._handleCallback(upd.callback_query);
                    }
                }
            } catch (err) {
                if (this.stopped || err.name === 'AbortError') break;
                this.logError(`[Telegram] Poll error: ${this._redact(err.message)}`);
                await sleep(3000);
            }
        }
    }
}

module.exports = { TelegramControl };
