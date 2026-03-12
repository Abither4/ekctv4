// === StreamVault - EKC TV V4 ===
// Dual DNS: Marble (pradahype.com) + Premium (pinkponyclub.online)
// + Stremio Panel

// CORS proxy for browser requests — set this to your Cloudflare Worker URL
const CORS_PROXY = localStorage.getItem('sv_cors_proxy') || 'https://ekctv-proxy.YOURACCOUNT.workers.dev';

function proxyUrl(url) {
    if (!url || !CORS_PROXY) return url;
    // Don't proxy relative URLs, data URIs, or blob URLs
    if (!url.startsWith('http')) return url;
    // Don't double-proxy
    if (url.includes(CORS_PROXY.replace('https://', '').replace('http://', ''))) return url;
    return `${CORS_PROXY}/?url=${encodeURIComponent(url)}`;
}

const DNS = {
    marble: { name: 'Marble', url: 'https://pradahype.com', color: 'marble' },
    pony:   { name: 'Premium', url: 'https://pinkponyclub.online', color: 'pony' }
};

const App = {
    session: null,
    servers: {},       // { marble: { connected, userInfo, serverInfo }, pony: { ... } }
    currentPage: 'live',
    currentSource: 'marble',  // 'marble', 'pony'
    categories: [],
    streams: [],
    favorites: JSON.parse(localStorage.getItem('sv_favorites') || '[]'),
    recentlyViewed: JSON.parse(localStorage.getItem('sv_recently_viewed') || '[]'),
    stremioAddons: [],
    premiumizeKey: localStorage.getItem('sv_premiumize') || 'esx99bfad8pr88bk',

    // Default Stremio addons (always available)
    defaultStremioAddons: [
        {
            url: 'https://v3-cinemeta.strem.io',
            name: 'Cinemeta',
            manifest: {
                id: 'com.linvo.cinemeta',
                name: 'Cinemeta',
                types: ['movie', 'series'],
                catalogs: [
                    { type: 'movie', id: 'top', name: 'Popular Movies', extra: [{ name: 'search' }, { name: 'genre' }, { name: 'skip' }] },
                    { type: 'series', id: 'top', name: 'Popular Series', extra: [{ name: 'search' }, { name: 'genre' }, { name: 'skip' }] },
                    { type: 'movie', id: 'year', name: 'New Movies' },
                    { type: 'series', id: 'year', name: 'New Series' }
                ]
            }
        },
        {
            url: 'https://torrentio.strem.fun',
            name: 'Torrentio',
            manifest: {
                id: 'com.strem.torrentio',
                name: 'Torrentio',
                types: ['movie', 'series'],
                catalogs: [],
                resources: ['stream']
            }
        },
        {
            url: 'https://comet.elfhosted.com',
            name: 'Comet',
            manifest: {
                id: 'com.elfhosted.comet',
                name: 'Comet',
                types: ['movie', 'series'],
                catalogs: [],
                resources: ['stream']
            }
        }
    ],

    epgChannels: [],
    epgAllChannels: [],
    epgCategories: [],
    epgData: {},
    epgDateOffset: 0,
    epgStartHour: 0,
    epgSource: 'marble',
    epgCategory: 'all',
    EPG_HOURS: 24,
    PX_PER_MIN: 3.33, // pixels per minute (200px per 60min)

    // Global loading overlay
    showLoader() { document.getElementById('globalLoader').classList.remove('hidden'); },
    hideLoader() { document.getElementById('globalLoader').classList.add('hidden'); },

    init() {
        // Auto-clear caches every 24 hours
        const lastClear = parseInt(localStorage.getItem('sv_cache_cleared') || '0');
        const now = Date.now();
        if (now - lastClear > 24 * 60 * 60 * 1000) {
            this.epgCache = {};
            this.epgData = {};
            this.epgAllChannels = [];
            this.categories = [];
            this.streams = [];
            if ('caches' in window) {
                caches.keys().then(names => names.forEach(n => caches.delete(n)));
            }
            localStorage.setItem('sv_cache_cleared', String(now));
            console.log('[Init] 24h cache clear');
        }

        // Merge default + user-saved addons (deduplicate by url)
        try {
            const saved = JSON.parse(localStorage.getItem('sv_addons') || '[]');
            const allAddons = [...this.defaultStremioAddons];
            saved.forEach(a => {
                if (!allAddons.some(d => d.url === a.url)) allAddons.push(a);
            });
            this.stremioAddons = allAddons;
        } catch(e) {
            console.error('[Init] Failed to load addons:', e);
            this.stremioAddons = [...this.defaultStremioAddons];
        }

        this.bindEvents();

        // Pre-fill login if we have a saved session, but always show login screen
        try {
            const savedSession = JSON.parse(localStorage.getItem('sv_session'));
            if (savedSession) {
                document.getElementById('loginUser').value = savedSession.username || '';
                document.getElementById('loginPass').value = savedSession.token || '';
                console.log('[Init] Pre-filled saved credentials for:', savedSession.username);
            }
        } catch(e) {
            console.error('[Init] Failed to read saved session:', e);
        }
        // Clear stale server data - user must click Connect
        localStorage.removeItem('sv_servers');
    },

    bindEvents() {
        document.getElementById('btnConnect').addEventListener('click', () => this.handleLogin());
        document.querySelectorAll('.login-form input').forEach(input => {
            input.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.handleLogin(); });
        });

        // Home screen tiles
        document.querySelectorAll('.home-tile').forEach(tile => {
            tile.addEventListener('click', () => {
                this.openSection(tile.dataset.page);
            });
        });

        // Home button (logo in top nav)
        document.getElementById('btnHome').addEventListener('click', () => this.showHome());

        // Top nav tabs
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.navigateTo(btn.dataset.page);
            });
        });

        // Source toggle (sidebar)
        document.querySelectorAll('.source-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentSource = btn.dataset.source;
                // Sync EPG source buttons too
                document.querySelectorAll('.epg-src-btn').forEach(b => b.classList.remove('active'));
                const epgBtn = document.querySelector(`.epg-src-btn[data-epg-source="${btn.dataset.source}"]`);
                if (epgBtn) epgBtn.classList.add('active');
                this.filterBySource();
            });
        });

        document.getElementById('btnBack').addEventListener('click', () => this.goBack());
        document.getElementById('btnClosePlayer').addEventListener('click', () => this.closePlayer());
        document.getElementById('btnCloseTrailer').addEventListener('click', () => this.closeTrailer());
        document.getElementById('btnMediaDetailClose').addEventListener('click', () => this.closeMediaDetail());
        document.getElementById('btnFullscreen').addEventListener('click', () => {
            const v = document.getElementById('videoPlayer');
            if (v.requestFullscreen) v.requestFullscreen();
        });
        document.getElementById('btnFavorite').addEventListener('click', () => this.toggleCurrentFavorite());
        document.getElementById('searchInput').addEventListener('input', (e) => this.handleSearch(e.target.value));
        // Stremio tab navigation
        document.querySelectorAll('.stremio-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.stremio-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.switchStremioTab(tab.dataset.stab);
            });
        });
        document.getElementById('btnStremioDetailClose').addEventListener('click', () => this.closeStremioDetail());
        document.getElementById('stremioSearch').addEventListener('input', (e) => this.handleStremioSearch(e.target.value));

        // EPG clock + timezone picker
        this._userTz = localStorage.getItem('sv_timezone') || 'America/Chicago';
        this._startEpgClock();

        document.getElementById('epgClock').addEventListener('click', () => this._openTzPicker());
        document.querySelectorAll('.tz-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this._userTz = btn.dataset.tz;
                localStorage.setItem('sv_timezone', this._userTz);
                document.getElementById('tzModal').classList.add('hidden');
                this._updateEpgClock();
                // Highlight active
                document.querySelectorAll('.tz-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
        // Close modal on backdrop click
        document.getElementById('tzModal').addEventListener('click', (e) => {
            if (e.target.id === 'tzModal') e.target.classList.add('hidden');
        });

        // EPG category chips (delegated)
        document.getElementById('epgCatBar').addEventListener('click', (e) => {
            const chip = e.target.closest('.epg-cat-chip');
            if (!chip) return;
            document.querySelectorAll('.epg-cat-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            this.epgCategory = chip.dataset.cat;
            this.renderEpgFiltered();
        });

        document.querySelectorAll('.epg-src-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.epg-src-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentSource = btn.dataset.epgSource;
                this.epgSource = btn.dataset.epgSource;
                // Sync sidebar source buttons
                document.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
                const sidebarBtn = document.querySelector(`.source-btn[data-source="${btn.dataset.epgSource}"]`);
                if (sidebarBtn) sidebarBtn.classList.add('active');
                this.loadCategories('live');
                this.loadEpg();
            });
        });

        // === Keyboard / Remote Control Navigation ===
        this._focusedIdx = -1;
        this._focusZone = 'content'; // 'nav', 'sidebar', 'content'
        document.addEventListener('keydown', (e) => this.handleRemoteKey(e));
        // Track last focused zone per page so we restore correctly
        this._navIdx = 0;

        // When exiting fullscreen (back button on remote/browser), close the player
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement) {
                const playerOpen = !document.getElementById('playerOverlay').classList.contains('hidden');
                if (playerOpen) {
                    this.closePlayer();
                }
            }
        });

        // Browser back button → go to home screen
        window.addEventListener('popstate', (e) => {
            const playerOpen = !document.getElementById('playerOverlay').classList.contains('hidden');
            if (playerOpen) {
                this.closePlayer();
            } else if (document.getElementById('mainScreen').classList.contains('active')) {
                this.showHome();
            }
        });
    },

    // ============================================================
    // Remote control & keyboard handler (Onn 4K Pro / Android TV)
    // Full D-pad navigation: arrow keys to move, Enter to select,
    // Back/Escape to go back. Works on every screen.
    // ============================================================
    handleRemoteKey(e) {
        const key = e.key;

        // If an input field is focused, let it handle keys normally
        // except Escape which we capture to blur
        const active = document.activeElement;
        const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
        if (isInput) {
            if (key === 'Escape') { active.blur(); e.preventDefault(); }
            return;
        }

        // Timezone modal open? Handle its navigation
        const tzModal = document.getElementById('tzModal');
        if (tzModal && !tzModal.classList.contains('hidden')) {
            this._handleTzModalKeys(e);
            return;
        }

        // Trailer overlay open? (highest priority since it's on top)
        const trailerOpen = !document.getElementById('trailerOverlay').classList.contains('hidden');
        if (trailerOpen) {
            if (key === 'Escape' || key === 'Backspace' || key === 'GoBack') {
                e.preventDefault();
                this.closeTrailer();
            }
            return;
        }

        // Media detail modal open?
        const mediaDetailOpen = !document.getElementById('mediaDetailModal').classList.contains('hidden');
        if (mediaDetailOpen) {
            if (key === 'Escape' || key === 'Backspace' || key === 'GoBack') {
                e.preventDefault();
                this.closeMediaDetail();
            }
            return;
        }

        const playerOpen = !document.getElementById('playerOverlay').classList.contains('hidden');

        // === Player controls ===
        if (playerOpen) {
            switch(key) {
                case 'Escape': case 'Backspace': case 'GoBack':
                    e.preventDefault();
                    this.closePlayer();
                    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
                    return;
                case 'MediaPlayPause': case ' ':
                    e.preventDefault();
                    const v = document.getElementById('videoPlayer');
                    v.paused ? v.play() : v.pause();
                    return;
                case 'ArrowLeft':
                    e.preventDefault();
                    document.getElementById('videoPlayer').currentTime -= 10;
                    return;
                case 'ArrowRight':
                    e.preventDefault();
                    document.getElementById('videoPlayer').currentTime += 10;
                    return;
                case 'f': case 'Enter':
                    e.preventDefault();
                    const overlay = document.getElementById('playerOverlay');
                    if (!document.fullscreenElement) {
                        overlay.requestFullscreen?.() || overlay.webkitRequestFullscreen?.();
                    } else {
                        document.exitFullscreen?.() || document.webkitExitFullscreen?.();
                    }
                    return;
            }
            return;
        }

        // === Detect current screen ===
        const loginActive = document.getElementById('loginScreen').classList.contains('active');
        const homeActive = document.getElementById('homeScreen').classList.contains('active');
        const mainActive = document.getElementById('mainScreen').classList.contains('active');

        if (loginActive) { this._handleLoginKeys(e); return; }
        if (homeActive) { this._handleHomeKeys(e); return; }
        if (mainActive) { this._handleMainKeys(e); return; }
    },

    // --- Login Screen: Up/Down between username, password, connect ---
    _loginFocusIdx: 0,
    _handleLoginKeys(e) {
        const items = [
            document.getElementById('loginUser'),
            document.getElementById('loginPass'),
            document.getElementById('btnConnect')
        ];
        switch(e.key) {
            case 'ArrowUp':
                e.preventDefault();
                this._loginFocusIdx = Math.max(0, this._loginFocusIdx - 1);
                this._focusLoginItem(items);
                break;
            case 'ArrowDown':
                e.preventDefault();
                this._loginFocusIdx = Math.min(items.length - 1, this._loginFocusIdx + 1);
                this._focusLoginItem(items);
                break;
            case 'Enter':
                e.preventDefault();
                if (items[this._loginFocusIdx]) {
                    const el = items[this._loginFocusIdx];
                    if (el.tagName === 'INPUT') { el.focus(); }
                    else { el.click(); }
                }
                break;
        }
    },
    _focusLoginItem(items) {
        this._clearFocus();
        const el = items[this._loginFocusIdx];
        if (el) { el.classList.add('remote-focus'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    },

    // --- Home Screen: 2D grid navigation on home tiles ---
    _homeFocusIdx: 0,
    _handleHomeKeys(e) {
        const tiles = [...document.querySelectorAll('.home-tile')];
        if (!tiles.length) return;
        const cols = 3;

        switch(e.key) {
            case 'ArrowRight':
                e.preventDefault();
                this._homeFocusIdx = Math.min(tiles.length - 1, this._homeFocusIdx + 1);
                this._focusElement(tiles, this._homeFocusIdx);
                break;
            case 'ArrowLeft':
                e.preventDefault();
                this._homeFocusIdx = Math.max(0, this._homeFocusIdx - 1);
                this._focusElement(tiles, this._homeFocusIdx);
                break;
            case 'ArrowDown':
                e.preventDefault();
                if (this._homeFocusIdx + cols < tiles.length) this._homeFocusIdx += cols;
                this._focusElement(tiles, this._homeFocusIdx);
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (this._homeFocusIdx - cols >= 0) this._homeFocusIdx -= cols;
                this._focusElement(tiles, this._homeFocusIdx);
                break;
            case 'Enter':
                e.preventDefault();
                if (tiles[this._homeFocusIdx]) tiles[this._homeFocusIdx].click();
                break;
            case 'Escape': case 'Backspace': case 'GoBack':
                e.preventDefault();
                break; // Already on home, nowhere to go back
        }
    },

    // --- Main Screen: handles nav tabs, sidebar, content grid, stremio, guide ---
    _handleMainKeys(e) {
        const key = e.key;

        // Stremio detail panel open? Handle separately
        const stremioDetail = document.getElementById('stremioDetail');
        if (stremioDetail && !stremioDetail.classList.contains('hidden')) {
            if (key === 'Escape' || key === 'Backspace' || key === 'GoBack') {
                e.preventDefault();
                document.getElementById('btnStremioDetailClose').click();
            }
            return;
        }

        // Guide page has its own 2D navigation
        if (this.currentPage === 'guide') {
            if (this._focusZone === 'nav' && (key === 'ArrowDown' || key === 'Enter')) {
                e.preventDefault();
                if (key === 'ArrowDown') {
                    this._focusZone = 'epg-toolbar';
                    this._epgToolbarIdx = 0;
                    this._focusEpgToolbar();
                } else {
                    const navBtns = [...document.querySelectorAll('.nav-btn')];
                    if (navBtns[this._navIdx]) navBtns[this._navIdx].click();
                }
                return;
            }
            if (this._focusZone !== 'nav') {
                this._handleGuideKeys(e);
                return;
            }
        }

        // Stremio page
        if (this.currentPage === 'stremio') {
            if (this._focusZone === 'nav' && (key === 'ArrowDown' || key === 'Enter')) {
                e.preventDefault();
                if (key === 'ArrowDown') {
                    this._focusZone = 'content';
                    this._stremioFocusZone = 'tabs';
                    this._clearFocus();
                    const tabs = [...document.querySelectorAll('.stremio-tab')];
                    if (tabs[this._stremioTabIdx]) tabs[this._stremioTabIdx].classList.add('remote-focus');
                } else {
                    const navBtns = [...document.querySelectorAll('.nav-btn')];
                    if (navBtns[this._navIdx]) navBtns[this._navIdx].click();
                }
                return;
            }
            if (this._focusZone !== 'nav') {
                this._handleStremioKeys(e);
                return;
            }
        }

        // Standard pages: nav, sidebar, content
        const sidebarVisible = !document.getElementById('categorySidebar').classList.contains('hidden');

        switch(key) {
            case 'ArrowUp':
                e.preventDefault();
                if (this._focusZone === 'nav') {
                    // Already at top
                } else if (this._focusZone === 'sidebar') {
                    this._sidebarIdx = Math.max(0, this._sidebarIdx - 1);
                    this._focusSidebar();
                } else {
                    this._moveInGrid(-1, 'up');
                }
                break;

            case 'ArrowDown':
                e.preventDefault();
                if (this._focusZone === 'nav') {
                    // Move into content area
                    this._focusZone = sidebarVisible ? 'sidebar' : 'content';
                    if (this._focusZone === 'sidebar') { this._sidebarIdx = 0; this._focusSidebar(); }
                    else { this._focusedIdx = 0; this._focusContent(); }
                } else if (this._focusZone === 'sidebar') {
                    const cats = this._getSidebarItems();
                    this._sidebarIdx = Math.min(cats.length - 1, this._sidebarIdx + 1);
                    this._focusSidebar();
                } else {
                    this._moveInGrid(1, 'down');
                }
                break;

            case 'ArrowLeft':
                e.preventDefault();
                if (this._focusZone === 'nav') {
                    this._navIdx = Math.max(0, this._navIdx - 1);
                    this._focusNav();
                } else if (this._focusZone === 'content' && sidebarVisible) {
                    this._focusZone = 'sidebar';
                    this._focusSidebar();
                } else if (this._focusZone === 'content') {
                    this._moveInGrid(-1, 'left');
                }
                break;

            case 'ArrowRight':
                e.preventDefault();
                if (this._focusZone === 'nav') {
                    const navBtns = [...document.querySelectorAll('.nav-btn')];
                    this._navIdx = Math.min(navBtns.length - 1, this._navIdx + 1);
                    this._focusNav();
                } else if (this._focusZone === 'sidebar') {
                    this._focusZone = 'content';
                    this._focusedIdx = Math.max(0, this._focusedIdx);
                    this._focusContent();
                } else {
                    this._moveInGrid(1, 'right');
                }
                break;

            case 'Enter':
                e.preventDefault();
                if (this._focusZone === 'nav') {
                    const navBtns = [...document.querySelectorAll('.nav-btn')];
                    if (navBtns[this._navIdx]) navBtns[this._navIdx].click();
                    this._focusZone = sidebarVisible ? 'sidebar' : 'content';
                    this._focusedIdx = 0; this._sidebarIdx = 0;
                } else if (this._focusZone === 'sidebar') {
                    const cats = this._getSidebarItems();
                    if (cats[this._sidebarIdx]) cats[this._sidebarIdx].click();
                    this._focusedIdx = 0;
                } else {
                    const items = this._getContentItems();
                    if (items[this._focusedIdx]) items[this._focusedIdx].click();
                }
                break;

            case 'Escape': case 'Backspace': case 'GoBack':
                e.preventDefault();
                if (this._focusZone === 'content' && sidebarVisible) {
                    this._focusZone = 'sidebar';
                    this._focusSidebar();
                } else if (this._focusZone === 'sidebar' || this._focusZone === 'nav') {
                    this.showHome();
                    this._homeFocusIdx = 0;
                } else {
                    const backBtn = document.getElementById('btnBack');
                    if (!backBtn.classList.contains('hidden')) {
                        backBtn.click();
                    } else {
                        this.showHome();
                        this._homeFocusIdx = 0;
                    }
                }
                break;

            // Tab key to cycle zones
            case 'Tab':
                e.preventDefault();
                if (this._focusZone === 'nav') {
                    this._focusZone = sidebarVisible ? 'sidebar' : 'content';
                    if (this._focusZone === 'sidebar') this._focusSidebar();
                    else this._focusContent();
                } else if (this._focusZone === 'sidebar') {
                    this._focusZone = 'content';
                    this._focusContent();
                } else {
                    this._focusZone = 'nav';
                    this._focusNav();
                }
                break;
        }
    },

    // --- Guide-specific 2D keyboard navigation ---
    // Focus zones for guide: sidebar | epg-toolbar | content (channels/programs)
    _guideFocusSide: 'channels',
    _guideFocusRow: 0,
    _epgToolbarIdx: 0,

    _getEpgToolbarBtns() {
        return [...document.querySelectorAll('.epg-toolbar .epg-src-btn, .epg-toolbar .epg-clock')];
    },

    _focusEpgToolbar() {
        this._clearFocus();
        const btns = this._getEpgToolbarBtns();
        if (this._epgToolbarIdx >= btns.length) this._epgToolbarIdx = 0;
        if (btns[this._epgToolbarIdx]) {
            btns[this._epgToolbarIdx].classList.add('remote-focus');
            btns[this._epgToolbarIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    },

    _handleGuideKeys(e) {
        const key = e.key;
        const channels = [...document.querySelectorAll('#epgChannelList .epg-channel-row')];
        const progRows = [...document.querySelectorAll('#epgPrograms .epg-program-row')];
        const sidebarItems = this._getSidebarItems();

        switch(key) {
            case 'ArrowUp':
                e.preventDefault();
                if (this._focusZone === 'sidebar') {
                    this._sidebarIdx = Math.max(0, this._sidebarIdx - 1);
                    this._focusSidebar();
                } else if (this._focusZone === 'epg-toolbar') {
                    // From toolbar, go up to nav
                    this._focusZone = 'nav';
                    this._focusNav();
                } else {
                    // In channels/programs
                    if (this._guideFocusRow <= 0) {
                        // Go to EPG toolbar instead of straight to nav
                        this._focusZone = 'epg-toolbar';
                        this._epgToolbarIdx = 0;
                        this._focusEpgToolbar();
                    } else {
                        this._guideFocusRow = Math.max(0, this._guideFocusRow - 1);
                        this._focusGuideRow(channels, progRows);
                    }
                }
                break;
            case 'ArrowDown':
                e.preventDefault();
                if (this._focusZone === 'sidebar') {
                    this._sidebarIdx = Math.min(sidebarItems.length - 1, this._sidebarIdx + 1);
                    this._focusSidebar();
                } else if (this._focusZone === 'epg-toolbar') {
                    // From toolbar, go down into channel list
                    this._focusZone = 'content';
                    this._guideFocusRow = 0;
                    this._guideFocusSide = 'channels';
                    this._focusGuideRow(channels, progRows);
                } else {
                    this._guideFocusRow = Math.min(channels.length - 1, this._guideFocusRow + 1);
                    this._focusGuideRow(channels, progRows);
                }
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (this._focusZone === 'sidebar') {
                    this._focusZone = 'epg-toolbar';
                    this._epgToolbarIdx = 0;
                    this._focusEpgToolbar();
                } else if (this._focusZone === 'epg-toolbar') {
                    const btns = this._getEpgToolbarBtns();
                    this._epgToolbarIdx = Math.min(btns.length - 1, this._epgToolbarIdx + 1);
                    this._focusEpgToolbar();
                } else if (this._guideFocusSide === 'channels') {
                    this._guideFocusSide = 'programs';
                    this._focusGuideRow(channels, progRows);
                } else {
                    document.getElementById('epgScrollArea').scrollLeft += 200;
                }
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (this._focusZone === 'sidebar') {
                    // Already at leftmost
                } else if (this._focusZone === 'epg-toolbar') {
                    if (this._epgToolbarIdx > 0) {
                        this._epgToolbarIdx--;
                        this._focusEpgToolbar();
                    } else {
                        // Go to sidebar
                        this._focusZone = 'sidebar';
                        this._focusSidebar();
                    }
                } else if (this._guideFocusSide === 'programs') {
                    this._guideFocusSide = 'channels';
                    this._focusGuideRow(channels, progRows);
                } else {
                    // From channels, go to sidebar
                    this._focusZone = 'sidebar';
                    this._focusSidebar();
                }
                break;
            case 'Enter':
                e.preventDefault();
                if (this._focusZone === 'sidebar') {
                    if (sidebarItems[this._sidebarIdx]) sidebarItems[this._sidebarIdx].click();
                } else if (this._focusZone === 'epg-toolbar') {
                    const btns = this._getEpgToolbarBtns();
                    if (btns[this._epgToolbarIdx]) btns[this._epgToolbarIdx].click();
                } else if (channels[this._guideFocusRow]) {
                    channels[this._guideFocusRow].click();
                }
                break;
            case 'Escape': case 'Backspace': case 'GoBack':
                e.preventDefault();
                if (this._focusZone === 'epg-toolbar') {
                    this._focusZone = 'sidebar';
                    this._focusSidebar();
                } else if (this._focusZone === 'sidebar') {
                    this.showHome();
                } else {
                    this._focusZone = 'epg-toolbar';
                    this._epgToolbarIdx = 0;
                    this._focusEpgToolbar();
                }
                break;
            case 'Tab':
                e.preventDefault();
                if (this._focusZone === 'sidebar') {
                    this._focusZone = 'epg-toolbar';
                    this._epgToolbarIdx = 0;
                    this._focusEpgToolbar();
                } else if (this._focusZone === 'epg-toolbar') {
                    this._focusZone = 'content';
                    this._focusGuideRow(channels, progRows);
                } else {
                    this._focusZone = 'sidebar';
                    this._focusSidebar();
                }
                break;
        }
    },

    // --- Stremio page keyboard navigation ---
    // Supports two layouts: Board (horizontal scroll rows) and Discover (CSS grid)
    _stremioRow: 0,   // which row (Board) or grid-row (Discover)
    _stremioCol: 0,   // which card within that row
    _stremioIdx: 0,   // flat index for Discover grid
    _stremioFocusZone: 'tabs', // 'tabs' or 'content'
    _stremioTabIdx: 0,

    _handleStremioKeys(e) {
        const key = e.key;

        // Tab bar navigation
        if (this._stremioFocusZone === 'tabs') {
            const tabs = [...document.querySelectorAll('.stremio-tab')];
            switch(key) {
                case 'ArrowRight':
                    e.preventDefault();
                    this._stremioTabIdx = Math.min(tabs.length - 1, this._stremioTabIdx + 1);
                    this._clearFocus();
                    if (tabs[this._stremioTabIdx]) tabs[this._stremioTabIdx].classList.add('remote-focus');
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this._stremioTabIdx = Math.max(0, this._stremioTabIdx - 1);
                    this._clearFocus();
                    if (tabs[this._stremioTabIdx]) tabs[this._stremioTabIdx].classList.add('remote-focus');
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this._stremioFocusZone = 'content';
                    this._focusZone = 'nav';
                    this._clearFocus();
                    this._focusNav();
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this._stremioFocusZone = 'content';
                    this._stremioRow = 0;
                    this._stremioCol = 0;
                    this._stremioIdx = 0;
                    this._clearFocus();
                    // Focus first content item
                    this._focusFirstStremioContent();
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (tabs[this._stremioTabIdx]) tabs[this._stremioTabIdx].click();
                    break;
                case 'Escape': case 'Backspace': case 'GoBack':
                    e.preventDefault();
                    this.showHome();
                    break;
            }
            return;
        }

        // Content navigation — go back to tabs on ArrowUp from top
        const isDiscover = !!document.getElementById('stremioDiscoverGrid') || !!document.getElementById('stremioSearchGrid');

        if (isDiscover) {
            this._handleStremioGridKeys(e);
        } else {
            this._handleStremioBoardKeys(e);
        }
    },

    _focusFirstStremioContent() {
        const card = document.querySelector('.stremio-poster-card');
        if (card) {
            card.classList.add('remote-focus');
            card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        // Also try filter buttons on discover page
        const filterBtn = document.querySelector('.stremio-filter-btn');
        if (!card && filterBtn) {
            filterBtn.classList.add('remote-focus');
        }
    },

    // Board view: rows of horizontal scrollers
    _handleStremioBoardKeys(e) {
        const key = e.key;
        const rows = [...document.querySelectorAll('.stremio-catalog-row')];
        if (!rows.length) {
            if (key === 'Escape' || key === 'Backspace' || key === 'GoBack') { e.preventDefault(); this.showHome(); }
            return;
        }
        if (this._stremioRow >= rows.length) this._stremioRow = 0;

        const getCardsInRow = (rowIdx) => {
            if (!rows[rowIdx]) return [];
            return [...rows[rowIdx].querySelectorAll('.stremio-poster-card')];
        };
        const currentCards = getCardsInRow(this._stremioRow);

        switch(key) {
            case 'ArrowRight':
                e.preventDefault();
                if (currentCards.length) {
                    this._stremioCol = Math.min(currentCards.length - 1, this._stremioCol + 1);
                    this._focusStremioCard(rows, currentCards);
                }
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (currentCards.length) {
                    this._stremioCol = Math.max(0, this._stremioCol - 1);
                    this._focusStremioCard(rows, currentCards);
                }
                break;
            case 'ArrowDown':
                e.preventDefault();
                if (this._stremioRow < rows.length - 1) {
                    this._stremioRow++;
                    const newCards = getCardsInRow(this._stremioRow);
                    if (this._stremioCol >= newCards.length) this._stremioCol = Math.max(0, newCards.length - 1);
                    this._focusStremioCard(rows, newCards);
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (this._stremioRow > 0) {
                    this._stremioRow--;
                    const newCards = getCardsInRow(this._stremioRow);
                    if (this._stremioCol >= newCards.length) this._stremioCol = Math.max(0, newCards.length - 1);
                    this._focusStremioCard(rows, newCards);
                } else {
                    // Go back to Stremio tabs
                    this._stremioFocusZone = 'tabs';
                    this._clearFocus();
                    const tabs = [...document.querySelectorAll('.stremio-tab')];
                    if (tabs[this._stremioTabIdx]) tabs[this._stremioTabIdx].classList.add('remote-focus');
                }
                break;
            case 'Enter':
                e.preventDefault();
                if (currentCards[this._stremioCol]) currentCards[this._stremioCol].click();
                break;
            case 'Escape': case 'Backspace': case 'GoBack':
                e.preventDefault();
                this.showHome();
                break;
        }
    },

    _focusStremioCard(rows, cards) {
        this._clearFocus();
        const card = cards[this._stremioCol];
        if (card) {
            card.classList.add('remote-focus');
            // Scroll the card into view within its horizontal scroller
            const scroller = card.closest('.stremio-row-scroller, .stremio-row-scroll');
            if (scroller) {
                const cardLeft = card.offsetLeft - scroller.offsetLeft;
                const cardRight = cardLeft + card.offsetWidth;
                const scrollLeft = scroller.scrollLeft;
                const scrollRight = scrollLeft + scroller.clientWidth;
                if (cardLeft < scrollLeft) scroller.scrollLeft = cardLeft - 12;
                else if (cardRight > scrollRight) scroller.scrollLeft = cardRight - scroller.clientWidth + 12;
            }
            // Scroll the row into view vertically
            card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    },

    // Discover/Search view: CSS grid of all cards
    _handleStremioGridKeys(e) {
        const key = e.key;
        const cards = [...document.querySelectorAll('#stremioDiscoverGrid .stremio-poster-card, #stremioSearchGrid .stremio-poster-card')];
        if (!cards.length) {
            // Still allow tab navigation and back
            if (key === 'ArrowUp') {
                e.preventDefault();
                this._stremioFocusZone = 'tabs';
                this._clearFocus();
                const tabs = [...document.querySelectorAll('.stremio-tab')];
                if (tabs[this._stremioTabIdx]) tabs[this._stremioTabIdx].classList.add('remote-focus');
            }
            if (key === 'Escape' || key === 'Backspace' || key === 'GoBack') { e.preventDefault(); this.showHome(); }
            return;
        }

        switch(key) {
            case 'ArrowRight':
                e.preventDefault();
                this._stremioIdx = Math.min(cards.length - 1, this._stremioIdx + 1);
                this._focusElement(cards, this._stremioIdx);
                break;
            case 'ArrowLeft':
                e.preventDefault();
                this._stremioIdx = Math.max(0, this._stremioIdx - 1);
                this._focusElement(cards, this._stremioIdx);
                break;
            case 'ArrowDown': {
                e.preventDefault();
                const cols = this._getGridCols(cards[0]);
                const next = this._stremioIdx + cols;
                if (next < cards.length) {
                    this._stremioIdx = next;
                    this._focusElement(cards, this._stremioIdx);
                }
                break;
            }
            case 'ArrowUp': {
                e.preventDefault();
                const cols = this._getGridCols(cards[0]);
                const prev = this._stremioIdx - cols;
                if (prev >= 0) {
                    this._stremioIdx = prev;
                    this._focusElement(cards, this._stremioIdx);
                } else {
                    // Go back to Stremio tabs
                    this._stremioFocusZone = 'tabs';
                    this._clearFocus();
                    const tabs = [...document.querySelectorAll('.stremio-tab')];
                    if (tabs[this._stremioTabIdx]) tabs[this._stremioTabIdx].classList.add('remote-focus');
                }
                break;
            }
            case 'Enter':
                e.preventDefault();
                if (cards[this._stremioIdx]) cards[this._stremioIdx].click();
                break;
            case 'Escape': case 'Backspace': case 'GoBack':
                e.preventDefault();
                this.showHome();
                break;
        }
    },

    // ============ Focus helpers ============

    _clearFocus() {
        document.querySelectorAll('.remote-focus').forEach(el => el.classList.remove('remote-focus'));
    },

    _focusElement(items, idx) {
        this._clearFocus();
        if (idx >= 0 && items[idx]) {
            items[idx].classList.add('remote-focus');
            items[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    },

    _focusNav() {
        this._clearFocus();
        const navBtns = [...document.querySelectorAll('.nav-btn')];
        if (navBtns[this._navIdx]) {
            navBtns[this._navIdx].classList.add('remote-focus');
        }
    },

    _sidebarIdx: 0,
    _getSidebarItems() {
        return [...document.querySelectorAll('#categoryList .category-item')];
    },

    _focusSidebar() {
        this._clearFocus();
        const items = this._getSidebarItems();
        if (items[this._sidebarIdx]) {
            items[this._sidebarIdx].classList.add('remote-focus');
            items[this._sidebarIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    },

    _getContentItems() {
        const cards = [...document.querySelectorAll('#contentGrid .stream-card')];
        return cards.filter(c => c.style.display !== 'none');
    },

    _focusContent() {
        this._clearFocus();
        const items = this._getContentItems();
        if (this._focusedIdx < 0) this._focusedIdx = 0;
        if (this._focusedIdx >= items.length) this._focusedIdx = Math.max(0, items.length - 1);
        if (items[this._focusedIdx]) {
            items[this._focusedIdx].classList.add('remote-focus');
            items[this._focusedIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    },

    // Get number of columns in a CSS grid by comparing element positions
    _getGridCols(firstEl) {
        if (!firstEl || !firstEl.parentElement) return 1;
        const children = [...firstEl.parentElement.children].filter(c => c.style.display !== 'none');
        if (children.length < 2) return 1;
        const firstTop = children[0].getBoundingClientRect().top;
        for (let i = 1; i < children.length; i++) {
            if (children[i].getBoundingClientRect().top !== firstTop) return i;
        }
        return children.length; // All on one row
    },

    // Move within a grid layout (content grid)
    _moveInGrid(step, direction) {
        const items = this._getContentItems();
        if (!items.length) return;
        if (this._focusedIdx < 0) this._focusedIdx = 0;

        const cols = this._getGridCols(items[0]);
        let newIdx = this._focusedIdx;

        if (direction === 'up') {
            newIdx = this._focusedIdx - cols;
            if (newIdx < 0) {
                // Move to nav
                this._focusZone = 'nav';
                this._focusNav();
                return;
            }
        } else if (direction === 'down') {
            newIdx = this._focusedIdx + cols;
            if (newIdx >= items.length) newIdx = items.length - 1;
        } else if (direction === 'left') {
            newIdx = Math.max(0, this._focusedIdx - 1);
        } else if (direction === 'right') {
            newIdx = Math.min(items.length - 1, this._focusedIdx + 1);
        }

        this._focusedIdx = newIdx;
        this._focusContent();
    },

    _focusGuideRow(channels, progRows) {
        this._clearFocus();
        const idx = this._guideFocusRow;
        if (this._guideFocusSide === 'channels' && channels[idx]) {
            channels[idx].classList.add('remote-focus');
            channels[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else if (this._guideFocusSide === 'programs' && progRows[idx]) {
            progRows[idx].classList.add('remote-focus');
            const scrollArea = document.getElementById('epgScrollArea');
            const rowTop = progRows[idx].offsetTop;
            const visible = scrollArea.scrollTop + scrollArea.clientHeight;
            if (rowTop < scrollArea.scrollTop + 40) scrollArea.scrollTop = rowTop - 40;
            else if (rowTop + 52 > visible) scrollArea.scrollTop = rowTop + 52 - scrollArea.clientHeight;
        }
        this._epgSelectedIdx = idx;
        this.updateEpgNowBar();
    },

    navigateTab(direction) {
        const navBtns = [...document.querySelectorAll('.nav-btn')];
        const activeIdx = navBtns.findIndex(b => b.classList.contains('active'));
        const newIdx = Math.max(0, Math.min(navBtns.length - 1, activeIdx + direction));
        if (newIdx !== activeIdx) {
            navBtns[newIdx].click();
            this._focusedIdx = 0;
            this._sidebarIdx = 0;
            this._guideFocusRow = 0;
            this._guideFocusSide = 'channels';
            this._stremioIdx = 0;
        }
    },

    // === Login: Connect to BOTH servers with one username/password ===
    async handleLogin() {
        const user = document.getElementById('loginUser').value.trim();
        const pass = document.getElementById('loginPass').value.trim();
        const errorEl = document.getElementById('loginError');
        const statusEl = document.getElementById('loginStatus');
        const btn = document.getElementById('btnConnect');

        if (!user || !pass) { errorEl.textContent = 'Enter username and password'; return; }

        errorEl.textContent = '';
        btn.disabled = true;
        btn.textContent = 'Connecting...';

        try {
            statusEl.innerHTML = `
                <div class="status-line"><span class="status-dot connecting"></span> Marble (pradahype.com)...</div>
                <div class="status-line"><span class="status-dot connecting"></span> Premium (pinkponyclub.online)...</div>
                <div class="status-line"><span class="status-dot connecting"></span> Stremio...</div>
            `;

            const results = {};
            const dots = statusEl.querySelectorAll('.status-dot');

            // Connect both in parallel
            const [marbleResult, ponyResult] = await Promise.allSettled([
                this.connectServer('marble', user, pass),
                this.connectServer('pony', user, pass)
            ]);

            // Update marble status
            if (marbleResult.status === 'fulfilled' && marbleResult.value?.success) {
                dots[0].className = 'status-dot success';
                dots[0].parentElement.innerHTML = '<span class="status-dot success"></span> Marble - Connected';
                results.marble = marbleResult.value;
            } else {
                dots[0].className = 'status-dot failed';
                const err = marbleResult.value?.error || marbleResult.reason?.message || 'Unknown error';
                dots[0].parentElement.innerHTML = `<span class="status-dot failed"></span> Marble - Failed (${err})`;
                console.error('[Login] Marble failed:', marbleResult);
            }

            // Update pony status
            if (ponyResult.status === 'fulfilled' && ponyResult.value?.success) {
                dots[1].className = 'status-dot success';
                dots[1].parentElement.innerHTML = '<span class="status-dot success"></span> Premium - Connected';
                results.pony = ponyResult.value;
            } else {
                dots[1].className = 'status-dot failed';
                const err = ponyResult.value?.error || ponyResult.reason?.message || 'Unknown error';
                dots[1].parentElement.innerHTML = `<span class="status-dot failed"></span> Premium - Failed (${err})`;
                console.error('[Login] Premium failed:', ponyResult);
            }

            // Stremio always connects (uses public addons)
            const dots2 = statusEl.querySelectorAll('.status-dot');
            if (dots2[2]) {
                dots2[2].className = 'status-dot success';
                dots2[2].parentElement.innerHTML = '<span class="status-dot success"></span> Stremio - Connected';
            }

            btn.disabled = false;
            btn.textContent = 'Connect';

            // Need at least one successful connection
            if (results.marble || results.pony) {
                this.session = { username: user, token: pass };
                this.servers = results;
                localStorage.setItem('sv_session', JSON.stringify(this.session));
                localStorage.setItem('sv_servers', JSON.stringify(results));

                setTimeout(() => this.showHome(), 800);
            } else {
                errorEl.textContent = 'Failed to connect to both servers. Check your credentials.';
            }
        } catch(e) {
            console.error('[Login] Unexpected error:', e);
            errorEl.textContent = 'Connection error: ' + e.message;
            btn.disabled = false;
            btn.textContent = 'Connect';
        }
    },

    async revalidateSession(savedSession) {
        const statusEl = document.getElementById('loginStatus');
        statusEl.innerHTML = '<div class="status-line"><span class="status-dot connecting"></span> Reconnecting...</div>';

        try {
            const [marbleResult, ponyResult] = await Promise.allSettled([
                this.connectServer('marble', savedSession.username, savedSession.token),
                this.connectServer('pony', savedSession.username, savedSession.token)
            ]);

            const results = {};
            if (marbleResult.status === 'fulfilled' && marbleResult.value?.success) results.marble = marbleResult.value;
            if (ponyResult.status === 'fulfilled' && ponyResult.value?.success) results.pony = ponyResult.value;

            if (results.marble || results.pony) {
                this.session = savedSession;
                this.servers = results;
                localStorage.setItem('sv_session', JSON.stringify(this.session));
                localStorage.setItem('sv_servers', JSON.stringify(results));
                console.log('[Init] Session re-validated successfully');
                this.showHome();
            } else {
                console.warn('[Init] Session expired or invalid, showing login');
                localStorage.removeItem('sv_session');
                localStorage.removeItem('sv_servers');
                statusEl.innerHTML = '<div class="status-line" style="color:#ff8844">Session expired. Please log in again.</div>';
            }
        } catch(e) {
            console.error('[Init] Re-validation failed:', e);
            localStorage.removeItem('sv_session');
            localStorage.removeItem('sv_servers');
            statusEl.innerHTML = '';
        }
    },

    async connectServer(key, user, pass) {
        try {
            const baseUrl = DNS[key].url;
            const resp = await this.fetchWithTimeout(`${baseUrl}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`, 15000);
            const data = await resp.json();

            if (data.user_info && data.user_info.status === 'Active') {
                return {
                    success: true,
                    key,
                    baseUrl,
                    userInfo: data.user_info,
                    serverInfo: data.server_info
                };
            }
            return { success: false, key };
        } catch (e) {
            return { success: false, key, error: e.message };
        }
    },

    // === Navigation ===
    showHome() {
        document.getElementById('loginScreen').classList.remove('active');
        document.getElementById('mainScreen').classList.remove('active');
        document.getElementById('homeScreen').classList.add('active');
        // Stop any playing video
        const video = document.getElementById('videoPlayer');
        if (video && !video.paused) {
            video.pause();
            video.src = '';
        }
        if (this.hls) { this.hls.destroy(); this.hls = null; }
        document.getElementById('playerOverlay')?.classList.add('hidden');
        history.pushState({ screen: 'home' }, '', '#home');
        this._homeFocusIdx = 0;
        this._clearFocus();
    },

    openSection(page) {
        document.getElementById('homeScreen').classList.remove('active');
        document.getElementById('mainScreen').classList.add('active');
        history.pushState({ screen: page }, '', '#' + page);
        // Highlight the correct tab
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        const tab = document.querySelector(`.top-nav .nav-btn[data-page="${page}"]`);
        if (tab) tab.classList.add('active');
        this.navigateTo(page);
    },

    showMain() {
        document.getElementById('loginScreen').classList.remove('active');
        document.getElementById('homeScreen').classList.remove('active');
        document.getElementById('mainScreen').classList.add('active');
        this.navigateTo('guide');
    },

    navigateTo(page) {
        this.currentPage = page;
        // Reset focus state for new page
        this._focusZone = 'content';
        this._focusedIdx = 0;
        this._sidebarIdx = 0;
        this._guideFocusRow = 0;
        this._guideFocusSide = 'channels';
        this._stremioIdx = 0;
        this._clearFocus();

        const sidebar = document.getElementById('categorySidebar');
        const stremioPanel = document.getElementById('stremioPanel');
        const contentArea = document.querySelector('.content-area');
        const grid = document.getElementById('contentGrid');
        const emptyState = document.getElementById('emptyState');
        const backBtn = document.getElementById('btnBack');
        sidebar.classList.remove('hidden');
        stremioPanel.classList.add('hidden');
        contentArea.style.display = 'flex';
        grid.innerHTML = '';
        grid.style.display = '';
        backBtn.classList.add('hidden');
        emptyState.classList.remove('hidden');

        const epgPanel = document.getElementById('epgPanel');
        epgPanel.classList.add('hidden');

        switch (page) {
            case 'live':
                this.loadCategories('live');
                break;
            case 'guide':
                contentArea.style.display = 'flex';
                epgPanel.classList.remove('hidden');
                emptyState.classList.add('hidden');
                grid.style.display = 'none';
                this.loadCategories('live');
                this.epgDateOffset = 0;
                this.loadEpg();
                break;
            case 'vod':
                this.loadCategories('vod');
                break;
            case 'series':
                this.loadCategories('series');
                break;
            case 'stremio':
                sidebar.classList.add('hidden');
                contentArea.style.display = 'none';
                stremioPanel.classList.remove('hidden');
                this.initStremio();
                break;
            case 'favorites':
                sidebar.classList.add('hidden');
                emptyState.classList.add('hidden');
                this.renderFavorites();
                break;
            case 'settings':
                sidebar.classList.add('hidden');
                emptyState.classList.add('hidden');
                this.renderSettings();
                break;
        }
    },

    goBack() {
        document.getElementById('btnBack').classList.add('hidden');
        this.navigateTo(this.currentPage);
    },

    // === Xtream API (dual server) ===
    async xtreamGet(serverKey, action, extra = '') {
        const s = this.servers[serverKey];
        if (!s || !s.success) { console.warn(`[API] Server ${serverKey} not connected`); return null; }
        const url = `${s.baseUrl}/player_api.php?username=${encodeURIComponent(this.session.username)}&password=${encodeURIComponent(this.session.token)}&action=${action}${extra}`;
        console.log(`[API] ${serverKey} -> ${action}`);
        try {
            const resp = await this.fetchWithTimeout(url, 30000);
            const data = await resp.json();
            console.log(`[API] ${serverKey} ${action}: got ${Array.isArray(data) ? data.length + ' items' : typeof data}`);
            return data;
        } catch(e) {
            console.error(`[API] ${serverKey} ${action} FAILED:`, e.message);
            return null;
        }
    },

    getActiveServers() {
        const keys = [];
        if (this.currentSource === 'marble' && this.servers.marble?.success) {
            keys.push('marble');
        }
        if (this.currentSource === 'pony' && this.servers.pony?.success) {
            keys.push('pony');
        }
        return keys;
    },

    async loadCategories(type) {
        const categoryList = document.getElementById('categoryList');
        categoryList.innerHTML = '';
        this.showLoader();

        try {
            let action;
            if (type === 'live') action = 'get_live_categories';
            else if (type === 'vod') action = 'get_vod_categories';
            else action = 'get_series_categories';

            const servers = this.getActiveServers();
            console.log(`[Categories] Loading ${type}, active servers:`, servers, 'servers obj:', JSON.stringify(Object.keys(this.servers)));
            const allCats = new Map();

            const results = await Promise.allSettled(
                servers.map(key => this.xtreamGet(key, action))
            );

            results.forEach((r, i) => {
                if (r.status === 'fulfilled' && r.value) {
                    (r.value || []).forEach(cat => {
                        if (!allCats.has(cat.category_name)) {
                            allCats.set(cat.category_name, { ...cat, sources: [servers[i]] });
                        } else {
                            allCats.get(cat.category_name).sources.push(servers[i]);
                        }
                    });
                }
            });

            // Priority categories for Premium (pony) — show at top
            const premiumPriority = [
                'usa entertainment', 'ppv events', 'usa news',
                'usa nfl', 'usa nba', 'usa mlb', 'usa nhl'
            ];

            // Sort categories
            this.categories = [...allCats.values()].sort((a, b) => {
                const aName = (a.category_name || '').toLowerCase();
                const bName = (b.category_name || '').toLowerCase();

                // Premium priority categories at top
                if (this.currentSource === 'pony') {
                    const aIdx = premiumPriority.findIndex(p => aName.includes(p));
                    const bIdx = premiumPriority.findIndex(p => bName.includes(p));
                    if (aIdx !== -1 && bIdx === -1) return -1;
                    if (bIdx !== -1 && aIdx === -1) return 1;
                    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
                }

                // For VOD: "New Releases" from Marble server always first
                if (type === 'vod') {
                    const aNewRelease = aName.includes('new release') && (a.sources || []).includes('marble');
                    const bNewRelease = bName.includes('new release') && (b.sources || []).includes('marble');
                    if (aNewRelease && !bNewRelease) return -1;
                    if (bNewRelease && !aNewRelease) return 1;
                }

                const aFullHdUsa = aName.includes('full hd') && aName.includes('usa');
                const bFullHdUsa = bName.includes('full hd') && bName.includes('usa');
                const aUsa = aName.includes('usa') || aName.includes('us ') || aName.includes('united states');
                const bUsa = bName.includes('usa') || bName.includes('us ') || bName.includes('united states');

                // Full HD USA always first
                if (aFullHdUsa && !bFullHdUsa) return -1;
                if (bFullHdUsa && !aFullHdUsa) return 1;
                // Then other USA categories
                if (aUsa && !bUsa) return -1;
                if (bUsa && !aUsa) return 1;
                // Then alphabetical
                return aName.localeCompare(bName);
            });
            console.log(`[Categories] Found ${this.categories.length} categories from ${servers.length} servers`);
            categoryList.innerHTML = '';

            if (servers.length === 0) {
                categoryList.innerHTML = '<div style="padding:16px;color:#ff4444">No servers connected. Try logging out and back in.</div>';
                return;
            }

            // Favorites category
            const favEl = document.createElement('div');
            favEl.className = 'category-item';
            const favSection = type === 'live' ? 'live' : type;
            const favCount = this.favorites.filter(f => f.section === favSection).length;
            favEl.innerHTML = `<span class="material-icons" style="color:#00D4FF">favorite</span> Favorites${favCount ? ` (${favCount})` : ''}`;
            favEl.addEventListener('click', () => {
                document.querySelectorAll('.category-item').forEach(c => c.classList.remove('active'));
                favEl.classList.add('active');
                document.getElementById('emptyState').classList.add('hidden');
                this.renderSectionFavorites(favSection, type);
            });
            categoryList.appendChild(favEl);

            // Recently Viewed category
            const recentEl = document.createElement('div');
            recentEl.className = 'category-item';
            const recentCount = this.recentlyViewed.filter(r => r.section === favSection).length;
            recentEl.innerHTML = `<span class="material-icons" style="color:#00D4FF">history</span> Recently Viewed${recentCount ? ` (${recentCount})` : ''}`;
            recentEl.addEventListener('click', () => {
                document.querySelectorAll('.category-item').forEach(c => c.classList.remove('active'));
                recentEl.classList.add('active');
                document.getElementById('emptyState').classList.add('hidden');
                this.renderSectionRecent(favSection, type);
            });
            categoryList.appendChild(recentEl);

            // Separator
            const sep = document.createElement('div');
            sep.style.cssText = 'height:1px;background:#222;margin:6px 10px;';
            categoryList.appendChild(sep);

            // Add "All" category (except for Guide)
            if (this.currentPage !== 'guide') {
                const allEl = document.createElement('div');
                allEl.className = 'category-item active';
                allEl.innerHTML = '<span class="material-icons">folder</span> All';
                allEl.addEventListener('click', () => {
                    document.querySelectorAll('.category-item').forEach(c => c.classList.remove('active'));
                    allEl.classList.add('active');
                    this.loadStreams(type, null);
                });
                categoryList.appendChild(allEl);
            }

            this.categories.forEach(cat => {
                const el = document.createElement('div');
                el.className = 'category-item';
                el.innerHTML = `<span class="material-icons">folder</span> ${cat.category_name}`;
                el.addEventListener('click', () => {
                    document.querySelectorAll('.category-item').forEach(c => c.classList.remove('active'));
                    el.classList.add('active');
                    if (this.currentPage === 'guide') {
                        this.epgCategory = cat.category_id;
                        this.renderEpgFiltered();
                    } else {
                        this.loadStreams(type, cat.category_id);
                    }
                });
                categoryList.appendChild(el);
            });
        } catch (e) {
            console.error('[Categories] Error:', e);
            categoryList.innerHTML = `<div style="padding:16px;color:#ff4444">Failed to load: ${e.message}</div>`;
        } finally {
            this.hideLoader();
        }
    },

    async loadStreams(type, categoryId) {
        const grid = document.getElementById('contentGrid');
        const emptyState = document.getElementById('emptyState');

        grid.innerHTML = '';
        emptyState.classList.add('hidden');
        this.showLoader();

        try {
            let action;
            if (type === 'live') action = 'get_live_streams';
            else if (type === 'vod') action = 'get_vod_streams';
            else action = 'get_series';

            const extra = categoryId ? `&category_id=${categoryId}` : '';
            const servers = this.getActiveServers();
            const allItems = [];

            const results = await Promise.allSettled(
                servers.map(key => this.xtreamGet(key, action, extra))
            );

            results.forEach((r, i) => {
                if (r.status === 'fulfilled' && r.value) {
                    (r.value || []).forEach(item => {
                        allItems.push({ ...item, _source: servers[i] });
                    });
                }
            });

            // Deduplicate by name, prefer marble
            const seen = new Map();
            allItems.forEach(item => {
                const name = (item.name || '').toLowerCase().trim();
                if (!seen.has(name)) {
                    seen.set(name, item);
                } else if (item._source === 'marble') {
                    seen.set(name, item); // Marble takes priority
                }
            });

            this.streams = [...seen.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            if (type === 'live') {
                grid.className = 'content-grid list-view';
                this.streams.forEach(item => this.renderLiveCard(grid, item));
            } else {
                grid.className = 'content-grid';
                this.streams.forEach(item => this.renderPosterCard(grid, item, type));
            }
        } catch (e) {
            grid.innerHTML = `<div style="padding:16px;color:#ff4444">Failed: ${e.message}</div>`;
        } finally {
            this.hideLoader();
        }
    },

    renderLiveCard(grid, item) {
        const card = document.createElement('div');
        card.className = 'stream-card live-item';
        card.dataset.source = item._source;
        const srcColor = DNS[item._source]?.color || 'marble';
        card.innerHTML = `
            <div class="live-icon">
                ${item.stream_icon ? `<img src="${item.stream_icon}" onerror="this.parentElement.innerHTML='<span class=\\'material-icons\\'>live_tv</span>'">` : '<span class="material-icons">live_tv</span>'}
            </div>
            <div class="card-info">
                <div class="card-title">${item.name || 'Unknown'}</div>
                <div class="card-meta">${item.tv_archive ? 'Catchup' : 'Live'}</div>
            </div>
            <span class="source-tag ${srcColor}">${DNS[item._source]?.name || item._source}</span>
        `;
        card.addEventListener('click', () => {
            const baseUrl = DNS[item._source].url;
            const url = `${baseUrl}/live/${encodeURIComponent(this.session.username)}/${encodeURIComponent(this.session.token)}/${item.stream_id}.m3u8`;
            this.trackRecentlyViewed({ id: String(item.stream_id), name: item.name, url, icon: item.stream_icon, type: 'live', section: 'live', source: item._source });
            this.openPlayer(url, item.name, { id: String(item.stream_id), type: 'live', icon: item.stream_icon, source: item._source });
        });
        this.addLongPress(card, { id: String(item.stream_id), name: item.name, icon: item.stream_icon, type: 'live', section: 'live', source: item._source,
            url: `${DNS[item._source].url}/live/${encodeURIComponent(this.session.username)}/${encodeURIComponent(this.session.token)}/${item.stream_id}.m3u8` });
        grid.appendChild(card);
    },

    renderPosterCard(grid, item, type) {
        const card = document.createElement('div');
        card.className = 'stream-card';
        card.dataset.source = item._source;
        const icon = item.stream_icon || item.cover || '';
        const name = item.name || 'Unknown';
        const srcColor = DNS[item._source]?.color || 'marble';
        card.innerHTML = `
            <div class="poster">
                ${icon ? `<img src="${icon}" onerror="this.parentElement.innerHTML='<span class=\\'material-icons placeholder-icon\\'>movie</span>'">` : '<span class="material-icons placeholder-icon">movie</span>'}
            </div>
            <span class="source-tag ${srcColor}">${DNS[item._source]?.name || ''}</span>
            <div class="card-info">
                <div class="card-title">${name}</div>
                <div class="card-meta">${item.rating || ''}</div>
            </div>
        `;
        const section = type === 'vod' ? 'vod' : 'series';
        const favItem = { id: String(item.stream_id || item.series_id), name, icon, poster: icon, type: section, section, source: item._source };

        card.addEventListener('click', () => {
            if (type === 'vod') {
                const meta = {
                    name, poster: icon, background: icon, type: 'movie',
                    year: item.year || '', genres: item.genre || '',
                    description: item.plot || '', imdbRating: item.rating || '',
                    source: item._source,
                    playAction: () => {
                        const ext = item.container_extension || 'mp4';
                        const baseUrl = DNS[item._source].url;
                        const url = `${baseUrl}/movie/${encodeURIComponent(this.session.username)}/${encodeURIComponent(this.session.token)}/${item.stream_id}.${ext}`;
                        this.openPlayer(url, name, { id: String(item.stream_id), type: 'vod', icon, source: item._source });
                    }
                };
                this.trackRecentlyViewed({ ...favItem, meta });
                this.openMediaDetail(meta);
            } else {
                const meta = {
                    name, poster: icon, background: icon, type: 'series',
                    year: item.year || '', genres: item.genre || '',
                    description: item.plot || '', imdbRating: item.rating || '',
                    source: item._source,
                    seriesAction: () => {
                        this.loadSeriesDetail(item.series_id, name, item._source);
                    }
                };
                this.trackRecentlyViewed({ ...favItem, meta });
                this.openMediaDetail(meta);
            }
        });
        this.addLongPress(card, favItem);
        grid.appendChild(card);
    },

    async loadSeriesDetail(seriesId, seriesName, source) {
        const grid = document.getElementById('contentGrid');
        const backBtn = document.getElementById('btnBack');

        grid.innerHTML = '';
        this.showLoader();
        backBtn.classList.remove('hidden');

        try {
            const data = await this.xtreamGet(source, 'get_series_info', `&series_id=${seriesId}`);
            grid.className = 'content-grid list-view';

            if (data?.episodes) {
                Object.keys(data.episodes).forEach(season => {
                    const header = document.createElement('div');
                    header.style.cssText = 'padding:12px 0;font-size:16px;font-weight:600;color:#00D4FF;';
                    header.textContent = `Season ${season}`;
                    grid.appendChild(header);

                    data.episodes[season].forEach(ep => {
                        const card = document.createElement('div');
                        card.className = 'stream-card live-item';
                        card.innerHTML = `
                            <div class="live-icon"><span class="material-icons">play_circle</span></div>
                            <div class="card-info">
                                <div class="card-title">E${ep.episode_num}: ${ep.title || 'Episode ' + ep.episode_num}</div>
                                <div class="card-meta">${ep.info?.duration || ''}</div>
                            </div>
                        `;
                        card.addEventListener('click', () => {
                            const ext = ep.container_extension || 'mp4';
                            const baseUrl = DNS[source].url;
                            const url = `${baseUrl}/series/${encodeURIComponent(this.session.username)}/${encodeURIComponent(this.session.token)}/${ep.id}.${ext}`;
                            this.openPlayer(url, `${seriesName} - S${season}E${ep.episode_num}`, { id: ep.id, type: 'series', source });
                        });
                        grid.appendChild(card);
                    });
                });
            }
        } catch (e) {
            grid.innerHTML = `<div style="padding:16px;color:#ff4444">Failed: ${e.message}</div>`;
        } finally {
            this.hideLoader();
        }
    },

    filterBySource() {
        // Sync EPG source with main source toggle
        this.epgSource = this.currentSource;
        const page = this.currentPage;
        if (page === 'guide') {
            this.loadCategories('live');
            this.loadEpg();
        } else if (['live', 'vod', 'series'].includes(page)) {
            this.loadCategories(page);
            // Clear current streams - they'll reload when user picks a category
            document.getElementById('contentGrid').innerHTML = '';
            document.getElementById('emptyState').classList.remove('hidden');
        }
    },

    // === Player ===
    currentPlaying: null,

    hls: null,

    openPlayer(url, title, meta) {
        const overlay = document.getElementById('playerOverlay');
        const video = document.getElementById('videoPlayer');
        const titleEl = document.getElementById('playerTitle');
        const errorEl = document.getElementById('playerError');
        const favBtn = document.getElementById('btnFavorite');
        const sourceBadge = document.getElementById('playerSource');

        // Clean up previous HLS instance
        if (this.hls) { this.hls.destroy(); this.hls = null; }

        overlay.classList.remove('hidden');
        titleEl.textContent = title;
        errorEl.classList.add('hidden');
        this.currentPlaying = { url, title, ...meta };

        if (meta?.source && DNS[meta.source]) {
            sourceBadge.textContent = DNS[meta.source].name;
            sourceBadge.className = `player-source-badge source-tag ${DNS[meta.source].color}`;
        } else {
            sourceBadge.textContent = '';
        }

        const isFav = this.favorites.some(f => f.id === meta?.id);
        favBtn.querySelector('.material-icons').textContent = isFav ? 'favorite' : 'favorite_border';
        favBtn.querySelector('.material-icons').classList.toggle('fav-active', isFav);

        this._retryCount = 0;
        this._tryPlay(url, video, errorEl, meta);

        // Auto-fullscreen on play
        video.addEventListener('playing', () => {
            try {
                if (overlay.requestFullscreen && !document.fullscreenElement) {
                    overlay.requestFullscreen().catch(() => {});
                } else if (video.webkitEnterFullscreen) {
                    video.webkitEnterFullscreen();
                }
            } catch(e) {}
        }, { once: true });

        // Show EKC spinner during buffering/waiting
        video.addEventListener('waiting', () => this.showLoader());
        video.addEventListener('playing', () => this.hideLoader());
        video.addEventListener('canplay', () => this.hideLoader());

        video.onerror = () => {
            console.error('[Player] video.onerror', video.error);
            this.hideLoader();
            errorEl.textContent = 'Playback error. Stream may be unavailable.';
            errorEl.classList.remove('hidden');
        };
    },

    closePlayer() {
        const video = document.getElementById('videoPlayer');
        video.pause();
        video.src = '';
        if (this.hls) { this.hls.destroy(); this.hls = null; }
        this._retryCount = 0;
        // Exit fullscreen first
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        }
        document.getElementById('playerOverlay').classList.add('hidden');
        this.currentPlaying = null;
        // Return to guide if that's where we came from
        if (this.currentPage === 'guide') {
            // Already on guide, just make sure it's visible
            document.getElementById('epgPanel').classList.remove('hidden');
        }
    },

    // === Trailer System ===
    // Piped embed instances for trailer playback (serves direct video, works on TV)
    _pipedEmbedInstances: [
        'https://piped.video',
        'https://piped.private.coffee',
        'https://piped.kavin.rocks'
    ],

    async openTrailer(name, year, type, imdbId) {
        const overlay = document.getElementById('trailerOverlay');
        const titleEl = document.getElementById('trailerTitle');
        const player = document.getElementById('trailerPlayer');
        const errorEl = document.getElementById('trailerError');

        overlay.classList.remove('hidden');
        titleEl.textContent = `${name} - Trailer`;
        player.innerHTML = '';
        errorEl.classList.add('hidden');
        this.showLoader();

        try {
            const videoId = await this._findTrailerVideoId(name, year, type, imdbId);
            if (videoId) {
                // Use Piped embed - plays video directly, no YouTube restrictions
                const iframe = document.createElement('iframe');
                iframe.allowFullscreen = true;
                iframe.allow = 'autoplay; encrypted-media; fullscreen';
                iframe.src = `${this._pipedEmbedInstances[0]}/embed/${videoId}?autoplay=1`;
                let attempt = 0;
                iframe.onerror = () => {
                    attempt++;
                    if (attempt < this._pipedEmbedInstances.length) {
                        iframe.src = `${this._pipedEmbedInstances[attempt]}/embed/${videoId}?autoplay=1`;
                    } else {
                        errorEl.textContent = 'Trailer could not be played.';
                        errorEl.classList.remove('hidden');
                    }
                };
                player.appendChild(iframe);
            } else {
                errorEl.textContent = 'No trailer found for this title.';
                errorEl.classList.remove('hidden');
            }
        } catch(e) {
            console.error('[Trailer] Error:', e);
            errorEl.textContent = 'Failed to load trailer. Please try again.';
            errorEl.classList.remove('hidden');
        } finally {
            this.hideLoader();
        }
    },

    async _findTrailerVideoId(name, year, type, imdbId) {
        // Strategy 1: If we have an IMDB ID, get trailer directly from Cinemeta meta
        if (imdbId) {
            try {
                const metaType = (type === 'series') ? 'series' : 'movie';
                const url = `https://v3-cinemeta.strem.io/meta/${metaType}/${imdbId}.json`;
                console.log(`[Trailer] Fetching Cinemeta meta: ${url}`);
                const resp = await this.fetchWithTimeout(url, 8000);
                const data = await resp.json();
                const trailers = data.meta?.trailers || [];
                if (trailers.length > 0 && trailers[0].source) {
                    console.log(`[Trailer] Found from Cinemeta meta: ${trailers[0].source}`);
                    return trailers[0].source;
                }
                // Also check trailerStreams
                const streams = data.meta?.trailerStreams || [];
                if (streams.length > 0 && streams[0].ytId) {
                    console.log(`[Trailer] Found from Cinemeta trailerStreams: ${streams[0].ytId}`);
                    return streams[0].ytId;
                }
            } catch(e) {
                console.warn('[Trailer] Cinemeta meta fetch failed:', e.message);
            }
        }

        // Strategy 2: Search Cinemeta by name to find IMDB ID, then get trailer
        if (!imdbId) {
            try {
                const searchType = (type === 'series') ? 'series' : 'movie';
                const searchUrl = `https://v3-cinemeta.strem.io/catalog/${searchType}/top/search=${encodeURIComponent(name)}.json`;
                console.log(`[Trailer] Searching Cinemeta: ${name}`);
                const resp = await this.fetchWithTimeout(searchUrl, 8000);
                const data = await resp.json();
                if (data.metas?.length > 0) {
                    const match = data.metas[0];
                    const foundId = match.imdb_id || (match.id?.startsWith('tt') ? match.id : null);
                    if (foundId) {
                        // Recurse with IMDB ID
                        return this._findTrailerVideoId(name, year, type, foundId);
                    }
                }
            } catch(e) {
                console.warn('[Trailer] Cinemeta search failed:', e.message);
            }
        }

        // Strategy 3: Fallback to Piped API search
        const query = `${name} ${year || ''} official trailer`.trim();
        const pipedApis = [
            'https://api.piped.private.coffee',
            'https://pipedapi.kavin.rocks'
        ];
        for (const base of pipedApis) {
            try {
                const url = `${base}/search?q=${encodeURIComponent(query)}&filter=videos`;
                console.log(`[Trailer] Trying Piped search: ${base}`);
                const resp = await this.fetchWithTimeout(url, 8000);
                const data = await resp.json();
                const items = data.items || data;
                if (Array.isArray(items) && items.length > 0) {
                    const videoId = items[0].url?.replace('/watch?v=', '') || items[0].id;
                    if (videoId) {
                        console.log(`[Trailer] Found via Piped: ${videoId}`);
                        return videoId;
                    }
                }
            } catch(e) {
                console.warn(`[Trailer] Piped ${base} failed:`, e.message);
            }
        }

        return null;
    },

    closeTrailer() {
        const overlay = document.getElementById('trailerOverlay');
        const player = document.getElementById('trailerPlayer');
        player.innerHTML = '';
        overlay.classList.add('hidden');
    },

    // === Universal Media Detail Modal ===
    // Works for IPTV VOD, series, and enriches Stremio detail
    async openMediaDetail(info) {
        // info: { name, poster, background, type, year, genres, description, imdbRating, source, playAction, seriesAction, imdbId }
        const modal = document.getElementById('mediaDetailModal');
        const bg = document.getElementById('mediaDetailBg');
        const body = document.getElementById('mediaDetailBody');

        bg.style.backgroundImage = info.background ? `url(${info.background})` : (info.poster ? `url(${info.poster})` : 'none');
        modal.classList.remove('hidden');
        this.showLoader();

        // Start with what we have
        let name = info.name || 'Unknown';
        let poster = info.poster || '';
        let year = info.year || '';
        let genres = info.genres || '';
        let desc = info.description || '';
        let imdbRating = info.imdbRating || '';
        let mpaa = '';
        let rtScore = '';
        let imdbId = info.imdbId || '';

        // Try to enrich from Cinemeta search if we don't have details
        if (!desc || !poster || !imdbId) {
            try {
                const searchType = (info.type === 'series') ? 'series' : 'movie';
                const cineUrl = `https://v3-cinemeta.strem.io/catalog/${searchType}/top/search=${encodeURIComponent(name)}.json`;
                const cineResp = await this.fetchWithTimeout(cineUrl, 6000);
                const cineData = await cineResp.json();
                if (cineData.metas?.length > 0) {
                    const match = cineData.metas[0];
                    if (!poster && match.poster) poster = match.poster;
                    if (!desc && match.description) desc = match.description;
                    if (!imdbRating && match.imdbRating) imdbRating = match.imdbRating;
                    if (!year && (match.releaseInfo || match.year)) year = match.releaseInfo || match.year;
                    if (!genres && match.genres) genres = match.genres.join(', ');
                    if (!imdbId && match.imdb_id) imdbId = match.imdb_id;
                    if (!imdbId && match.id?.startsWith('tt')) imdbId = match.id;
                    if (!info.background && match.background) {
                        bg.style.backgroundImage = `url(${match.background})`;
                    }
                }
            } catch(e) {
                console.warn('[MediaDetail] Cinemeta search failed:', e.message);
            }
        }

        // Fetch OMDB for MPAA rating + Rotten Tomatoes score
        if (imdbId) {
            try {
                const omdbKey = localStorage.getItem('sv_omdb_key') || '';
                if (omdbKey) {
                    const omdbUrl = `https://www.omdbapi.com/?i=${imdbId}&apikey=${omdbKey}`;
                    const omdbResp = await this.fetchWithTimeout(omdbUrl, 5000);
                    const omdb = await omdbResp.json();
                    if (omdb.Response !== 'False') {
                        if (omdb.Rated && omdb.Rated !== 'N/A') mpaa = omdb.Rated;
                        const rt = (omdb.Ratings || []).find(r => r.Source === 'Rotten Tomatoes');
                        if (rt) rtScore = rt.Value;
                        if (!imdbRating && omdb.imdbRating && omdb.imdbRating !== 'N/A') imdbRating = omdb.imdbRating;
                        if (!desc && omdb.Plot && omdb.Plot !== 'N/A') desc = omdb.Plot;
                        if (!genres && omdb.Genre && omdb.Genre !== 'N/A') genres = omdb.Genre;
                        if (!year && omdb.Year) year = omdb.Year;
                    }
                }
            } catch(e) {
                console.warn('[MediaDetail] OMDB failed:', e.message);
            }
        }

        // Build ratings badges
        let ratingsHtml = '';
        if (mpaa) ratingsHtml += `<span class="media-rating-badge mpaa-badge">${mpaa}</span>`;
        if (imdbRating) ratingsHtml += `<span class="media-rating-badge imdb-badge"><span class="material-icons">star</span> ${imdbRating}</span>`;
        if (rtScore) ratingsHtml += `<span class="media-rating-badge rt-badge">🍅 ${rtScore}</span>`;

        // Build action buttons
        let actionsHtml = '';
        if (info.playAction) {
            actionsHtml += `<button class="media-action-btn media-action-play" id="btnMediaPlay"><span class="material-icons">play_arrow</span> Play</button>`;
        }
        if (info.seriesAction) {
            actionsHtml += `<button class="media-action-btn media-action-play" id="btnMediaEpisodes"><span class="material-icons">list</span> Episodes</button>`;
        }
        actionsHtml += `<button class="media-action-btn media-action-trailer" id="btnMediaTrailer"><span class="material-icons">play_circle</span> Watch Trailer</button>`;

        body.innerHTML = `
            <div class="media-detail-header">
                <div class="media-detail-poster">
                    ${poster ? `<img src="${poster}" onerror="this.style.display='none'">` : '<span class="material-icons" style="font-size:64px;color:#484f58;display:flex;align-items:center;justify-content:center;height:100%">movie</span>'}
                </div>
                <div class="media-detail-info">
                    <h2 class="media-detail-title">${name}</h2>
                    ${ratingsHtml ? `<div class="media-detail-ratings">${ratingsHtml}</div>` : ''}
                    <div class="media-detail-meta">
                        ${year ? `<span>${year}</span>` : ''}
                        ${info.type ? `<span style="text-transform:capitalize">${info.type}</span>` : ''}
                        ${info.source && DNS[info.source] ? `<span class="source-tag ${DNS[info.source].color}" style="font-size:11px;padding:2px 8px">${DNS[info.source].name}</span>` : ''}
                    </div>
                    ${genres ? `<div class="media-detail-genres">${genres}</div>` : ''}
                    ${desc ? `<p class="media-detail-desc">${desc}</p>` : ''}
                    <div class="media-detail-actions">${actionsHtml}</div>
                </div>
            </div>
        `;

        // Wire up buttons
        if (info.playAction) {
            document.getElementById('btnMediaPlay').addEventListener('click', () => {
                this.closeMediaDetail();
                info.playAction();
            });
        }
        if (info.seriesAction) {
            document.getElementById('btnMediaEpisodes').addEventListener('click', () => {
                this.closeMediaDetail();
                info.seriesAction();
            });
        }
        document.getElementById('btnMediaTrailer').addEventListener('click', () => {
            this.openTrailer(name, year, info.type || 'movie', imdbId);
        });

        this.hideLoader();
    },

    closeMediaDetail() {
        document.getElementById('mediaDetailModal').classList.add('hidden');
    },

    _tryPlay(url, video, errorEl, meta) {
        console.log(`[Player] Trying: ${url}`);

        if (this.hls) { this.hls.destroy(); this.hls = null; }

        this.showLoader();

        // Hide spinner when video starts playing
        const onPlaying = () => {
            this.hideLoader();
            video.removeEventListener('playing', onPlaying);
        };
        video.addEventListener('playing', onPlaying);

        // Detect if this is a direct video file (not HLS)
        const isDirectVideo = /\.(mp4|mkv|avi|mov|webm|flv|wmv)(\?|$)/i.test(url)
            || url.includes('premiumize.me')
            || url.includes('download')
            || url.includes('dl.');

        // Detect if this is an HLS stream
        const isHLS = /\.(m3u8|m3u)(\?|$)/i.test(url) || url.includes('player_api');

        if (isDirectVideo) {
            // Direct video file — just set src, no HLS needed
            console.log('[Player] Direct video playback');
            video.src = proxyUrl(url);
            video.play().catch(e => {
                console.error('[Player] Direct play failed:', e);
                this.hideLoader();
                errorEl.textContent = 'Playback failed: ' + e.message;
                errorEl.classList.remove('hidden');
            });
            return;
        }

        // HLS stream handling
        const baseStreamUrl = url.replace(/\.(m3u8|ts|m3u)$/, '');
        const formats = ['.m3u8', '.ts', ''];
        const currentExt = url.match(/\.(m3u8|ts|m3u)$/)?.[0] || '.m3u8';

        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            this.hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
                maxBufferLength: 30,
                maxMaxBufferLength: 60,
                xhrSetup: (xhr, xhrUrl) => {
                    xhr.withCredentials = false;
                    // Proxy all HLS segment/manifest requests through CORS proxy
                    const proxied = proxyUrl(xhrUrl);
                    if (proxied !== xhrUrl) {
                        xhr.open('GET', proxied, true);
                    }
                }
            });
            this.hls.loadSource(proxyUrl(url));
            this.hls.attachMedia(video);
            this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                console.log('[Player] Manifest parsed, playing');
                video.play().catch(() => {});
            });
            this.hls.on(Hls.Events.ERROR, (event, data) => {
                console.warn('[Player] HLS error:', data.type, data.details, data.fatal);
                if (data.fatal) {
                    this._retryCount++;
                    // Try next format
                    const nextFormat = formats.find(f => f !== currentExt && !url.endsWith(f));
                    if (this._retryCount <= 3 && nextFormat !== undefined) {
                        const altUrl = baseStreamUrl + nextFormat;
                        console.log(`[Player] Retry #${this._retryCount} with: ${altUrl}`);
                        this.hls.destroy();
                        this.hls = null;
                        this._tryPlay(altUrl, video, errorEl, meta);
                        return;
                    }
                    // Try other server if available
                    if (this._retryCount <= 4 && meta?.source && meta?.id) {
                        const otherKey = meta.source === 'marble' ? 'pony' : 'marble';
                        if (this.servers[otherKey]?.success) {
                            const otherUrl = `${DNS[otherKey].url}/live/${encodeURIComponent(this.session.username)}/${encodeURIComponent(this.session.token)}/${meta.id}.m3u8`;
                            console.log(`[Player] Trying other server (${otherKey}): ${otherUrl}`);
                            this.hls.destroy();
                            this.hls = null;
                            this._tryPlay(otherUrl, video, errorEl, { ...meta, source: otherKey });
                            return;
                        }
                    }
                    this.hideLoader();
                    errorEl.textContent = 'Stream unavailable. Try a different channel.';
                    errorEl.classList.remove('hidden');
                    this._retryCount = 0;
                }
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = proxyUrl(url);
            video.play().catch(() => {});
        } else {
            // Fallback: try direct play
            video.src = proxyUrl(url);
            video.play().catch(() => {
                this.hideLoader();
                errorEl.textContent = 'Unable to play this stream format.';
                errorEl.classList.remove('hidden');
            });
        }
    },

    toggleCurrentFavorite() {
        if (!this.currentPlaying) return;
        const btn = document.getElementById('btnFavorite');
        const icon = btn.querySelector('.material-icons');
        const id = this.currentPlaying.id;

        const idx = this.favorites.findIndex(f => f.id === id);
        if (idx >= 0) {
            this.favorites.splice(idx, 1);
            icon.textContent = 'favorite_border';
            icon.classList.remove('fav-active');
        } else {
            this.favorites.push({
                id, name: this.currentPlaying.title, url: this.currentPlaying.url,
                icon: this.currentPlaying.icon || null, type: this.currentPlaying.type || 'live',
                source: this.currentPlaying.source, addedAt: Date.now()
            });
            icon.textContent = 'favorite';
            icon.classList.add('fav-active');
        }
        localStorage.setItem('sv_favorites', JSON.stringify(this.favorites));
    },

    // === Favorites ===
    renderFavorites() {
        const grid = document.getElementById('contentGrid');
        grid.className = 'content-grid list-view';
        grid.innerHTML = '';

        if (this.favorites.length === 0) {
            grid.innerHTML = '<div class="empty-state"><span class="material-icons">favorite_border</span><p>No favorites yet</p></div>';
            return;
        }

        this.favorites.forEach(fav => {
            const card = document.createElement('div');
            card.className = 'stream-card live-item';
            const srcColor = fav.source && DNS[fav.source] ? DNS[fav.source].color : '';
            card.innerHTML = `
                <div class="live-icon">
                    ${fav.icon ? `<img src="${fav.icon}" onerror="this.parentElement.innerHTML='<span class=\\'material-icons\\'>star</span>'">` : '<span class="material-icons">star</span>'}
                </div>
                <div class="card-info">
                    <div class="card-title">${fav.name}</div>
                    <div class="card-meta">${fav.type}</div>
                </div>
                ${srcColor ? `<span class="source-tag ${srcColor}">${DNS[fav.source]?.name}</span>` : ''}
            `;
            card.addEventListener('click', () => {
                this.openPlayer(fav.url, fav.name, { id: fav.id, type: fav.type, icon: fav.icon, source: fav.source });
            });
            grid.appendChild(card);
        });
    },

    // === Long-press to add favorites ===
    _longPressTimer: null,
    _longPressTriggered: false,

    addLongPress(el, item) {
        let timer = null;
        let triggered = false;

        const start = (e) => {
            triggered = false;
            timer = setTimeout(() => {
                triggered = true;
                e.preventDefault();
                e.stopPropagation();
                this.showFavoritePrompt(item);
            }, 600);
        };

        const cancel = () => {
            clearTimeout(timer);
        };

        const click = (e) => {
            if (triggered) {
                e.preventDefault();
                e.stopPropagation();
                triggered = false;
            }
        };

        el.addEventListener('mousedown', start);
        el.addEventListener('touchstart', start, { passive: false });
        el.addEventListener('mouseup', cancel);
        el.addEventListener('touchend', cancel);
        el.addEventListener('mouseleave', cancel);
        el.addEventListener('touchcancel', cancel);
        el.addEventListener('click', click, true);
    },

    showFavoritePrompt(item) {
        // Remove existing prompt
        document.getElementById('favPrompt')?.remove();

        const isFav = this.favorites.some(f => f.id === item.id && f.section === item.section);
        const actionText = isFav ? 'Remove from Favorites?' : 'Add to Favorites?';
        const actionIcon = isFav ? 'heart_broken' : 'favorite';

        const overlay = document.createElement('div');
        overlay.id = 'favPrompt';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#1a1a2e;border:1px solid #333;border-radius:16px;padding:24px 32px;text-align:center;max-width:320px;">
                <span class="material-icons" style="font-size:48px;color:#00D4FF;margin-bottom:12px">${actionIcon}</span>
                <h3 style="margin:0 0 4px;font-size:16px;color:#fff">${actionText}</h3>
                <p style="margin:0 0 20px;font-size:13px;color:#888;word-break:break-word">${item.name}</p>
                <div style="display:flex;gap:12px;justify-content:center">
                    <button id="favPromptYes" style="padding:10px 28px;background:#00D4FF;color:#000;border:none;border-radius:10px;font-weight:600;cursor:pointer;font-size:14px">Yes</button>
                    <button id="favPromptNo" style="padding:10px 28px;background:#333;color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:14px">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        document.getElementById('favPromptNo').addEventListener('click', () => overlay.remove());
        document.getElementById('favPromptYes').addEventListener('click', () => {
            if (isFav) {
                this.favorites = this.favorites.filter(f => !(f.id === item.id && f.section === item.section));
            } else {
                this.favorites.push({
                    id: item.id,
                    name: item.name,
                    url: item.url || null,
                    icon: item.icon || null,
                    poster: item.poster || null,
                    type: item.type || 'live',
                    section: item.section || 'live',  // live, vod, series, stremio
                    source: item.source || null,
                    meta: item.meta || null,
                    addedAt: Date.now()
                });
            }
            localStorage.setItem('sv_favorites', JSON.stringify(this.favorites));
            overlay.remove();
        });
    },

    // === Recently Viewed ===
    trackRecentlyViewed(item) {
        // Remove if already exists
        this.recentlyViewed = this.recentlyViewed.filter(r => !(r.id === item.id && r.section === item.section));
        // Add to front
        this.recentlyViewed.unshift({
            id: item.id,
            name: item.name,
            url: item.url || null,
            icon: item.icon || null,
            poster: item.poster || null,
            type: item.type || 'live',
            section: item.section || 'live',
            source: item.source || null,
            meta: item.meta || null,
            viewedAt: Date.now()
        });
        // Keep max 50
        if (this.recentlyViewed.length > 50) this.recentlyViewed = this.recentlyViewed.slice(0, 50);
        localStorage.setItem('sv_recently_viewed', JSON.stringify(this.recentlyViewed));
    },

    renderSectionFavorites(section, type) {
        const grid = document.getElementById('contentGrid');
        grid.innerHTML = '';
        const favs = this.favorites.filter(f => f.section === section);

        if (favs.length === 0) {
            grid.innerHTML = '<div class="empty-state"><span class="material-icons">favorite_border</span><p>No favorites in this section</p></div>';
            return;
        }

        if (type === 'live') {
            grid.className = 'content-grid list-view';
            favs.forEach(fav => {
                const card = document.createElement('div');
                card.className = 'stream-card live-item';
                card.innerHTML = `
                    <div class="live-icon">
                        ${fav.icon ? `<img src="${fav.icon}" onerror="this.parentElement.innerHTML='<span class=\\'material-icons\\'>star</span>'">` : '<span class="material-icons">star</span>'}
                    </div>
                    <div class="card-info">
                        <div class="card-title">${fav.name}</div>
                        <div class="card-meta">Favorite</div>
                    </div>
                `;
                card.addEventListener('click', () => {
                    if (fav.url) this.openPlayer(fav.url, fav.name, { id: fav.id, type: fav.type, icon: fav.icon, source: fav.source });
                });
                this.addLongPress(card, fav);
                grid.appendChild(card);
            });
        } else {
            grid.className = 'content-grid';
            favs.forEach(fav => {
                const img = fav.poster || fav.icon || '';
                const card = document.createElement('div');
                card.className = 'stream-card';
                card.innerHTML = `
                    <div class="poster">
                        ${img ? `<img src="${img}" onerror="this.parentElement.innerHTML='<span class=\\'material-icons placeholder-icon\\'>movie</span>'">` : '<span class="material-icons placeholder-icon">movie</span>'}
                    </div>
                    <div class="card-info">
                        <div class="card-title">${fav.name}</div>
                    </div>
                `;
                card.addEventListener('click', () => {
                    if (fav.meta) {
                        this.openMediaDetail(fav.meta);
                    } else if (fav.url) {
                        this.openPlayer(fav.url, fav.name, { id: fav.id, type: fav.type, icon: fav.icon, source: fav.source });
                    }
                });
                this.addLongPress(card, fav);
                grid.appendChild(card);
            });
        }
    },

    renderSectionRecent(section, type) {
        const grid = document.getElementById('contentGrid');
        grid.innerHTML = '';
        const recents = this.recentlyViewed.filter(r => r.section === section);

        if (recents.length === 0) {
            grid.innerHTML = '<div class="empty-state"><span class="material-icons">history</span><p>No recently viewed items</p></div>';
            return;
        }

        if (type === 'live') {
            grid.className = 'content-grid list-view';
            recents.forEach(item => {
                const card = document.createElement('div');
                card.className = 'stream-card live-item';
                card.innerHTML = `
                    <div class="live-icon">
                        ${item.icon ? `<img src="${item.icon}" onerror="this.parentElement.innerHTML='<span class=\\'material-icons\\'>history</span>'">` : '<span class="material-icons">history</span>'}
                    </div>
                    <div class="card-info">
                        <div class="card-title">${item.name}</div>
                        <div class="card-meta">Recently Viewed</div>
                    </div>
                `;
                card.addEventListener('click', () => {
                    if (item.url) this.openPlayer(item.url, item.name, { id: item.id, type: item.type, icon: item.icon, source: item.source });
                });
                this.addLongPress(card, item);
                grid.appendChild(card);
            });
        } else {
            grid.className = 'content-grid';
            recents.forEach(item => {
                const img = item.poster || item.icon || '';
                const card = document.createElement('div');
                card.className = 'stream-card';
                card.innerHTML = `
                    <div class="poster">
                        ${img ? `<img src="${img}" onerror="this.parentElement.innerHTML='<span class=\\'material-icons placeholder-icon\\'>movie</span>'">` : '<span class="material-icons placeholder-icon">movie</span>'}
                    </div>
                    <div class="card-info">
                        <div class="card-title">${item.name}</div>
                    </div>
                `;
                card.addEventListener('click', () => {
                    if (item.meta) {
                        this.openMediaDetail(item.meta);
                    } else if (item.url) {
                        this.openPlayer(item.url, item.name, { id: item.id, type: item.type, icon: item.icon, source: item.source });
                    }
                });
                this.addLongPress(card, item);
                grid.appendChild(card);
            });
        }
    },

    // === Stremio Panel ===
    _stremioTab: 'board',
    _stremioSearchQuery: '',
    _stremioSearchTimeout: null,

    initStremio() {
        // Reset to board tab on entry
        this._stremioFocusZone = 'tabs';
        this._stremioTabIdx = 0;
        this._stremioRow = 0;
        this._stremioCol = 0;
        this._stremioIdx = 0;
        document.querySelectorAll('.stremio-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.stremio-tab[data-stab="board"]').classList.add('active');
        this.switchStremioTab('board');
        // Show focus on first tab so user knows they can navigate
        this._clearFocus();
        const firstTab = document.querySelector('.stremio-tab');
        if (firstTab) firstTab.classList.add('remote-focus');
    },

    switchStremioTab(tab) {
        this._stremioTab = tab;
        const searchInput = document.getElementById('stremioSearch');
        searchInput.style.display = tab === 'search' ? '' : 'none';
        if (tab === 'search') searchInput.focus();

        switch(tab) {
            case 'board': this.renderStremioBoard(); break;
            case 'discover': this.renderStremioDiscover(); break;
            case 'search': this.renderStremioSearchPage(); break;
        }
    },

    // Board: horizontal scrolling catalog rows from all installed addons
    async renderStremioBoard() {
        const content = document.getElementById('stremioContent');
        content.innerHTML = '';
        this.showLoader();

        if (this.stremioAddons.length === 0) {
            content.innerHTML = `
                <div class="stremio-empty">
                    <span class="material-icons" style="font-size:64px;color:#8B5CF6;margin-bottom:16px">extension</span>
                    <h3 style="margin:0 0 8px">No addons installed</h3>
                    <p style="color:#8b949e">Go to the Addons tab to install Stremio addons and start browsing.</p>
                </div>
            `;
            return;
        }

        const rows = [];

        // Add Recently Viewed row for Stremio
        const stremioRecent = this.recentlyViewed.filter(r => r.section === 'stremio');
        if (stremioRecent.length > 0) {
            const recentSection = document.createElement('div');
            recentSection.className = 'stremio-catalog-row';
            recentSection.innerHTML = '<h3 class="stremio-row-title"><span class="material-icons" style="font-size:18px;color:#00D4FF;vertical-align:middle;margin-right:4px">history</span>Recently Viewed</h3>';
            const recentScroller = document.createElement('div');
            recentScroller.className = 'stremio-row-scroller';
            stremioRecent.slice(0, 20).forEach(item => {
                const card = document.createElement('div');
                card.className = 'stremio-poster-card';
                card.innerHTML = `
                    <div class="stremio-poster-img">
                        ${item.poster ? `<img src="${item.poster}" loading="lazy" onerror="this.parentElement.innerHTML='<span class=\\'material-icons\\' style=\\'font-size:40px;color:#484f58\\'>movie</span>'">` : '<span class="material-icons" style="font-size:40px;color:#484f58">movie</span>'}
                    </div>
                    <div class="stremio-poster-title">${item.name}</div>
                `;
                card.addEventListener('click', () => {
                    if (item.meta) {
                        this.openStremioDetail(item.meta, item.meta._addon || this.stremioAddons[0]);
                    }
                });
                this.addLongPress(card, { ...item, section: 'stremio' });
                recentScroller.appendChild(card);
            });
            recentSection.appendChild(recentScroller);
            content.appendChild(recentSection);
        }

        // Add Favorites row for Stremio
        const stremioFavs = this.favorites.filter(f => f.section === 'stremio');
        if (stremioFavs.length > 0) {
            const favSection = document.createElement('div');
            favSection.className = 'stremio-catalog-row';
            favSection.innerHTML = '<h3 class="stremio-row-title"><span class="material-icons" style="font-size:18px;color:#00D4FF;vertical-align:middle;margin-right:4px">favorite</span>Favorites</h3>';
            const favScroller = document.createElement('div');
            favScroller.className = 'stremio-row-scroller';
            stremioFavs.forEach(fav => {
                const card = document.createElement('div');
                card.className = 'stremio-poster-card';
                card.innerHTML = `
                    <div class="stremio-poster-img">
                        ${fav.poster ? `<img src="${fav.poster}" loading="lazy" onerror="this.parentElement.innerHTML='<span class=\\'material-icons\\' style=\\'font-size:40px;color:#484f58\\'>movie</span>'">` : '<span class="material-icons" style="font-size:40px;color:#484f58">movie</span>'}
                    </div>
                    <div class="stremio-poster-title">${fav.name}</div>
                `;
                card.addEventListener('click', () => {
                    if (fav.meta) {
                        this.openStremioDetail(fav.meta, fav.meta._addon || this.stremioAddons[0]);
                    }
                });
                this.addLongPress(card, { ...fav, section: 'stremio' });
                favScroller.appendChild(card);
            });
            favSection.appendChild(favScroller);
            content.appendChild(favSection);
        }

        // Load Trending Movies & Trending Shows from Cinemeta first
        const cinemetaAddon = this.stremioAddons.find(a => a.manifest?.id === 'com.linvo.cinemeta');
        const trendingPromises = [];
        if (cinemetaAddon) {
            trendingPromises.push(
                this.fetchWithTimeout(`${cinemetaAddon.url}/catalog/movie/top.json`, 10000)
                    .then(r => r.json())
                    .then(data => {
                        if (data.metas?.length > 0) {
                            rows.push({ title: 'Trending Movies', type: 'movie', metas: data.metas.slice(0, 30), addon: cinemetaAddon, _priority: 0 });
                        }
                    }).catch(e => console.warn('[Stremio] Trending movies failed:', e.message)),
                this.fetchWithTimeout(`${cinemetaAddon.url}/catalog/series/top.json`, 10000)
                    .then(r => r.json())
                    .then(data => {
                        if (data.metas?.length > 0) {
                            rows.push({ title: 'Trending Shows', type: 'series', metas: data.metas.slice(0, 30), addon: cinemetaAddon, _priority: 1 });
                        }
                    }).catch(e => console.warn('[Stremio] Trending shows failed:', e.message))
            );
        }

        // Load regular catalogs from each addon in parallel
        const catalogPromises = this.stremioAddons.map(async (addon) => {
            const catalogs = addon.manifest?.catalogs || [];
            const results = [];
            for (const catalog of catalogs.slice(0, 3)) {
                // Skip the 'top' catalogs if we already loaded them as trending
                if (cinemetaAddon && addon.url === cinemetaAddon.url && catalog.id === 'top') continue;
                try {
                    const url = `${addon.url}/catalog/${catalog.type}/${catalog.id}.json`;
                    const resp = await this.fetchWithTimeout(url, 10000);
                    const data = await resp.json();
                    if (data.metas?.length > 0) {
                        results.push({
                            title: `${addon.name} - ${catalog.name || catalog.id}`,
                            type: catalog.type,
                            metas: data.metas.slice(0, 30),
                            addon,
                            _priority: 10
                        });
                    }
                } catch(e) {
                    console.warn(`[Stremio] Failed to load catalog ${catalog.id} from ${addon.name}:`, e.message);
                }
            }
            return results;
        });

        await Promise.allSettled([...trendingPromises, ...catalogPromises.map(async p => {
            const r = await p;
            if (r) rows.push(...r);
        })]);

        content.innerHTML = '';
        if (rows.length === 0) {
            content.innerHTML = '<div class="stremio-empty"><p style="color:#8b949e">No catalogs available. Try adding more addons.</p></div>';
            return;
        }

        // Sort: trending first, then regular catalogs
        rows.sort((a, b) => (a._priority || 10) - (b._priority || 10));

        rows.forEach(row => {
            const section = document.createElement('div');
            section.className = 'stremio-catalog-row';
            const isTrending = (row._priority || 10) < 10;
            const icon = isTrending ? '<span class="material-icons" style="font-size:18px;color:#f5c518;vertical-align:middle;margin-right:4px">trending_up</span>' : '';
            section.innerHTML = `<h3 class="stremio-row-title">${icon}${row.title}</h3>`;

            const scroller = document.createElement('div');
            scroller.className = 'stremio-row-scroller';

            row.metas.forEach(meta => {
                const card = this._createStremioCard(meta, row.addon);
                scroller.appendChild(card);
            });

            section.appendChild(scroller);
            content.appendChild(section);
        });
        this.hideLoader();
    },

    // Discover: browse by type and genre using Cinemeta catalogs
    _discoverType: 'movie',
    _discoverGenre: null,
    _discoverGenres: {
        movie: ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Musical', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western'],
        series: ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western']
    },

    async renderStremioDiscover() {
        const content = document.getElementById('stremioContent');
        content.innerHTML = '';

        // Type toggle (Movie / Series)
        const typeBar = document.createElement('div');
        typeBar.className = 'stremio-filter-bar';
        typeBar.id = 'stremioTypeBar';
        ['movie', 'series'].forEach(type => {
            const btn = document.createElement('button');
            btn.className = 'stremio-filter-btn' + (type === this._discoverType ? ' active' : '');
            btn.textContent = type === 'movie' ? 'Movies' : 'Series';
            btn.addEventListener('click', () => {
                this._discoverType = type;
                this._discoverGenre = null;
                this.renderStremioDiscover();
            });
            typeBar.appendChild(btn);
        });
        content.appendChild(typeBar);

        // Genre bar
        const genreBar = document.createElement('div');
        genreBar.className = 'stremio-filter-bar stremio-genre-bar';
        genreBar.id = 'stremioGenreBar';
        const genres = this._discoverGenres[this._discoverType] || [];

        const allBtn = document.createElement('button');
        allBtn.className = 'stremio-filter-btn' + (!this._discoverGenre ? ' active' : '');
        allBtn.textContent = 'All';
        allBtn.addEventListener('click', () => {
            this._discoverGenre = null;
            this._loadDiscoverGrid();
            genreBar.querySelectorAll('.stremio-filter-btn').forEach(b => b.classList.remove('active'));
            allBtn.classList.add('active');
        });
        genreBar.appendChild(allBtn);

        genres.forEach(genre => {
            const btn = document.createElement('button');
            btn.className = 'stremio-filter-btn' + (this._discoverGenre === genre ? ' active' : '');
            btn.textContent = genre;
            btn.addEventListener('click', () => {
                this._discoverGenre = genre;
                this._loadDiscoverGrid();
                genreBar.querySelectorAll('.stremio-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
            genreBar.appendChild(btn);
        });
        content.appendChild(genreBar);

        // Grid
        const grid = document.createElement('div');
        grid.className = 'stremio-discover-grid';
        grid.id = 'stremioDiscoverGrid';
        content.appendChild(grid);

        await this._loadDiscoverGrid();
    },

    async _loadDiscoverGrid() {
        const grid = document.getElementById('stremioDiscoverGrid');
        if (!grid) return;
        grid.innerHTML = '';
        this.showLoader();

        const type = this._discoverType;
        const genre = this._discoverGenre;
        const cinemetaAddon = this.stremioAddons.find(a => a.manifest?.id === 'com.linvo.cinemeta');
        const baseUrl = cinemetaAddon ? cinemetaAddon.url : 'https://v3-cinemeta.strem.io';

        // Build URL with genre filter
        let url = `${baseUrl}/catalog/${type}/top.json`;
        if (genre) {
            url = `${baseUrl}/catalog/${type}/top/genre=${encodeURIComponent(genre)}.json`;
        }

        try {
            const resp = await this.fetchWithTimeout(url, 15000);
            const data = await resp.json();
            const metas = data.metas || [];

            grid.innerHTML = '';
            if (metas.length === 0) {
                grid.innerHTML = '<p style="color:#8b949e;padding:20px">No content found.</p>';
                this.hideLoader();
                return;
            }

            metas.slice(0, 100).forEach(meta => {
                const card = this._createStremioCard(meta, cinemetaAddon || this.stremioAddons[0]);
                grid.appendChild(card);
            });
        } catch(e) {
            console.warn('[Discover] Failed:', e.message);
            grid.innerHTML = '<p style="color:#8b949e;padding:20px">Failed to load content. Try again.</p>';
        }
        this.hideLoader();
    },

    // Search page
    renderStremioSearchPage() {
        const content = document.getElementById('stremioContent');
        content.innerHTML = '';

        const grid = document.createElement('div');
        grid.className = 'stremio-discover-grid';
        grid.id = 'stremioSearchGrid';
        grid.innerHTML = '<div class="stremio-empty"><span class="material-icons" style="font-size:48px;color:#484f58">search</span><p style="color:#8b949e;margin-top:12px">Type to search across all addons</p></div>';
        content.appendChild(grid);
    },

    handleStremioSearch(query) {
        this._stremioSearchQuery = query;
        clearTimeout(this._stremioSearchTimeout);
        if (!query || query.length < 2) return;

        this._stremioSearchTimeout = setTimeout(() => this._executeStremioSearch(query), 400);
    },

    async _executeStremioSearch(query) {
        const grid = document.getElementById('stremioSearchGrid');
        if (!grid) return;
        grid.innerHTML = '';
        this.showLoader();

        const allMetas = [];
        const promises = [];

        this.stremioAddons.forEach(addon => {
            const catalogs = addon.manifest?.catalogs || [];
            // Search catalogs that support search
            catalogs.forEach(catalog => {
                const hasSearch = catalog.extra?.some(e => e.name === 'search');
                if (hasSearch) {
                    const url = `${addon.url}/catalog/${catalog.type}/${catalog.id}/search=${encodeURIComponent(query)}.json`;
                    promises.push(
                        this.fetchWithTimeout(url, 10000)
                            .then(r => r.json())
                            .then(data => {
                                (data.metas || []).forEach(m => allMetas.push({ ...m, _addon: addon }));
                            })
                            .catch(() => {})
                    );
                }
            });
        });

        await Promise.allSettled(promises);

        // If still on the same query
        if (this._stremioSearchQuery !== query) return;

        const seen = new Set();
        const unique = allMetas.filter(m => {
            const key = m.imdb_id || m.id || m.name;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        grid.innerHTML = '';
        if (unique.length === 0) {
            grid.innerHTML = `<div class="stremio-empty"><p style="color:#8b949e">No results for "${query}"</p></div>`;
            return;
        }

        unique.forEach(meta => {
            const card = this._createStremioCard(meta, meta._addon);
            grid.appendChild(card);
        });
        this.hideLoader();
    },

    // Create a stremio poster card
    _createStremioCard(meta, addon) {
        const card = document.createElement('div');
        card.className = 'stremio-poster-card';
        card.innerHTML = `
            <div class="stremio-poster-img">
                ${meta.poster ? `<img src="${meta.poster}" loading="lazy" onerror="this.parentElement.innerHTML='<span class=\\'material-icons\\' style=\\'font-size:40px;color:#484f58\\'>movie</span>'">` : '<span class="material-icons" style="font-size:40px;color:#484f58">movie</span>'}
            </div>
            <div class="stremio-poster-title">${meta.name || 'Unknown'}</div>
        `;
        card.addEventListener('click', () => {
            this.trackRecentlyViewed({
                id: meta.imdb_id || meta.id || meta.name,
                name: meta.name || 'Unknown',
                poster: meta.poster || null,
                type: meta.type || 'movie',
                section: 'stremio',
                meta: { name: meta.name, poster: meta.poster, type: meta.type, imdb_id: meta.imdb_id, id: meta.id, _addon: addon }
            });
            this.openStremioDetail(meta, addon);
        });
        this.addLongPress(card, {
            id: meta.imdb_id || meta.id || meta.name,
            name: meta.name || 'Unknown',
            poster: meta.poster || null,
            type: meta.type || 'movie',
            section: 'stremio'
        });
        return card;
    },

    // Detail view
    async openStremioDetail(meta, addon) {
        const detail = document.getElementById('stremioDetail');
        const bg = document.getElementById('stremioDetailBg');
        const body = document.getElementById('stremioDetailBody');

        const bgImg = meta.background || meta.poster || '';
        bg.style.backgroundImage = bgImg ? `url(${bgImg})` : 'none';
        detail.classList.remove('hidden');

        const year = meta.releaseInfo || meta.year || '';
        const genres = meta.genres?.join(', ') || '';
        const desc = meta.description || '';
        const type = meta.type || 'movie';
        let imdbRating = meta.imdbRating || '';

        // Fetch OMDB for MPAA + RT (non-blocking, updates UI when ready)
        let mpaa = '';
        let rtScore = '';
        const imdbId = meta.imdb_id || (meta.id?.startsWith('tt') ? meta.id : '');

        // Build initial ratings
        const buildRatings = () => {
            let html = '';
            if (mpaa) html += `<span class="media-rating-badge mpaa-badge">${mpaa}</span>`;
            if (imdbRating) html += `<span class="media-rating-badge imdb-badge"><span class="material-icons">star</span> ${imdbRating}</span>`;
            if (rtScore) html += `<span class="media-rating-badge rt-badge">🍅 ${rtScore}</span>`;
            return html;
        };

        const renderBody = () => {
            body.innerHTML = `
                <div class="stremio-detail-header">
                    <div class="stremio-detail-poster">
                        ${meta.poster ? `<img src="${meta.poster}">` : '<span class="material-icons" style="font-size:64px;color:#484f58">movie</span>'}
                    </div>
                    <div class="stremio-detail-info">
                        <h2 class="stremio-detail-title">${meta.name || 'Unknown'}</h2>
                        <div class="media-detail-ratings" id="stremioRatings">${buildRatings()}</div>
                        <div class="stremio-detail-meta">
                            ${year ? `<span>${year}</span>` : ''}
                            ${type ? `<span class="stremio-type-badge">${type}</span>` : ''}
                        </div>
                        ${genres ? `<div class="stremio-detail-genres">${genres}</div>` : ''}
                        ${desc ? `<p class="stremio-detail-desc">${desc}</p>` : ''}
                        <div class="stremio-play-actions" id="stremioPlayActions" style="display:none">
                            <button class="stremio-autoplay-btn" id="btnAutoPlay">
                                <span class="material-icons">play_arrow</span> Auto Play
                            </button>
                        </div>
                        <button class="btn-trailer" id="btnTrailer">
                            <span class="material-icons">play_circle</span> Watch Trailer
                        </button>
                    </div>
                </div>
                <div class="stremio-streams-section">
                    <h3><span class="material-icons" style="font-size:20px;vertical-align:middle;margin-right:6px">play_circle</span>Streams</h3>
                    <div id="stremioStreamList" class="stremio-stream-list"></div>
                </div>
            `;
            document.getElementById('btnTrailer').addEventListener('click', () => {
                this.openTrailer(meta.name, year, type, imdbId);
            });
        };

        renderBody();

        // Fetch OMDB in background and update ratings when ready
        if (imdbId) {
            const omdbKey = localStorage.getItem('sv_omdb_key') || '';
            if (omdbKey) {
                this._fetchOmdb(imdbId, omdbKey).then(omdb => {
                    if (omdb) {
                        if (omdb.mpaa) mpaa = omdb.mpaa;
                        if (omdb.rt) rtScore = omdb.rt;
                        if (omdb.imdbRating && !imdbRating) imdbRating = omdb.imdbRating;
                        const ratingsEl = document.getElementById('stremioRatings');
                        if (ratingsEl) ratingsEl.innerHTML = buildRatings();
                    }
                });
            }
        }

        // If series, also try to show seasons/episodes
        if (type === 'series' && meta.videos?.length > 0) {
            this._renderSeriesStreams(meta, addon);
        } else {
            this._loadStreamsForMeta(meta, addon);
        }
    },

    async _fetchOmdb(imdbId, apiKey) {
        try {
            const resp = await this.fetchWithTimeout(`https://www.omdbapi.com/?i=${imdbId}&apikey=${apiKey}`, 5000);
            const data = await resp.json();
            if (data.Response !== 'False') {
                const rt = (data.Ratings || []).find(r => r.Source === 'Rotten Tomatoes');
                return {
                    mpaa: (data.Rated && data.Rated !== 'N/A') ? data.Rated : '',
                    rt: rt ? rt.Value : '',
                    imdbRating: (data.imdbRating && data.imdbRating !== 'N/A') ? data.imdbRating : ''
                };
            }
        } catch(e) {
            console.warn('[OMDB] Failed:', e.message);
        }
        return null;
    },

    // Parse stream quality/seeders from Torrentio/Comet stream title/description
    _parseStreamInfo(stream) {
        const text = `${stream.name || ''} ${stream.title || ''} ${stream.description || ''}`.toLowerCase();

        // Parse resolution
        let resolution = 'unknown';
        if (text.includes('2160p') || text.includes('4k') || text.includes('uhd')) resolution = '2160p';
        else if (text.includes('1080p') || text.includes('1080')) resolution = '1080p';
        else if (text.includes('720p') || text.includes('720')) resolution = '720p';
        else if (text.includes('480p') || text.includes('480')) resolution = '480p';

        // Parse seeders - look for patterns like "👤 123" or "S:123" or "seeders: 123" or just "123" after seed-related text
        let seeders = 0;
        const seederPatterns = [
            /👤\s*(\d+)/,
            /seeders?[:\s]+(\d+)/i,
            /\bS[:\s]*(\d+)/,
            /⬆️\s*(\d+)/,
        ];
        for (const pat of seederPatterns) {
            const m = text.match(pat);
            if (m) { seeders = parseInt(m[1]); break; }
        }
        // Also check the behaviorHints or other fields
        if (!seeders && stream.behaviorHints?.seeders) seeders = stream.behaviorHints.seeders;

        // Parse size
        let size = '';
        const sizeMatch = text.match(/(\d+(?:\.\d+)?\s*(?:gb|mb|tb))/i);
        if (sizeMatch) size = sizeMatch[1].toUpperCase();

        return { resolution, seeders, size };
    },

    // Auto-select best stream: prefer 1080p with highest seeders
    _pickBestStream(streams) {
        // Filter to 1080p streams first
        const parsed = streams.map(s => ({ stream: s, ...this._parseStreamInfo(s) }));
        const hd1080 = parsed.filter(s => s.resolution === '1080p');

        // If we have 1080p streams, pick the one with most seeders
        if (hd1080.length > 0) {
            hd1080.sort((a, b) => b.seeders - a.seeders);
            return hd1080[0].stream;
        }

        // Fallback: pick best available by resolution priority then seeders
        const resPriority = { '2160p': 3, '1080p': 2, '720p': 1, '480p': 0, 'unknown': -1 };
        parsed.sort((a, b) => {
            const resDiff = (resPriority[b.resolution] || 0) - (resPriority[a.resolution] || 0);
            if (resDiff !== 0) return resDiff;
            return b.seeders - a.seeders;
        });
        return parsed[0]?.stream || null;
    },

    async _loadStreamsForMeta(meta, addon) {
        const list = document.getElementById('stremioStreamList');
        if (!list) return;

        const allStreams = [];

        // Query all addons that support this type for streams
        const promises = this.stremioAddons.map(async (a) => {
            const types = a.manifest?.types || [];
            if (!types.includes(meta.type)) return;

            try {
                const url = `${a.url}/stream/${meta.type}/${encodeURIComponent(meta.id)}.json`;
                console.log(`[Stremio] Fetching streams from ${a.name}: ${url}`);
                const resp = await this.fetchWithTimeout(url, 15000);
                const data = await resp.json();
                console.log(`[Stremio] ${a.name}: got ${(data.streams || []).length} streams`);
                (data.streams || []).forEach(s => {
                    allStreams.push({ ...s, _addonName: a.name });
                });
            } catch(e) {
                console.warn(`[Stremio] Stream fetch failed from ${a.name}:`, e.message);
            }
        });

        await Promise.allSettled(promises);

        // Store streams for auto-play
        this._currentStreams = allStreams;
        this._currentStreamMeta = meta;

        list.innerHTML = '';
        if (allStreams.length === 0) {
            list.innerHTML = '<div class="stremio-empty" style="padding:16px"><p style="color:#8b949e">No streams found for this title.</p></div>';
            return;
        }

        // Show auto-play button
        const actions = document.getElementById('stremioPlayActions');
        if (actions) {
            actions.style.display = 'flex';
            document.getElementById('btnAutoPlay').onclick = () => this._autoPlay(allStreams, meta);
        }

        // Show stream list
        this._showStreamList(allStreams, meta);
        this.hideLoader();
    },

    async _autoPlay(streams, meta) {
        const list = document.getElementById('stremioStreamList');
        const best = this._pickBestStream(streams);
        if (!best) {
            if (list) list.innerHTML = '<div class="stremio-empty" style="padding:16px"><p style="color:#ff4444">No playable streams found.</p></div>';
            return;
        }

        const info = this._parseStreamInfo(best);
        if (list) {
            list.innerHTML = `<div style="padding:16px;color:#00D4FF;text-align:center">
                <div style="margin-top:12px">Auto-playing ${info.resolution} stream${info.seeders ? ` (${info.seeders} seeders)` : ''}...</div>
            </div>`;
            this.showLoader();
        }

        await this._playStream(best, meta);
        this.hideLoader();
    },

    async _playStream(stream, meta) {
        const hasUrl = !!stream.url;
        const needsDebrid = stream.infoHash && !stream.url;

        if (hasUrl) {
            this.closeStremioDetail();
            this.openPlayer(stream.url, meta.name || 'Stream', { id: meta.id, type: meta.type, icon: meta.poster });
        } else if (needsDebrid && this.premiumizeKey) {
            await this._resolveDebrid(stream, meta);
        } else if (needsDebrid) {
            const list = document.getElementById('stremioStreamList');
            if (list) list.innerHTML = '<div style="padding:16px;color:#ff4444;text-align:center">Premiumize API key required to play torrent streams.</div>';
        }
    },

    _showStreamList(streams, meta, container) {
        const list = container || document.getElementById('stremioStreamList');
        if (!list) return;
        if (!container) list.innerHTML = '';

        // Only show 4K streams - filter out anything below 4K
        const filtered = streams.filter(s => {
            const info = this._parseStreamInfo(s);
            return info.resolution === '2160p';
        });

        // If no 4K streams, show all streams as fallback
        const toShow = filtered.length > 0 ? filtered : streams;

        if (filtered.length === 0 && streams.length > 0) {
            const notice = document.createElement('div');
            notice.style.cssText = 'padding:8px 12px;color:#f5c518;font-size:12px;opacity:0.7;';
            notice.textContent = 'No 4K streams available — showing all qualities';
            list.appendChild(notice);
        }

        toShow.forEach(stream => {
            const item = document.createElement('div');
            item.className = 'stremio-stream-item';

            const info = this._parseStreamInfo(stream);
            let title = stream.name || stream.title || 'Stream';
            let desc = stream.description || '';
            const badge = stream._addonName;
            const needsDebrid = stream.infoHash && !stream.url;

            // Build quality/seeder badges
            let badges = `<span class="stremio-stream-addon">${badge}</span>`;
            if (info.resolution !== 'unknown') {
                const resColor = info.resolution === '2160p' ? '#f5c518' : info.resolution === '1080p' ? '#22c55e' : info.resolution === '720p' ? '#00D4FF' : '#888';
                badges += ` <span class="stremio-stream-res" style="color:${resColor}">${info.resolution}</span>`;
            }
            if (info.seeders > 0) {
                badges += ` <span class="stremio-stream-seeders">👤 ${info.seeders}</span>`;
            }
            if (info.size) {
                badges += ` <span class="stremio-stream-size">${info.size}</span>`;
            }
            if (needsDebrid) {
                badges += ` <span class="stremio-stream-debrid" title="Premiumize">⚡ Debrid</span>`;
            }

            item.innerHTML = `
                <div class="stremio-stream-info">
                    <div class="stremio-stream-title">${title}</div>
                    ${desc ? `<div class="stremio-stream-desc">${desc}</div>` : ''}
                </div>
                <div class="stremio-stream-badges">${badges}</div>
            `;

            item.addEventListener('click', () => this._playStream(stream, meta));
            list.appendChild(item);
        });
    },

    _renderSeriesStreams(meta, addon) {
        const list = document.getElementById('stremioStreamList');
        if (!list) return;

        // Group videos by season
        const seasons = {};
        (meta.videos || []).forEach(v => {
            const s = v.season || 1;
            if (!seasons[s]) seasons[s] = [];
            seasons[s].push(v);
        });

        list.innerHTML = '';
        Object.keys(seasons).sort((a,b) => a - b).forEach(season => {
            const header = document.createElement('div');
            header.className = 'stremio-season-header';
            header.textContent = `Season ${season}`;
            list.appendChild(header);

            seasons[season].sort((a,b) => (a.episode||0) - (b.episode||0)).forEach(ep => {
                const item = document.createElement('div');
                item.className = 'stremio-stream-item';
                item.innerHTML = `
                    <div class="stremio-stream-info">
                        <div class="stremio-stream-title">E${ep.episode}: ${ep.title || ep.name || 'Episode ' + ep.episode}</div>
                        <div class="stremio-stream-desc">${ep.overview || ''}</div>
                    </div>
                    <span class="material-icons stremio-stream-play">play_circle</span>
                `;
                item.addEventListener('click', () => {
                    const videoId = `${meta.id}:${ep.season}:${ep.episode}`;
                    this._loadEpisodeStreams(videoId, meta, ep);
                });
                list.appendChild(item);
            });
        });
    },

    async _loadEpisodeStreams(videoId, meta, episode) {
        const list = document.getElementById('stremioStreamList');
        if (!list) return;

        list.innerHTML = '';
        this.showLoader();

        const allStreams = [];
        const promises = this.stremioAddons.map(async (a) => {
            const types = a.manifest?.types || [];
            if (!types.includes('series')) return;
            try {
                const url = `${a.url}/stream/series/${encodeURIComponent(videoId)}.json`;
                const resp = await this.fetchWithTimeout(url, 10000);
                const data = await resp.json();
                (data.streams || []).forEach(s => allStreams.push({ ...s, _addonName: a.name }));
            } catch(e) {}
        });

        await Promise.allSettled(promises);

        list.innerHTML = '';
        const backBtn = document.createElement('button');
        backBtn.className = 'stremio-stream-back';
        backBtn.innerHTML = '<span class="material-icons">arrow_back</span> Back to episodes';
        backBtn.addEventListener('click', () => this._renderSeriesStreams(meta));
        list.appendChild(backBtn);

        const epMeta = { ...meta, name: `${meta.name} S${episode.season}E${episode.episode}` };

        if (allStreams.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'stremio-empty';
            empty.innerHTML = '<p style="color:#8b949e;padding:16px">No streams for this episode.</p>';
            list.appendChild(empty);
            return;
        }

        // Auto play button for episodes
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'stremio-play-actions';
        actionsDiv.style.display = 'flex';
        actionsDiv.innerHTML = `
            <button class="stremio-autoplay-btn" id="btnEpAutoPlay">
                <span class="material-icons">play_arrow</span> Auto Play
            </button>
        `;
        list.appendChild(actionsDiv);

        document.getElementById('btnEpAutoPlay').addEventListener('click', () => this._autoPlay(allStreams, epMeta));

        // Show stream list directly
        this._showStreamList(allStreams, epMeta, list);
        this.hideLoader();
    },

    async _resolveDebrid(stream, meta) {
        if (!this.premiumizeKey || !stream.infoHash) {
            console.error('[Debrid] No API key or infoHash');
            return;
        }

        const list = document.getElementById('stremioStreamList');

        try {
            console.log(`[Debrid] Resolving ${stream.infoHash} via Premiumize...`);

            // Build magnet link with trackers if available
            let magnet = `magnet:?xt=urn:btih:${stream.infoHash}`;
            if (stream.sources) {
                stream.sources.forEach(s => {
                    if (s.startsWith('tracker:')) magnet += `&tr=${encodeURIComponent(s.replace('tracker:', ''))}`;
                });
            }

            // Try cache check first (instant if cached)
            const cacheResp = await this.fetchWithTimeout(
                `https://www.premiumize.me/api/cache/check?apikey=${encodeURIComponent(this.premiumizeKey)}&items[]=${encodeURIComponent(stream.infoHash)}`,
                10000
            );
            const cacheData = await cacheResp.json();
            console.log('[Debrid] Cache check:', cacheData);

            // Direct download (works for both cached and uncached)
            const formData = new FormData();
            formData.append('src', magnet);

            const dlResp = await fetch(`https://www.premiumize.me/api/transfer/directdl?apikey=${encodeURIComponent(this.premiumizeKey)}`, {
                method: 'POST',
                body: formData
            });
            const dlData = await dlResp.json();
            console.log('[Debrid] DirectDL response:', dlData);

            if (dlData.status === 'success' && dlData.content?.length > 0) {
                // Find the largest video file
                const videoExts = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'];
                let videoFiles = dlData.content.filter(f => {
                    const name = (f.path || f.link || '').toLowerCase();
                    return videoExts.some(ext => name.includes(ext)) || f.mime_type?.startsWith('video/');
                });

                // If no video ext match, just sort by size
                if (videoFiles.length === 0) videoFiles = dlData.content;
                videoFiles.sort((a, b) => (b.size || 0) - (a.size || 0));

                if (videoFiles[0]?.link) {
                    console.log('[Debrid] Playing:', videoFiles[0].link);
                    this.closeStremioDetail();
                    this.openPlayer(videoFiles[0].link, meta.name || 'Stream', { id: meta.id, type: meta.type, icon: meta.poster });
                    return;
                }
            }

            // If directdl failed, show error
            const errMsg = dlData.message || 'Could not resolve stream';
            console.warn('[Debrid] Failed:', dlData);
            if (list) {
                const errDiv = document.createElement('div');
                errDiv.style.cssText = 'padding:12px;color:#ff4444;text-align:center;';
                errDiv.textContent = `Debrid error: ${errMsg}`;
                list.prepend(errDiv);
            }
        } catch(e) {
            console.error('[Debrid] Error:', e);
            if (list) {
                const errDiv = document.createElement('div');
                errDiv.style.cssText = 'padding:12px;color:#ff4444;text-align:center;';
                errDiv.textContent = `Debrid error: ${e.message}`;
                list.prepend(errDiv);
            }
        }
    },

    closeStremioDetail() {
        document.getElementById('stremioDetail').classList.add('hidden');
    },

    // === EPG Clock & Timezone ===
    _startEpgClock() {
        this._updateEpgClock();
        setInterval(() => this._updateEpgClock(), 1000);
    },

    _updateEpgClock() {
        const el = document.getElementById('epgClock');
        if (!el) return;
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', {
            timeZone: this._userTz,
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
        const tzShort = this._getTzAbbrev(this._userTz);
        el.textContent = timeStr + ' ' + tzShort;
    },

    _getTzAbbrev(tz) {
        const map = {
            'America/New_York': 'ET',
            'America/Chicago': 'CT',
            'America/Denver': 'MT',
            'America/Los_Angeles': 'PT',
            'America/Anchorage': 'AKT',
            'Pacific/Honolulu': 'HT'
        };
        return map[tz] || 'CT';
    },

    _openTzPicker() {
        const modal = document.getElementById('tzModal');
        modal.classList.remove('hidden');
        // Highlight current selection
        const btns = [...document.querySelectorAll('.tz-btn')];
        btns.forEach(b => b.classList.toggle('active', b.dataset.tz === this._userTz));
        // Set focus to current timezone
        this._tzFocusIdx = btns.findIndex(b => b.dataset.tz === this._userTz);
        if (this._tzFocusIdx < 0) this._tzFocusIdx = 0;
        this._clearFocus();
        if (btns[this._tzFocusIdx]) btns[this._tzFocusIdx].classList.add('remote-focus');
    },

    _handleTzModalKeys(e) {
        const btns = [...document.querySelectorAll('.tz-btn')];
        if (!btns.length) return;
        switch(e.key) {
            case 'ArrowUp':
                e.preventDefault();
                this._tzFocusIdx = Math.max(0, this._tzFocusIdx - 1);
                this._focusElement(btns, this._tzFocusIdx);
                break;
            case 'ArrowDown':
                e.preventDefault();
                this._tzFocusIdx = Math.min(btns.length - 1, this._tzFocusIdx + 1);
                this._focusElement(btns, this._tzFocusIdx);
                break;
            case 'Enter':
                e.preventDefault();
                if (btns[this._tzFocusIdx]) btns[this._tzFocusIdx].click();
                break;
            case 'Escape': case 'Backspace': case 'GoBack':
                e.preventDefault();
                document.getElementById('tzModal').classList.add('hidden');
                break;
        }
    },

    // === EPG / TV Guide ===
    epgCache: {}, // Cache: serverKey -> { streamId -> [programs] }

    async loadEpg() {
        const channelList = document.getElementById('epgChannelList');

        channelList.innerHTML = '';
        this.showLoader();

        try {
            const allServers = this.getActiveServers();

            const allChannels = [];
            const catSet = new Map();

            // Load channels, categories, and bulk XMLTV EPG in parallel
            const [channelResults, catResults] = await Promise.all([
                Promise.allSettled(allServers.map(key => this.xtreamGet(key, 'get_live_streams'))),
                Promise.allSettled(allServers.map(key => this.xtreamGet(key, 'get_live_categories')))
            ]);

            // Start loading bulk EPG in background (don't block channel loading)
            console.log('[EPG] Loading bulk EPG for servers:', allServers);
            Promise.allSettled(allServers.map(key => this.loadBulkEpg(key))).catch(() => {});

            // Collect categories
            catResults.forEach((r) => {
                if (r.status === 'fulfilled' && r.value) {
                    (r.value || []).forEach(cat => {
                        if (!catSet.has(cat.category_id)) {
                            catSet.set(cat.category_id, cat.category_name);
                        }
                    });
                }
            });

            // Build category chip bar
            const catBar = document.getElementById('epgCatBar');
            const prevCat = this.epgCategory || 'all';
            catBar.innerHTML = '';

            // "All" chip always first
            const allChip = document.createElement('button');
            allChip.className = 'epg-cat-chip' + (prevCat === 'all' ? ' active' : '');
            allChip.dataset.cat = 'all';
            allChip.textContent = 'All';
            catBar.appendChild(allChip);

            // Sort: Full HD USA first, then USA categories, then rest alphabetical
            const sortedCats = [...catSet.entries()].sort((a, b) => {
                const aName = a[1].toLowerCase();
                const bName = b[1].toLowerCase();
                const aFullHdUsa = aName.includes('full hd') && aName.includes('usa');
                const bFullHdUsa = bName.includes('full hd') && bName.includes('usa');
                const aUsa = aName.includes('usa') || aName.includes('us ') || aName.includes('united states');
                const bUsa = bName.includes('usa') || bName.includes('us ') || bName.includes('united states');
                if (aFullHdUsa && !bFullHdUsa) return -1;
                if (bFullHdUsa && !aFullHdUsa) return 1;
                if (aUsa && !bUsa) return -1;
                if (bUsa && !aUsa) return 1;
                return aName.localeCompare(bName);
            });

            sortedCats.forEach(([id, name]) => {
                const chip = document.createElement('button');
                chip.className = 'epg-cat-chip' + (String(prevCat) === String(id) ? ' active' : '');
                chip.dataset.cat = id;
                chip.textContent = name;
                catBar.appendChild(chip);
            });

            this.epgCategory = prevCat;
            this.epgCategories = catSet;

            // Collect channels and enrich with category names
            channelResults.forEach((r, i) => {
                if (r.status === 'fulfilled' && r.value) {
                    console.log(`[EPG] ${allServers[i]}: loaded ${r.value.length} channels`);
                    (r.value || []).forEach(ch => {
                        const catName = catSet.get(ch.category_id) || catSet.get(String(ch.category_id)) || '';
                        allChannels.push({ ...ch, _source: allServers[i], category_name: catName });
                    });
                } else {
                    console.error(`[EPG] ${allServers[i]} channels FAILED:`, r.status, r.reason?.message || r.value);
                }
            });

            if (allChannels.length === 0 && allServers.length > 0) {
                channelList.innerHTML = `<div style="padding:16px;color:#ff8844">Servers connected but no channels loaded. Check console (F12) for errors.<br>Servers tried: ${allServers.join(', ')}</div>`;
                return;
            }

            this.epgAllChannels = allChannels;
            await this.renderEpgFiltered();

        } catch (e) {
            console.error('[EPG] loadEpg error:', e);
            channelList.innerHTML = `<div style="padding:16px;color:#ff4444">Failed to load: ${e.message}</div>`;
        } finally {
            this.hideLoader();
        }
    },

    // Helper: fetch with timeout + CORS proxy (compatible with all browsers)
    async fetchWithTimeout(url, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const proxied = proxyUrl(url);
            const resp = await fetch(proxied, { signal: controller.signal });
            clearTimeout(timer);
            return resp;
        } catch(e) {
            clearTimeout(timer);
            throw e;
        }
    },

    // Load the full XMLTV EPG data for a server and cache it by epg_channel_id
    async loadBulkEpg(serverKey) {
        if (this.epgCache[serverKey] && Object.keys(this.epgCache[serverKey]).length > 0) {
            console.log(`[EPG] Using cached EPG for ${serverKey}`);
            return;
        }

        const s = this.servers[serverKey];
        if (!s || !s.success) return;

        this.epgCache[serverKey] = {};

        // Try the Xtream get_simple_data_table for all streams
        try {
            const url = `${s.baseUrl}/player_api.php?username=${encodeURIComponent(this.session.username)}&password=${encodeURIComponent(this.session.token)}&action=get_simple_data_table&stream_id=all`;
            console.log(`[EPG] Trying bulk get_simple_data_table for ${serverKey}...`);
            const resp = await this.fetchWithTimeout(url, 15000);
            const data = await resp.json();

            if (data?.epg_listings && data.epg_listings.length > 0) {
                console.log(`[EPG] Bulk EPG for ${serverKey}: ${data.epg_listings.length} listings`);
                data.epg_listings.forEach(item => {
                    const chId = item.stream_id || item.channel_id || item.epg_id;
                    if (!chId) return;
                    if (!this.epgCache[serverKey][chId]) this.epgCache[serverKey][chId] = [];
                    const parsed = this.parseEpgItem(item);
                    if (parsed) this.epgCache[serverKey][chId].push(parsed);
                });
                return;
            }
        } catch(e) {
            console.warn(`[EPG] Bulk get_simple_data_table failed for ${serverKey}:`, e.message);
        }

        // Fallback: try XMLTV endpoint
        try {
            const xmlUrl = `${s.baseUrl}/xmltv.php?username=${encodeURIComponent(this.session.username)}&password=${encodeURIComponent(this.session.token)}`;
            console.log(`[EPG] Trying XMLTV for ${serverKey}...`);
            const resp = await this.fetchWithTimeout(xmlUrl, 30000);
            const xmlText = await resp.text();

            if (xmlText && xmlText.includes('<programme')) {
                console.log(`[EPG] XMLTV loaded for ${serverKey}, parsing...`);
                this.parseXmltvEpg(serverKey, xmlText);
                return;
            }
        } catch(e) {
            console.warn(`[EPG] XMLTV failed for ${serverKey}:`, e.message);
        }

        console.log(`[EPG] No bulk EPG available for ${serverKey}, will try per-channel`);
    },

    parseEpgItem(item) {
        let start, end;

        if (item.start_timestamp) {
            start = new Date(Number(item.start_timestamp) * 1000);
        } else if (item.start) {
            start = new Date(item.start.replace(' ', 'T'));
            if (isNaN(start)) start = new Date(item.start);
        }

        if (item.stop_timestamp) {
            end = new Date(Number(item.stop_timestamp) * 1000);
        } else if (item.end) {
            end = new Date(item.end.replace(' ', 'T'));
            if (isNaN(end)) end = new Date(item.end);
        } else if (item.stop) {
            end = new Date(item.stop.replace(' ', 'T'));
            if (isNaN(end)) end = new Date(item.stop);
        }

        if (!start || isNaN(start)) return null;
        if (!end || isNaN(end)) end = new Date(start.getTime() + 30 * 60000);

        let title = item.title || item.name || '';
        try {
            const decoded = atob(title);
            if (decoded && decoded.length > 0 && /[\x20-\x7E]/.test(decoded.charAt(0))) title = decoded;
        } catch(e) {}

        let desc = item.description || item.desc || '';
        try {
            const decoded = atob(desc);
            if (decoded && decoded.length > 0 && /[\x20-\x7E]/.test(decoded.charAt(0))) desc = decoded;
        } catch(e) {}

        return { title, start, end, description: desc };
    },

    parseXmltvEpg(serverKey, xmlText) {
        try {
            const parser = new DOMParser();
            const xml = parser.parseFromString(xmlText, 'text/xml');
            const programmes = xml.querySelectorAll('programme');
            let count = 0;

            programmes.forEach(prog => {
                const chId = prog.getAttribute('channel');
                const startStr = prog.getAttribute('start');
                const stopStr = prog.getAttribute('stop');
                const titleEl = prog.querySelector('title');

                if (!chId || !startStr) return;

                const start = this.parseXmltvDate(startStr);
                const end = stopStr ? this.parseXmltvDate(stopStr) : new Date(start.getTime() + 30 * 60000);
                const title = titleEl?.textContent || '';
                const descEl = prog.querySelector('desc');
                const desc = descEl?.textContent || '';

                if (!this.epgCache[serverKey][chId]) this.epgCache[serverKey][chId] = [];
                this.epgCache[serverKey][chId].push({ title, start, end, description: desc });
                count++;
            });

            console.log(`[EPG] XMLTV parsed ${count} programmes for ${serverKey}`);
        } catch(e) {
            console.warn('[EPG] XMLTV parse error:', e);
        }
    },

    parseXmltvDate(str) {
        // XMLTV format: 20240101120000 +0000
        const match = str.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
        if (match) {
            const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[7] ? match[7].replace(/(\d{2})(\d{2})/, '$1:$2') : ''}`;
            return new Date(iso);
        }
        return new Date(str);
    },

    async renderEpgFiltered() {
        const channelList = document.getElementById('epgChannelList');
        const timeline = document.getElementById('epgTimeline');
        const programs = document.getElementById('epgPrograms');

        console.log('[EPG] renderEpgFiltered, allChannels:', this.epgAllChannels?.length);

        channelList.innerHTML = '';
        this.showLoader();
        programs.innerHTML = '<div class="epg-now-line" id="epgNowLine"></div>';
        timeline.innerHTML = '';

      try {
        const now = new Date();
        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + this.epgDateOffset);
        const dayStart = new Date(targetDate);
        dayStart.setHours(0, 0, 0, 0);

        // Build timeline
        for (let h = 0; h < 24; h++) {
            const slot = document.createElement('div');
            slot.className = 'epg-time-slot' + (this.epgDateOffset === 0 && h === now.getHours() ? ' now' : '');
            const hour = h % 12 || 12;
            slot.textContent = `${hour}:00 ${h < 12 ? 'AM' : 'PM'}`;
            timeline.appendChild(slot);
        }
        const totalWidth = 24 * 200;
        programs.style.width = totalWidth + 'px';
        timeline.style.width = totalWidth + 'px';

        // Filter + deduplicate
        let filtered = this.epgAllChannels || [];
        if (this.epgSource !== 'all') filtered = filtered.filter(ch => ch._source === this.epgSource);
        if (this.epgCategory !== 'all') filtered = filtered.filter(ch => String(ch.category_id) === String(this.epgCategory));

        const seen = new Map();
        filtered.forEach(ch => { const k = (ch.name||'').toLowerCase().trim(); if (!seen.has(k)) seen.set(k, ch); });
        filtered = [...seen.values()];

        // Sort: USA Full HD Marble first
        const getCatName = (ch) => (ch.category_name || '').toLowerCase();
        filtered.sort((a, b) => {
            const aTop = getCatName(a).includes('usa') && getCatName(a).includes('full hd') && a._source === 'marble';
            const bTop = getCatName(b).includes('usa') && getCatName(b).includes('full hd') && b._source === 'marble';
            if (aTop && !bTop) return -1;
            if (bTop && !aTop) return 1;
            return (a.name || '').localeCompare(b.name || '');
        });
        filtered = filtered.slice(0, 200);

        this.epgChannels = filtered;
        this._epgEpgResults = {};

        if (filtered.length === 0) {
            channelList.innerHTML = '<div class="epg-empty-row">No channels found</div>';
            return;
        }

        // STEP 1: Render channels + empty program rows IMMEDIATELY (no waiting for EPG)
        channelList.innerHTML = '';
        const progFragment = document.createDocumentFragment();
        const channelFragment = document.createDocumentFragment();

        filtered.forEach((ch, idx) => {
            const srcColor = DNS[ch._source]?.color || 'marble';
            const srcName = DNS[ch._source]?.name || ch._source;

            // Channel row
            const row = document.createElement('div');
            row.className = 'epg-channel-row';
            row.dataset.idx = idx;
            row.innerHTML = `
                <span class="epg-channel-num">${ch.num || (idx + 1)}</span>
                ${ch.stream_icon ? `<img class="epg-channel-icon" src="${ch.stream_icon}" loading="lazy" onerror="this.style.background='#21262d';this.removeAttribute('src')">` : '<div class="epg-channel-icon" style="display:flex;align-items:center;justify-content:center"><span class="material-icons" style="font-size:16px;color:#484f58">tv</span></div>'}
                <div class="epg-channel-info">
                    <span class="epg-channel-name">${ch.name}</span>
                    <span class="epg-channel-now" id="epgChNow${idx}"></span>
                </div>
                <span class="epg-channel-source ${srcColor}">${srcName}</span>
            `;
            row.addEventListener('click', () => {
                this._epgSelectedIdx = idx;
                this.updateEpgNowBar();
                const baseUrl = DNS[ch._source].url;
                const url = `${baseUrl}/live/${encodeURIComponent(this.session.username)}/${encodeURIComponent(this.session.token)}/${ch.stream_id}.m3u8`;
                this.openPlayer(url, ch.name, { id: String(ch.stream_id), type: 'live', icon: ch.stream_icon, source: ch._source });
            });
            channelFragment.appendChild(row);

            // Empty program row (will be filled by EPG later)
            const progRow = document.createElement('div');
            progRow.className = 'epg-program-row';
            progRow.id = `epgProg${idx}`;
            progRow.style.cursor = 'pointer';
            progRow.addEventListener('click', () => {
                const baseUrl = DNS[ch._source].url;
                const url = `${baseUrl}/live/${encodeURIComponent(this.session.username)}/${encodeURIComponent(this.session.token)}/${ch.stream_id}.m3u8`;
                this.openPlayer(url, ch.name, { id: String(ch.stream_id), type: 'live', icon: ch.stream_icon, source: ch._source });
            });
            // Show "loading" placeholder
            const ph = document.createElement('div');
            ph.className = 'epg-program';
            ph.style.cssText = `left:0;width:${totalWidth}px`;
            ph.innerHTML = '<span class="prog-title" style="color:#484f58">Loading...</span>';
            progRow.appendChild(ph);
            progFragment.appendChild(progRow);
        });

        channelList.appendChild(channelFragment);
        programs.appendChild(progFragment);

        // Position now line + scroll
        if (this.epgDateOffset === 0) { this.updateNowLine(); this.scrollEpgToNow(); }
        else { document.getElementById('epgNowLine').style.display = 'none'; }

        // STEP 2: Load EPG in batches of 10 in background, fill in as they arrive
        const BATCH = 10;
        for (let i = 0; i < filtered.length; i += BATCH) {
            const batch = filtered.slice(i, i + BATCH);
            const batchIdxStart = i;

            // Fire batch in parallel
            const results = await Promise.allSettled(
                batch.map(ch => this.loadChannelEpg(ch, dayStart))
            );

            // Fill in each channel's program row as results come in
            results.forEach((r, j) => {
                const idx = batchIdxStart + j;
                const ch = filtered[idx];
                const epg = r.status === 'fulfilled' ? r.value : [];
                const progRow = document.getElementById(`epgProg${idx}`);
                if (!progRow) return;

                let nowPlaying = '';
                if (epg.length > 0 && this.epgDateOffset === 0) {
                    const np = epg.find(p => now >= new Date(p.start) && now <= new Date(p.end));
                    if (np) nowPlaying = np.title || '';
                }
                this._epgEpgResults[idx] = { channel: ch, epg, nowPlaying };

                // Update "now playing" text under channel name
                const nowEl = document.getElementById(`epgChNow${idx}`);
                if (nowEl) nowEl.textContent = nowPlaying;

                // Clear placeholder and render programs
                progRow.innerHTML = '';

                if (epg.length > 0) {
                    epg.forEach(prog => {
                        const start = new Date(prog.start);
                        const end = new Date(prog.end);
                        const startMin = (start - dayStart) / 60000;
                        const duration = (end - start) / 60000;
                        if (startMin + duration < 0 || startMin > 24 * 60) return;

                        const left = Math.max(0, startMin) * this.PX_PER_MIN;
                        const width = Math.max(30, Math.min(duration, 24*60 - Math.max(0, startMin)) * this.PX_PER_MIN - 2);
                        const isNow = now >= start && now <= end && this.epgDateOffset === 0;

                        const el = document.createElement('div');
                        el.className = 'epg-program' + (isNow ? ' live-now' : '');
                        el.style.left = left + 'px';
                        el.style.width = width + 'px';

                        const startStr = start.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
                        const endStr = end.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
                        let progressHtml = '';
                        if (isNow) {
                            progressHtml = `<div class="prog-progress" style="width:${Math.min(100,(now-start)/(end-start)*100)}%"></div>`;
                        }
                        el.innerHTML = `<span class="prog-title">${prog.title||'No Info'}</span><span class="prog-time">${startStr} - ${endStr}</span>${progressHtml}`;
                        el.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const baseUrl = DNS[ch._source].url;
                            const url = `${baseUrl}/live/${encodeURIComponent(this.session.username)}/${encodeURIComponent(this.session.token)}/${ch.stream_id}.m3u8`;
                            this.openPlayer(url, ch.name+' - '+(prog.title||''), {id:String(ch.stream_id),type:'live',icon:ch.stream_icon,source:ch._source});
                        });
                        progRow.appendChild(el);
                    });
                } else {
                    const el = document.createElement('div');
                    el.className = 'epg-program';
                    el.style.cssText = `left:0;width:${totalWidth}px`;
                    el.innerHTML = '<span class="prog-title" style="color:#484f58">No guide data</span>';
                    progRow.appendChild(el);
                }
            });
        }

        this.updateEpgNowBar();

      } catch(e) {
        console.error('[EPG] renderEpgFiltered error:', e);
        channelList.innerHTML = `<div style="padding:20px;color:#ff4444;text-align:center">Error: ${e.message}</div>`;
      } finally {
        this.hideLoader();
      }
    },

    _epgSelectedIdx: null,

    updateEpgNowBar() {
        const bar = document.getElementById('epgNowBar');
        const text = document.getElementById('epgNowBarText');
        if (!bar || !text) return;

        const idx = this._epgSelectedIdx;
        if (idx === null || !this._epgEpgResults?.[idx]) {
            // If no channel selected, show first channel or hide
            if (this.currentPlaying?.type === 'live' && this._epgEpgResults) {
                // Find channel matching current playing
                const found = Object.values(this._epgEpgResults).find(r =>
                    String(r.channel.stream_id) === String(this.currentPlaying.id)
                );
                if (found) {
                    bar.classList.remove('hidden');
                    text.innerHTML = `<span class="now-channel">${found.channel.name}</span><span class="now-program"> — ${found.nowPlaying || 'No info'}</span>`;
                    return;
                }
            }
            bar.classList.add('hidden');
            return;
        }

        const data = this._epgEpgResults[idx];
        bar.classList.remove('hidden');
        const srcBadge = `<span class="epg-channel-source ${DNS[data.channel._source]?.color}" style="margin-left:6px">${DNS[data.channel._source]?.name}</span>`;
        text.innerHTML = `<span class="now-channel">${data.channel.name}</span>${srcBadge}<span class="now-program"> — ${data.nowPlaying || 'No info'}</span>`;
    },

    async loadChannelEpg(channel, dayStart) {
        const source = channel._source;
        const sid = channel.stream_id;
        const epgId = channel.epg_channel_id || '';

        // Check bulk cache first (by stream_id, then epg_channel_id)
        const cache = this.epgCache[source];
        if (cache) {
            if (cache[sid] && cache[sid].length > 0) return cache[sid];
            if (epgId && cache[epgId] && cache[epgId].length > 0) return cache[epgId];
        }

        // Fallback: per-channel API calls
        const methods = [
            { action: 'get_simple_data_table', extra: `&stream_id=${sid}` },
            { action: 'get_short_epg', extra: `&stream_id=${sid}&limit=100` }
        ];

        for (const method of methods) {
            try {
                const data = await this.xtreamGet(source, method.action, method.extra);
                if (!data) continue;

                const listings = data.epg_listings || data.items || [];
                if (!listings || listings.length === 0) continue;

                const parsed = listings.map(item => this.parseEpgItem(item)).filter(Boolean);
                if (parsed.length > 0) {
                    console.log(`[EPG] ${method.action} for "${channel.name}": ${parsed.length} items`);
                    return parsed;
                }
            } catch (e) {
                // silent fail, try next method
            }
        }

        return [];
    },

    updateNowLine() {
        const line = document.getElementById('epgNowLine');
        if (!line) return;
        const now = new Date();
        const dayStart = new Date(now);
        dayStart.setHours(0, 0, 0, 0);
        const minSinceMidnight = (now - dayStart) / 60000;
        line.style.left = (minSinceMidnight * this.PX_PER_MIN) + 'px';
        line.style.display = '';
    },

    scrollEpgToNow() {
        const scrollArea = document.getElementById('epgScrollArea');
        if (!scrollArea) return;
        const now = new Date();
        const dayStart = new Date(now);
        dayStart.setHours(0, 0, 0, 0);
        const minSinceMidnight = (now - dayStart) / 60000;
        const px = minSinceMidnight * this.PX_PER_MIN;
        // Offset by channel col width (220px) and center a bit
        scrollArea.scrollLeft = Math.max(0, px - 200);
    },

    // === Search ===
    handleSearch(query) {
        if (!query) {
            document.querySelectorAll('.stream-card').forEach(c => c.style.display = '');
            return;
        }
        const q = query.toLowerCase();
        document.querySelectorAll('.stream-card').forEach(card => {
            const title = card.querySelector('.card-title')?.textContent?.toLowerCase() || '';
            card.style.display = title.includes(q) ? '' : 'none';
        });
    },

    // === Settings ===
    renderSettings() {
        const grid = document.getElementById('contentGrid');
        grid.className = 'content-grid';

        const marbleStatus = this.servers.marble?.success ? '<span style="color:#22c55e">Connected</span>' : '<span style="color:#ef4444">Not connected</span>';
        const ponyStatus = this.servers.pony?.success ? '<span style="color:#22c55e">Connected</span>' : '<span style="color:#ef4444">Not connected</span>';

        grid.innerHTML = `
            <div class="settings-container">
                <div class="settings-item">
                    <label>Username</label>
                    <div class="value">${this.session?.username || 'N/A'}</div>
                </div>
                <div class="settings-item">
                    <label>DNS 1 - Marble (pradahype.com)</label>
                    <div class="value">${marbleStatus}</div>
                </div>
                <div class="settings-item">
                    <label>DNS 2 - Premium (pinkponyclub.online)</label>
                    <div class="value">${ponyStatus}</div>
                </div>
                ${this.servers.marble?.userInfo ? `
                <div class="settings-item">
                    <label>Max Connections</label>
                    <div class="value">${this.servers.marble.userInfo.max_connections || 'N/A'}</div>
                </div>
                <div class="settings-item">
                    <label>Expires</label>
                    <div class="value">${this.servers.marble.userInfo.exp_date ? new Date(this.servers.marble.userInfo.exp_date * 1000).toLocaleDateString() : 'N/A'}</div>
                </div>
                ` : ''}
                <div class="settings-item">
                    <label>Stremio Addons</label>
                    <div class="value">${this.stremioAddons.length} installed</div>
                </div>
                <div class="settings-item">
                    <label>Premiumize</label>
                    <div class="value">${this.premiumizeKey ? 'Key configured' : 'Not configured'}</div>
                </div>
                <div class="settings-item">
                    <label>CORS Proxy URL <span style="font-size:11px;color:#8b949e">(Cloudflare Worker URL — required for web app)</span></label>
                    <input type="text" id="corsProxyInput" class="settings-input" placeholder="https://ekctv-proxy.YOURACCOUNT.workers.dev" value="${localStorage.getItem('sv_cors_proxy') || CORS_PROXY}">
                    <button class="settings-save-btn" id="btnSaveCorsProxy">Save</button>
                </div>
                <div class="settings-item">
                    <label>OMDB API Key <span style="font-size:11px;color:#8b949e">(free at omdbapi.com - for MPAA ratings & Rotten Tomatoes)</span></label>
                    <input type="text" id="omdbKeyInput" class="settings-input" placeholder="Enter OMDB API key" value="${localStorage.getItem('sv_omdb_key') || ''}">
                    <button class="settings-save-btn" id="btnSaveOmdb">Save</button>
                </div>
                <button class="btn-logout" onclick="App.logout()">Logout</button>
            </div>
        `;

        // CORS proxy save handler
        document.getElementById('btnSaveCorsProxy').addEventListener('click', () => {
            const val = document.getElementById('corsProxyInput').value.trim().replace(/\/+$/, '');
            localStorage.setItem('sv_cors_proxy', val);
            document.getElementById('btnSaveCorsProxy').textContent = 'Saved! Reload to apply.';
            setTimeout(() => { document.getElementById('btnSaveCorsProxy').textContent = 'Save'; }, 2500);
        });

        // OMDB key save handler
        document.getElementById('btnSaveOmdb').addEventListener('click', () => {
            const key = document.getElementById('omdbKeyInput').value.trim();
            localStorage.setItem('sv_omdb_key', key);
            document.getElementById('btnSaveOmdb').textContent = 'Saved!';
            setTimeout(() => { document.getElementById('btnSaveOmdb').textContent = 'Save'; }, 1500);
        });
    },

    logout() {
        localStorage.removeItem('sv_session');
        localStorage.removeItem('sv_servers');
        this.session = null;
        this.servers = {};
        document.getElementById('mainScreen').classList.remove('active');
        document.getElementById('loginScreen').classList.add('active');
        document.getElementById('loginStatus').innerHTML = '';
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
