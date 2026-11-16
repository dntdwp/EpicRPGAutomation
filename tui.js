const chalk = require('chalk');

const RECOMMENDED_COLS = 120;
const RECOMMENDED_ROWS = 30;
const MIN_FULL_COLS = 100;
const MIN_FULL_ROWS = 26;
const MIN_COMPACT_COLS = 68;
const MIN_COMPACT_ROWS = 20;

const LOGO_FULL = [
    ' ___  ___  ___  ___   ___  ___   ___ ',
    '| __|| _ \\|_ _|/ __| | _ \\| _ \\ / __|',
    '| _| |  _/ | || (__  |   /|  _/| (_ |',
    '|___||_|  |___|\\___| |_|_\\|_|   \\___|',
];

const LOGO_COMPACT = [
    ' ___  ___  ___   ___ ',
    '| __|| _ \\| _ \\ / __|',
    '| _| |   /|  _/| (_ |',
    '|___||_|_\\|_|   \\___|',
];

function stripAnsi(str) {
    return String(str).replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Replaces double-width emojis with 1-column ASCII tags and strips wide non-ASCII characters
 * so borders never shift or trigger line-wrap in Windows terminals.
 */
function sanitizeToSingleWidth(str) {
    return stripAnsi(str)
        .replace(/✅/g, '[OK]')
        .replace(/🎉/g, '[WIN]')
        .replace(/🏟️?/g, '[ARENA]')
        .replace(/🗡️?/g, '[FIGHT]')
        .replace(/🚨/g, '[!]')
        .replace(/🍪/g, ' cookies')
        .replace(/[\uFE00-\uFE0F\u200D]/g, '')
        .replace(/[\uD800-\uDFFF]/g, '')
        .replace(/[\u2300-\u27BF\u2B00-\u2BFF]/g, '')
        .replace(/[^\x20-\x7E]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function padOrTrim(str, maxLen) {
    const clean = sanitizeToSingleWidth(str);
    if (clean.length > maxLen) {
        if (maxLen <= 3) return clean.slice(0, maxLen);
        return clean.slice(0, maxLen - 3) + '...';
    }
    return clean;
}

function formatCompactCoins(num) {
    if (num === null || num === undefined) return '-';
    const abs = Math.abs(num);
    const units = [
        [1e18, 'Qi'],
        [1e15, 'Qa'],
        [1e12, 'T'],
        [1e9, 'B'],
    ];
    for (const [val, suffix] of units) {
        if (abs >= val) {
            return `${(num / val).toFixed(2)} ${suffix}`;
        }
    }
    return num.toLocaleString('en-US');
}

function formatCountdown(ms) {
    if (ms === null || ms === undefined) return 'OFF';
    if (ms <= 0) return 'READY';
    const totalSec = Math.ceil(ms / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (d > 0) {
        return `${d}d ${h}h ${m}m`;
    }
    if (h > 0) {
        return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    }
    if (m > 0) {
        return `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    }
    return `${String(s).padStart(2, '0')}s`;
}

class LiveTUI {
    constructor(state, config, actions) {
        this.state = state;
        this.config = config;
        this.actions = actions;

        this.isAlive = false;
        this.notifications = [];
        this.currentNotification = '';
        this.notificationTimer = null;
        this.renderInterval = null;

        this.width = process.stdout.columns || RECOMMENDED_COLS;
        this.height = process.stdout.rows || RECOMMENDED_ROWS;
    }

    notify(message, prioritySec = 4) {
        const cleanMsg = sanitizeToSingleWidth(String(message).replace(/\r?\n/g, ' '));
        if (!cleanMsg) return;
        if (prioritySec >= 10) {
            this.notifications.unshift({ message: cleanMsg, duration: prioritySec * 1000 });
        } else {
            this.notifications.push({ message: cleanMsg, duration: prioritySec * 1000 });
        }
        this._processNotifications();
    }

    _processNotifications() {
        if (this.notificationTimer || this.notifications.length === 0) return;
        const next = this.notifications.shift();
        this.currentNotification = next.message;
        this.notificationTimer = setTimeout(() => {
            this.currentNotification = '';
            this.notificationTimer = null;
            this._processNotifications();
        }, next.duration);
    }

    start() {
        if (this.isAlive) return;
        this.isAlive = true;

        // Enter Alternate Screen Buffer & hide cursor
        process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J');

        process.stdout.on('resize', () => {
            this.width = process.stdout.columns || RECOMMENDED_COLS;
            this.height = process.stdout.rows || RECOMMENDED_ROWS;
            process.stdout.write('\x1b[2J');
            this.render();
        });

        this._setupKeyboard();

        this.renderInterval = setInterval(() => {
            if (this.isAlive) this.render();
        }, 250);

        this.render();
    }

    stop(exitMessage = '') {
        if (!this.isAlive) return;
        this.isAlive = false;

        if (this.renderInterval) clearInterval(this.renderInterval);
        if (this.notificationTimer) clearTimeout(this.notificationTimer);

        if (process.stdin.isTTY) {
            try {
                process.stdin.setRawMode(false);
            } catch (_) {}
            process.stdin.pause();
        }

        // Exit Alternate Screen Buffer & restore cursor
        process.stdout.write('\x1b[?7h\x1b[?25h\x1b[?1049l');
        if (exitMessage) {
            console.log(exitMessage);
        }
    }

    _setupKeyboard() {
        if (!process.stdin.isTTY) return;
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');

        process.stdin.on('data', (key) => {
            if (!this.isAlive) return;

            // Ctrl+C or 'Q' to quit
            if (key === '\u0003' || key === 'Q') {
                this.actions.onQuit();
                return;
            }

            switch (key) {
                case 'p':
                case 'P':
                    this.actions.onTogglePause();
                    break;
                case 'h':
                case 'H':
                    this.actions.onToggleFeature('hunt');
                    break;
                case 'a':
                case 'A':
                    this.actions.onToggleFeature('adventure');
                    break;
                case 't':
                case 'T':
                    this.actions.onToggleFeature('training');
                    break;
                case 'w':
                case 'W':
                    this.actions.onToggleFeature('work');
                    break;
                case 'k':
                case 'K':
                    this.actions.onCycleWorkType();
                    break;
                case 'f':
                case 'F':
                    this.actions.onToggleFeature('farm');
                    break;
                case 'l':
                case 'L':
                    this.actions.onToggleFeature('lootbox');
                    break;
                case 'v':
                case 'V':
                    this.actions.onToggleEvents();
                    break;
                case 'r':
                case 'R':
                    this.actions.onToggleArena();
                    break;
                case 'm':
                case 'M':
                    this.actions.onToggleMiniboss();
                    break;
                case 'e':
                case 'E':
                    this.actions.onToggleHeal();
                    break;
                case 'd':
                case 'D':
                    this.actions.onManualCommand('rpg daily', 'daily');
                    break;
                case 'u':
                case 'U':
                    this.actions.onManualCommand('rpg p', 'profile');
                    break;
                case 'c':
                case 'C':
                    this.actions.onManualCommand('rpg cd', 'cd');
                    break;
                case 'x':
                case 'X':
                    this.actions.onManualCommand('rpg heal', 'heals');
                    break;
                default:
                    break;
            }
            this.render();
        });
    }

    _createGrid(w, h) {
        const grid = [];
        for (let r = 0; r < h; r++) {
            grid.push(new Array(w).fill(' '));
        }
        return grid;
    }

    _putStr(grid, y, x, text, keepBoxChars = false) {
        if (y < 0 || y >= grid.length) return;
        const clean = keepBoxChars ? stripAnsi(text) : sanitizeToSingleWidth(text);
        const row = grid[y];
        for (let i = 0; i < clean.length; i++) {
            const col = x + i;
            if (col >= 0 && col < row.length) {
                row[col] = clean[i];
            }
        }
    }

    _hline(grid, y, x, len, ch = '─') {
        if (y < 0 || y >= grid.length) return;
        const row = grid[y];
        for (let i = 0; i < len; i++) {
            const col = x + i;
            if (col >= 0 && col < row.length) {
                row[col] = ch;
            }
        }
    }

    _vline(grid, y, x, len, ch = '│') {
        if (x < 0 || x >= (grid[0]?.length || 0)) return;
        for (let i = 0; i < len; i++) {
            const r = y + i;
            if (r >= 0 && r < grid.length) {
                grid[r][x] = rowChar(grid[r][x], ch);
            }
        }
    }

    _getTimersList() {
        const now = Date.now();
        const result = [];
        const activeKeys = ['hunt', 'adventure', 'training', 'work', 'farm', 'lootbox', 'daily'];
        for (const k of activeKeys) {
            const cfg = this.config.commands[k];
            const nextAt = this.state.nextRunAt[k];
            if (!cfg || !cfg.enabled) {
                if (nextAt && nextAt > now) {
                    result.push([k.toUpperCase(), `${formatCountdown(nextAt - now)} (OFF)`]);
                } else {
                    result.push([k.toUpperCase(), 'OFF']);
                }
            } else if (this.state.isPaused) {
                result.push([k.toUpperCase(), 'PAUSED']);
            } else {
                const rem = nextAt ? Math.max(0, nextAt - now) : 0;
                result.push([k.toUpperCase(), formatCountdown(rem)]);
            }
        }

        const passiveKeys = [
            ['weekly', 'WEEKLY'],
            ['card_hand', 'CARD HAND'],
            ['vote', 'VOTE'],
            ['duel', 'DUEL'],
            ['quest', 'QUEST'],
            ['horse', 'HORSE BRD'],
            ['arena', 'ARENA'],
            ['dungeon', 'DUNGEON'],
        ];
        for (const [pk, label] of passiveKeys) {
            const nextAt = this.state.passiveCdAt?.[pk];
            if (nextAt !== undefined && nextAt !== null) {
                const rem = Math.max(0, nextAt - now);
                result.push([label, rem > 0 ? formatCountdown(rem) : 'READY']);
            } else {
                result.push([label, '-']);
            }
        }

        return result;
    }

    _getKeybindsList() {
        return [
            ['p', 'Pause / Resume'],
            ['h', 'Toggle Hunt'],
            ['a', 'Toggle Adventure'],
            ['t', 'Toggle Training'],
            ['w', 'Toggle Work'],
            ['k', 'Cycle Work Type'],
            ['f', 'Toggle Farm'],
            ['l', 'Toggle Auto-Lootbox'],
            ['v', 'Toggle Auto-Event'],
            ['r/m', 'Toggle Arena / MB'],
            ['e', 'Toggle Auto-Heal'],
            ['x', 'Manual Heal Now'],
            ['u', 'Check Profile/Inv'],
            ['c', 'Sync Cooldown (cd)'],
            ['d', 'Claim Daily'],
            ['Q', 'Quit (Shift+Q)'],
        ];
    }

    _getAppInfoList() {
        let dspStatus = 'RUNNING';
        if (this.state.isStopped) dspStatus = 'EPIC GUARD!';
        else if (this.state.isPaused) dspStatus = 'PAUSED';
        else if (this.state.isBusyWithPrompt) dspStatus = 'TRAINING...';
        else if (this.state.isProcessingQueue) dspStatus = 'SENDING';

        return [
            ['STATUS', dspStatus],
            ['HUNT STREAK', String(this.state.stats.hunt)],
            ['ADV / TRAIN', `${this.state.stats.adventure} / ${this.state.stats.training || 0}`],
            ['WORK / FARM', `${this.state.stats.work} / ${this.state.stats.farm || 0}`],
            ['EVT/ARN/MB', `${this.state.stats.events || 0} / ${this.state.stats.arena || 0} / ${this.state.stats.miniboss || 0}`],
            ['ED LB / HEALS', `${this.state.stats.lootbox || 0} / ${this.state.stats.heals}`],
            ['QUEUE', `${this.state.queue.length} cmd`],
        ];
    }

    _getProfileList(maxWidth = 56) {
        const p = this.state.profile;
        const xpPct =
            p.currentXp !== null && p.maxXp
                ? ` (${Math.min(100, Math.round((p.currentXp / p.maxXp) * 100))}%)`
                : '';
        const xpStr =
            p.currentXp !== null && p.maxXp
                ? `${p.currentXp.toLocaleString('en-US')}/${p.maxXp.toLocaleString('en-US')}${xpPct}`
                : `- (+${p.sessionXp.toLocaleString('en-US')} ses)`;

        let coinsStr;
        if (p.coins !== null) {
            const fullCoins = `${p.coins.toLocaleString('en-US')} (Bank: ${(p.bank || 0).toLocaleString('en-US')}) [+${p.sessionCoins.toLocaleString('en-US')}]`;
            if (`Money: ${fullCoins}`.length <= maxWidth) {
                coinsStr = fullCoins;
            } else {
                coinsStr = `${formatCompactCoins(p.coins)} (Bank: ${formatCompactCoins(p.bank || 0)}) [+${p.sessionCoins.toLocaleString('en-US')}]`;
            }
        } else {
            coinsStr = `+${p.sessionCoins.toLocaleString('en-US')} (session)`;
        }

        const statsStr =
            p.at !== '-' || p.def !== '-'
                ? `${p.hpText || '-'} | AT:${p.at} DEF:${p.def}`
                : p.hpText || '-';

        return [
            ['Account', `${p.username || 'Connecting...'} (${p.channelName || this.config.channelId})`],
            ['Level & Area', `${p.level || '-'} | Area: ${p.area || '-'}`],
            ['XP Progress', `${xpStr} [+${p.sessionXp.toLocaleString('en-US')}]`],
            ['HP & Stats', statsStr],
            ['Money', coinsStr],
            ['Equipment', p.equipment || '- (press "u" to check rpg p)'],
            ['Inv & Drop', `Ruby: ${p.rubies ?? 0} | Drop: ${p.lastDrop || 'None'}`],
        ];
    }

    _getConfigList() {
        const sw = (v) => (v ? 'ON' : 'OFF');
        const workShort = (this.config.commands.work.cmd || 'rpg chop').replace(/^rpg\s+/i, '');
        return [
            ['HUNT / ADV (h/a)', `${sw(this.config.commands.hunt.enabled)} / ${sw(this.config.commands.adventure.enabled)}`],
            ['TRN / FARM (t/f)', `${sw(this.config.commands.training?.enabled)} / ${sw(this.config.commands.farm?.enabled)}`],
            ['WORK (w/k)', `${sw(this.config.commands.work.enabled)} (${workShort.toUpperCase()})`],
            ['ED LB / DLY (l)', `${sw(this.config.commands.lootbox?.enabled)} / ${sw(this.config.commands.daily?.enabled)}`],
            ['EPIC EVENT (v)', sw(this.config.events?.autoJoin)],
            ['ARENA / MB (r/m)', `${sw(this.config.arena?.autoJoin)} / ${sw(this.config.miniboss?.autoJoin)}`],
            ['AUTO HEAL (e)', `${sw(this.config.safety.autoHeal)} (<=${this.config.safety.healBelowHpPercent}%)`],
        ];
    }

    /**
     * Terminal dimension verification:
     * Exact match only when w === 120 && h === 30 (neither smaller nor larger).
     * Never prints the target dimensions in the status badge.
     */
    _getTerminalVerification(w, h) {
        if (w === RECOMMENDED_COLS && h === RECOMMENDED_ROWS) {
            return {
                badge: 'Terminal: [EXACT FIT]',
                statusTag: '[EXACT FIT]',
                level: 'ok',
            };
        }

        const isLargerW = w > RECOMMENDED_COLS;
        const isLargerH = h > RECOMMENDED_ROWS;
        const isSmallerW = w < RECOMMENDED_COLS;
        const isSmallerH = h < RECOMMENDED_ROWS;

        let statusTag = '[MISMATCH]';
        let level = 'warn';

        if (w < MIN_COMPACT_COLS || h < MIN_COMPACT_ROWS) {
            statusTag = '[TOO SMALL]';
            level = 'bad';
        } else if (w < MIN_FULL_COLS || h < MIN_FULL_ROWS) {
            statusTag = '[COMPACT MODE]';
            level = 'bad';
        } else if (isLargerW && isLargerH) {
            statusTag = '[TOO LARGE]';
        } else if (isLargerW && !isSmallerH) {
            statusTag = '[TOO WIDE]';
        } else if (isLargerH && !isSmallerW) {
            statusTag = '[TOO TALL]';
        } else if (isSmallerW && isSmallerH) {
            statusTag = '[UNDERFIT]';
        } else if (isSmallerW && !isLargerH) {
            statusTag = '[TOO NARROW]';
        } else if (isSmallerH && !isLargerW) {
            statusTag = '[TOO SHORT]';
        } else {
            statusTag = '[MISMATCH]';
        }

        return {
            badge: `Terminal (${w}x${h}): ${statusTag}`,
            statusTag,
            level,
        };
    }

    render() {
        if (!this.isAlive) return;
        this.width = process.stdout.columns || RECOMMENDED_COLS;
        this.height = process.stdout.rows || RECOMMENDED_ROWS;

        const w = this.width;
        const h = this.height;
        const grid = this._createGrid(w, h);
        const termCheck = this._getTerminalVerification(w, h);

        if (w < MIN_COMPACT_COLS || h < MIN_COMPACT_ROWS) {
            const msg1 = '[TERMINAL TOO SMALL]';
            const msg2 = `Current size: ${w} x ${h} ${termCheck.statusTag}`;
            const msg3 = 'Resize the terminal window to display all panels.';
            this._putStr(grid, Math.floor(h / 2) - 1, Math.max(0, Math.floor((w - msg1.length) / 2)), msg1);
            this._putStr(grid, Math.floor(h / 2), Math.max(0, Math.floor((w - msg2.length) / 2)), msg2);
            this._putStr(grid, Math.floor(h / 2) + 1, Math.max(0, Math.floor((w - msg3.length) / 2)), msg3);
            this._flushGrid(grid);
            return;
        }

        const notifCount = this.notifications.length;
        const notifText =
            this.currentNotification ||
            'Nothing new. (Discord does not need focus / can minimize)';

        const badge = termCheck.badge;
        const showBadge = w >= badge.length + 12;
        const notifMaxLen = showBadge ? w - badge.length - 3 : w - 1;

        this._putStr(grid, 0, 0, padOrTrim(`(${notifCount}): ${notifText}`, notifMaxLen));
        if (showBadge) {
            this._putStr(grid, 0, w - badge.length, badge);
        }
        this._hline(grid, 1, 0, w, '─');

        if (w < MIN_FULL_COLS || h < MIN_FULL_ROWS) {
            this._renderCompact(grid, w, h);
        } else {
            this._renderFull(grid, w, h);
        }

        this._flushGrid(grid, showBadge ? termCheck : null);
    }

    _renderFull(grid, w, h) {
        const colWidth = Math.floor(w * 0.25);
        const rightColStart = w - colWidth;
        const bottomRowHeight = Math.max(10, Math.floor(h * 0.36));
        const bottomSplitY = h - bottomRowHeight;
        const midX = Math.floor(w / 2);
        const leftMidX = Math.floor(colWidth / 2);
        const rightMidX = rightColStart + Math.floor(colWidth / 2);

        this._vline(grid, 2, colWidth, h - 2, '│');
        this._vline(grid, 2, rightColStart, h - 2, '│');
        this._hline(grid, bottomSplitY, 0, w, '─');
        grid[1][colWidth] = '┬';
        grid[1][rightColStart] = '┬';
        grid[bottomSplitY][colWidth] = '┼';
        grid[bottomSplitY][rightColStart] = '┼';

        // 1. Center-top ASCII Art Logo
        const logoWidth = Math.max(...LOGO_FULL.map((l) => l.length));
        const logoStartX = Math.max(colWidth + 2, midX - Math.floor(logoWidth / 2));
        for (let i = 0; i < LOGO_FULL.length; i++) {
            this._putStr(grid, 2 + i, logoStartX, LOGO_FULL[i], true);
        }
        const logoBottomY = 2 + LOGO_FULL.length;
        this._hline(grid, logoBottomY, colWidth + 1, rightColStart - colWidth - 1, '─');
        grid[logoBottomY][colWidth] = '├';
        grid[logoBottomY][rightColStart] = '┤';

        const feedTitle = 'Latest Combat / Activity:';
        this._putStr(grid, logoBottomY + 1, midX - Math.floor(feedTitle.length / 2), feedTitle);

        // 2. Top-Left Panel: TIMERS & CD (ALL)
        const timerTitle = 'TIMERS & CD (ALL)';
        this._putStr(grid, 2, leftMidX - Math.floor(timerTitle.length / 2), timerTitle);
        const timers = this._getTimersList();
        const availRows = bottomSplitY - 3;
        const stepY = availRows >= timers.length * 2 ? 2 : 1;
        const startTimerY = availRows >= timers.length + 1 ? 4 : 3;
        for (let i = 0; i < timers.length; i++) {
            const [label, val] = timers[i];
            const y = startTimerY + i * stepY;
            if (y < bottomSplitY) {
                this._putStr(grid, y, 1, `${label}:`);
                this._putStr(grid, y, Math.max(11, colWidth - val.length - 1), val);
            }
        }

        // 3. Top-Right Panel: KEYBINDS
        const keyTitle = 'KEYBINDS';
        this._putStr(grid, 2, rightMidX - Math.floor(keyTitle.length / 2), keyTitle);
        const keybinds = this._getKeybindsList();
        const startKeyY = availRows >= keybinds.length + 1 ? 4 : 3;
        for (let i = 0; i < keybinds.length; i++) {
            const y = startKeyY + i;
            if (y < bottomSplitY) {
                const [k, desc] = keybinds[i];
                this._putStr(grid, y, rightColStart + 2, padOrTrim(`${k} - ${desc}`, colWidth - 3));
            }
        }

        // 4. Center Panel: Latest Messages / Combat Feed (left-aligned for clean timestamps)
        const msgPanelTop = logoBottomY + 3;
        const msgPanelBottom = bottomSplitY - 1;
        const msgPanelHeight = Math.max(1, msgPanelBottom - msgPanelTop);
        const msgMaxWidth = rightColStart - colWidth - 4;
        const items = this.state.recentLines.slice(-msgPanelHeight);
        const startY =
            msgPanelTop + Math.max(0, Math.floor((msgPanelHeight - items.length) / 2));

        for (let i = 0; i < items.length; i++) {
            const line = padOrTrim(items[i], msgMaxWidth);
            this._putStr(grid, startY + i, colWidth + 2, line);
        }

        // 5. Bottom-Left Panel: APP INFO
        const appTitle = 'APP INFO';
        this._putStr(grid, bottomSplitY + 1, leftMidX - Math.floor(appTitle.length / 2), appTitle);
        const appInfo = this._getAppInfoList();
        for (let i = 0; i < appInfo.length; i++) {
            const y = bottomSplitY + 3 + i;
            if (y < h) {
                const [k, v] = appInfo[i];
                this._putStr(grid, y, 1, padOrTrim(`${k}: ${v}`, colWidth - 2));
            }
        }

        // 6. Bottom-Center Panel: CHARACTER & STATS
        const profTitle = 'CHARACTER & STATS';
        this._putStr(grid, bottomSplitY + 1, midX - Math.floor(profTitle.length / 2), profTitle);
        const profInfo = this._getProfileList(msgMaxWidth);
        for (let i = 0; i < profInfo.length; i++) {
            const y = bottomSplitY + 3 + i;
            if (y < h) {
                const [k, v] = profInfo[i];
                this._putStr(grid, y, colWidth + 2, padOrTrim(`${k}: ${v}`, msgMaxWidth));
            }
        }

        // 7. Bottom-Right Panel: CONFIG STATUS
        const cfgTitle = 'CONFIG STATUS';
        this._putStr(grid, bottomSplitY + 1, rightMidX - Math.floor(cfgTitle.length / 2), cfgTitle);
        const cfgInfo = this._getConfigList();
        for (let i = 0; i < cfgInfo.length; i++) {
            const y = bottomSplitY + 3 + i;
            if (y < h) {
                const [k, v] = cfgInfo[i];
                this._putStr(grid, y, rightColStart + 2, padOrTrim(`${k}: ${v}`, colWidth - 3));
            }
        }
    }

    _renderCompact(grid, w, h) {
        const leftWidth = 26;
        const row1 = 2 + LOGO_COMPACT.length;
        const appInfo = this._getAppInfoList();
        const row2 = row1 + appInfo.length + 2;

        this._vline(grid, 2, leftWidth, h - 2, '│');
        this._hline(grid, row1, 0, leftWidth, '─');
        this._hline(grid, row2, 0, leftWidth, '─');

        for (let i = 0; i < LOGO_COMPACT.length; i++) {
            this._putStr(grid, 2 + i, 1, LOGO_COMPACT[i], true);
        }

        this._putStr(grid, row1, 8, 'APP INFO');
        for (let i = 0; i < appInfo.length; i++) {
            const [k, v] = appInfo[i];
            if (row1 + 1 + i < row2) {
                this._putStr(grid, row1 + 1 + i, 1, padOrTrim(`${k}: ${v}`, leftWidth - 2));
            }
        }

        this._putStr(grid, row2, 6, 'CONFIG STATUS');
        const cfgInfo = this._getConfigList();
        for (let i = 0; i < cfgInfo.length; i++) {
            const [k, v] = cfgInfo[i];
            if (row2 + 1 + i < h) {
                this._putStr(grid, row2 + 1 + i, 1, padOrTrim(`${k}: ${v}`, leftWidth - 2));
            }
        }

        const rightMaxWidth = w - leftWidth - 4;
        const items = this.state.recentLines.slice(-(h - 4));
        const startY = Math.max(3, Math.floor((h - items.length) / 2));
        for (let i = 0; i < items.length; i++) {
            const line = padOrTrim(items[i], rightMaxWidth);
            this._putStr(grid, startY + i, leftWidth + 2, line);
        }
    }

    _flushGrid(grid, termCheck = null) {
        // Explicit row positioning + disable line-wrap + synchronized output to prevent flicker/scroll
        let out = '\x1b[?2026h\x1b[?7l';
        for (let r = 0; r < grid.length; r++) {
            let line = grid[r].join('');
            if (r === 0 && termCheck && line.endsWith(termCheck.badge)) {
                const prefix = line.slice(0, line.length - termCheck.badge.length);
                const badgeBody = termCheck.badge.slice(
                    0,
                    termCheck.badge.length - termCheck.statusTag.length
                );
                let coloredTag = termCheck.statusTag;
                if (termCheck.level === 'ok') coloredTag = chalk.green.bold(termCheck.statusTag);
                else if (termCheck.level === 'warn') coloredTag = chalk.yellow.bold(termCheck.statusTag);
                else coloredTag = chalk.red.bold(termCheck.statusTag);
                line = prefix + chalk.gray(badgeBody) + coloredTag;
            }
            out += `\x1b[${r + 1};1H\x1b[2K${line}`;
        }
        out += '\x1b[?7h\x1b[?2026l';
        process.stdout.write(out);
    }
}

function rowChar(existing, incoming) {
    if (existing === '─') return '┼';
    return incoming;
}

module.exports = { LiveTUI, sanitizeToSingleWidth };
