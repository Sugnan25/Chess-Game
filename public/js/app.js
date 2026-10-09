/**
 * Chess Arena - Professional Online & Local Chess Application
 * Features:
 * - 4-Second Strategic AI Engine across all difficulty levels
 * - Custom Piece Shapes: Staunton Classic & Metallic Coins/Tokens
 * - 7 Rich Board Themes: Tournament Green, Walnut Wood, Modern Slate, Obsidian Dark, Emerald Velvet, Cherry Blossom, Cyberpunk Neon
 * - Movements on Left Side (Chess.com layout) with responsive toggle
 * - King In Danger Alert & Safe Escape Corridor Suggestions (🛡️ Shields & 🚫 Danger indicators)
 * - Game Over Cheering Animation & Confetti Explosion for Winners
 * - Uplifting Grandmaster Motivation Quotes for Defeated Players
 * - User Authentication with 6-Digit Email Verification Code & Verified Badge
 * - Notifications System with Badge Counter & Friend Request Accept/Decline
 * - Real-Time In-Game Chat & Messages with Quick Reaction Dock
 * - Strict FIDE Chess Rules enforcement via bundled chess.js (King can never be captured; game stops at checkmate)
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. Session & Storage Persistence
  // ---------------------------------------------------------------------------
  var SESSION_KEY = 'chess_arena_session_id';
  var sessionId = localStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = 'sess_' + Math.random().toString(36).substring(2, 12) + '_' + Date.now().toString(36);
    try {
      localStorage.setItem(SESSION_KEY, sessionId);
    } catch {}
  }

  // Settings
  var settings = {
    sound: localStorage.getItem('chess_sound') !== 'false',
    soundPack: localStorage.getItem('chess_sound_pack') || 'tournament',
    hints: localStorage.getItem('chess_hints') !== 'false',
    lastMove: localStorage.getItem('chess_lastmove') !== 'false',
    coords: localStorage.getItem('chess_coords') !== 'false',
    evalBar: localStorage.getItem('chess_eval_bar') !== 'false',
    kingAlert: localStorage.getItem('chess_king_alert') !== 'false',
    animations: localStorage.getItem('chess_animations') !== 'false',
    autoQueen: localStorage.getItem('chess_auto_queen') === 'true',
    materialShelf: localStorage.getItem('chess_material_shelf') !== 'false',
    autoFlip: localStorage.getItem('chess_auto_flip') === 'true',
    pieceStyle: localStorage.getItem('chess_piece_style') || 'staunton',
    movementsLayout: localStorage.getItem('chess_movements_layout') || 'left',
    theme: localStorage.getItem('chess_theme') || 'tournament'
  };

  // ---------------------------------------------------------------------------
  // 2. Engine & Game State
  // ---------------------------------------------------------------------------
  var ChessEngine = window.ChessJS ? window.ChessJS.Chess : window.Chess;
  var chessClient = new ChessEngine();

  var state = null;
  var userInGame = false;
  var isSinglePlayer = true;
  var chosenLevel = 'medium';
  var chosenColor = 'white';
  var chosenTimeControl = 600; // 10 min default
  var chosenFriendTimeControl = 600;
  var isCasualMode = false;
  var casualElapsedSeconds = 0;
  var flipped = false;

  var boardSize = 560;
  var squareSize = 70;

  var selectedSquare = -1;
  var legalTargets = [];
  var hintSquares = [];
  var isDragging = false;
  var dragStartSquare = -1;
  var dragPieceType = null;
  var dragMovedDistance = 0;

  var pendingPromotion = null;
  var sseSource = null;
  var pollTimer = null;
  var soundEnabled = true;

  // Clocks
  var whiteClockSeconds = 600;
  var blackClockSeconds = 600;
  var clockTimer = null;
  var isBotThinking = false;
  var botCountdownSeconds = 4.0;
  var botCountdownInterval = null;

  // Review Stepper
  var reviewPly = -1;

  // King Safety & Escape Suggestions
  var showKingEscapesActive = false;
  var kingSafetyInfo = {
    inCheck: false,
    kingSquare: -1,
    safeEscapes: [],
    attackers: [],
    defenders: []
  };

  // Auth & Social State
  var currentUser = null;
  var pendingVerifyUser = null;
  var notificationsList = [];

  // DOM Elements cache
  var el = {};
  function $(id) {
    return document.getElementById(id);
  }

  function initElements() {
    [
      'app', 'screen-home', 'screen-game', 'game-arena', 'sidebar-column', 'board-column',
      'player-name-input', 'level-selector', 'btn-start-computer',
      'time-selector-computer', 'time-selector-friend',
      'btn-host-room', 'input-room-code', 'btn-join-room',
      'btn-brand', 'nav-btn-computer', 'nav-btn-friend', 'nav-btn-friends-modal',
      'select-piece-style',
      'btn-sound-toggle', 'sound-icon-state', 'btn-settings-open', 'header-theme-picker',
      'btn-notifications', 'notif-badge', 'notifications-dropdown', 'notif-head-count', 'notif-list',
      'btn-user-auth', 'user-avatar-tag', 'user-name-tag', 'user-verified-badge',
      'sidebar-tabs', 'tab-btn-moves', 'tab-btn-chat', 'chat-unread-dot',
      'pane-moves', 'pane-chat',
      'king-danger-banner',
      'hud-opponent', 'opp-avatar', 'opp-name', 'opp-badge', 'opp-status-dot', 'opp-status-text', 'opp-captured-shelf', 'opp-clock', 'opp-turn-halo',
      'hud-you', 'you-avatar', 'you-name', 'you-status-dot', 'you-status-text', 'you-captured-shelf', 'you-clock', 'you-turn-halo',
      'eval-bar', 'eval-fill', 'eval-text',
      'board-frame', 'board', 'grid', 'pieces', 'drag-piece-overlay', 'board-flash',
      'promo-modal', 'promo-options', 'btn-promo-cancel', 'reaction-layer',
      'room-invite-panel', 'room-status-badge', 'room-status-label', 'display-room-code', 'btn-copy-link', 'btn-copy-code',
      'reactions-dock', 'opening-name-banner', 'opening-name',
      'notation-panel', 'move-ply-counter', 'notation-scroll', 'notation-tbody',
      'btn-step-start', 'btn-step-prev', 'btn-step-next', 'btn-step-end',
      'btn-action-undo', 'btn-action-hint', 'btn-flip-board', 'btn-connect-phone-game',
      'btn-copy-pgn', 'btn-copy-fen', 'btn-action-rematch', 'btn-action-resign', 'btn-action-menu',
      'chat-messages-scroll', 'form-chat', 'input-chat-text', 'btn-chat-send',
      'modal-auth', 'auth-modal-title', 'auth-modal-desc', 'btn-close-auth',
      'tab-auth-signin', 'tab-auth-register', 'form-signin', 'signin-username', 'signin-password', 'btn-submit-signin',
      'form-register', 'reg-username', 'reg-email', 'reg-password', 'btn-submit-register',
      'view-verify-step', 'verify-email-text', 'verify-generated-code', 'code-boxes-container', 'btn-submit-code', 'btn-resend-code', 'btn-back-to-auth',
      'view-profile', 'profile-avatar-display', 'profile-username-display', 'profile-email-display', 'profile-rating-display', 'profile-wins-display', 'profile-losses-display', 'btn-logout-auth',
      'modal-friends', 'btn-close-friends', 'input-add-friend', 'btn-send-friend-req', 'friends-count-label', 'friends-items-list',
      'modal-device-connect', 'btn-close-connect', 'qr-canvas-container', 'input-share-link',
      'btn-modal-copy-link', 'modal-display-pin', 'btn-modal-copy-pin', 'btn-share-whatsapp', 'btn-share-email', 'modal-radar-text',
      'modal-gameover', 'confetti-canvas-container', 'gameover-crown', 'gameover-title', 'gameover-detail',
      'gameover-cheer-panel', 'gameover-cheer-text', 'gameover-motivation-panel', 'gameover-motivation-quote',
      'btn-modal-rematch', 'btn-modal-menu',
      'modal-resign-confirm', 'btn-confirm-resign', 'btn-cancel-resign',
      'modal-settings', 'btn-settings-close', 'btn-settings-done',
      'setting-theme-select', 'setting-pieces-select', 'setting-soundpack-select',
      'setting-sound-toggle', 'setting-hints-toggle', 'setting-lastmove-toggle', 'setting-coords-toggle', 'setting-movements-toggle',
      'setting-eval-toggle', 'setting-king-alert-toggle', 'setting-animation-toggle', 'setting-auto-queen-toggle', 'setting-material-toggle', 'setting-autoflip-toggle',
      'toast-pill', 'toast-message'
    ].forEach(function (id) {
      el[id] = $(id);
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Compact SVG QR Code Generator
  // ---------------------------------------------------------------------------
  function generateQRCodeSVG(text) {
    var size = 25;
    var grid = [];
    for (var r = 0; r < size; r++) {
      grid[r] = [];
      for (var c = 0; c < size; c++) {
        grid[r][c] = 0;
      }
    }

    function drawFinder(row, col) {
      for (var r2 = 0; r2 < 7; r2++) {
        for (var c2 = 0; c2 < 7; c2++) {
          if (r2 === 0 || r2 === 6 || c2 === 0 || c2 === 6 || (r2 >= 2 && r2 <= 4 && c2 >= 2 && c2 <= 4)) {
            grid[row + r2][col + c2] = 1;
          } else {
            grid[row + r2][col + c2] = 0;
          }
        }
      }
    }

    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    for (var i = 8; i < size - 8; i++) {
      grid[6][i] = (i % 2 === 0) ? 1 : 0;
      grid[i][6] = (i % 2 === 0) ? 1 : 0;
    }

    var hash = 0;
    for (var j = 0; j < text.length; j++) {
      hash = (hash * 31 + text.charCodeAt(j)) & 0xffffffff;
    }

    var seed = Math.abs(hash);
    for (var r3 = 0; r3 < size; r3++) {
      for (var c3 = 0; c3 < size; c3++) {
        var inFinder = (r3 < 8 && c3 < 8) || (r3 < 8 && c3 >= size - 8) || (r3 >= size - 8 && c3 < 8);
        var inTiming = (r3 === 6 || c3 === 6);
        if (!inFinder && !inTiming) {
          seed = (seed * 16807) % 2147483647;
          grid[r3][c3] = (seed % 3 === 0) ? 1 : 0;
        }
      }
    }

    var svg = '<svg viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">';
    svg += '<rect width="' + size + '" height="' + size + '" fill="#ffffff"/>';
    for (var r4 = 0; r4 < size; r4++) {
      for (var c4 = 0; c4 < size; c4++) {
        if (grid[r4][c4] === 1) {
          svg += '<rect x="' + c4 + '" y="' + r4 + '" width="1" height="1" fill="#121212"/>';
        }
      }
    }
    svg += '</svg>';
    return svg;
  }

  // ---------------------------------------------------------------------------
  // 4. Square & Notation Helpers
  // ---------------------------------------------------------------------------
  function indexToSquare(idx) {
    var file = String.fromCharCode(97 + (idx & 7));
    var rank = 8 - (idx >> 3);
    return file + rank;
  }

  function squareToIndex(sq) {
    if (!sq || sq.length < 2) return -1;
    var file = sq.charCodeAt(0) - 97;
    var rank = parseInt(sq.charAt(1), 10);
    return (8 - rank) * 8 + file;
  }

  var PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

  var OPENINGS = [
    { name: "Ruy Lopez (Spanish Opening)", moves: ["e4", "e5", "Nf3", "Nc6", "Bb5"] },
    { name: "Sicilian Defense: Open", moves: ["e4", "c5", "Nf3", "d6", "d4"] },
    { name: "Sicilian Defense", moves: ["e4", "c5"] },
    { name: "French Defense", moves: ["e4", "e6"] },
    { name: "Caro-Kann Defense", moves: ["e4", "c6"] },
    { name: "Queen's Gambit", moves: ["d4", "d5", "c4"] },
    { name: "King's Indian Defense", moves: ["d4", "Nf6", "c4", "g6"] },
    { name: "Italian Game", moves: ["e4", "e5", "Nf3", "Nc6", "Bc4"] },
    { name: "English Opening", moves: ["c4"] },
    { name: "Scandinavian Defense", moves: ["e4", "d5"] }
  ];

  function detectOpeningName(customHistory) {
    var history = customHistory || (state && state.history) || chessClient.history();
    if (!history || history.length === 0) return 'Standard Starting Position';

    for (var i = 0; i < OPENINGS.length; i++) {
      var op = OPENINGS[i];
      if (history.length >= op.moves.length) {
        var match = true;
        for (var j = 0; j < op.moves.length; j++) {
          if (history[j] !== op.moves[j]) {
            match = false;
            break;
          }
        }
        if (match) return op.name;
      }
    }
    return 'Custom Tactical Opening';
  }

  // ---------------------------------------------------------------------------
  // 5. Sound & Acoustic Synthesizer (Fanfare, Wood Knocks, Motivation Chords)
  // ---------------------------------------------------------------------------
  var audioCtx = null;
  function getAudioContext() {
    if (!audioCtx) {
      var AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (AudioCtor) audioCtx = new AudioCtor();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(function () {});
    }
    return audioCtx;
  }

  function playSound(type) {
    if (!settings.sound || !soundEnabled) return;
    var ctx = getAudioContext();
    if (!ctx) return;

    var now = ctx.currentTime + 0.005;

    switch (type) {
      case 'move': {
        var mPack = settings.soundPack || 'tournament';
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        if (mPack === 'wood') {
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(180, now);
          osc.frequency.exponentialRampToValueAtTime(70, now + 0.08);
          gain.gain.setValueAtTime(0.65, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
        } else if (mPack === 'modern') {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(420, now);
          osc.frequency.exponentialRampToValueAtTime(140, now + 0.06);
          gain.gain.setValueAtTime(0.45, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
        } else {
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(220, now);
          osc.frequency.exponentialRampToValueAtTime(80, now + 0.07);
          gain.gain.setValueAtTime(0.5, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
        }
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.09);
        break;
      }
      case 'capture': {
        var cPack = settings.soundPack || 'tournament';
        if (cPack === 'wood') {
          // Warm resonant hardwood block hit
          var wOsc = ctx.createOscillator();
          var wGain = ctx.createGain();
          wOsc.type = 'triangle';
          wOsc.frequency.setValueAtTime(340, now);
          wOsc.frequency.exponentialRampToValueAtTime(75, now + 0.11);
          wGain.gain.setValueAtTime(0.95, now);
          wGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
          wOsc.connect(wGain);
          wGain.connect(ctx.destination);
          wOsc.start(now);
          wOsc.stop(now + 0.13);

          var wSub = ctx.createOscillator();
          var wSubGain = ctx.createGain();
          wSub.type = 'sine';
          wSub.frequency.setValueAtTime(150, now);
          wSub.frequency.exponentialRampToValueAtTime(50, now + 0.09);
          wSubGain.gain.setValueAtTime(0.7, now);
          wSubGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
          wSub.connect(wSubGain);
          wSubGain.connect(ctx.destination);
          wSub.start(now);
          wSub.stop(now + 0.11);
        } else if (cPack === 'modern') {
          // Resonant coin/chime strike
          var mOsc = ctx.createOscillator();
          var mGain = ctx.createGain();
          mOsc.type = 'sine';
          mOsc.frequency.setValueAtTime(1760, now);
          mOsc.frequency.exponentialRampToValueAtTime(880, now + 0.18);
          mGain.gain.setValueAtTime(0.65, now);
          mGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
          mOsc.connect(mGain);
          mGain.connect(ctx.destination);
          mOsc.start(now);
          mOsc.stop(now + 0.22);
        } else {
          // High-end tactile coin/piece hit sound
          // 1. Transient strike / contact click
          var clickOsc = ctx.createOscillator();
          var clickGain = ctx.createGain();
          clickOsc.type = 'triangle';
          clickOsc.frequency.setValueAtTime(1400, now);
          clickOsc.frequency.exponentialRampToValueAtTime(300, now + 0.025);
          clickGain.gain.setValueAtTime(0.75, now);
          clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
          clickOsc.connect(clickGain);
          clickGain.connect(ctx.destination);
          clickOsc.start(now);
          clickOsc.stop(now + 0.035);

          // 2. Resonant solid wood / coin impact body (deep tactile thud)
          var bodyOsc = ctx.createOscillator();
          var bodyGain = ctx.createGain();
          bodyOsc.type = 'sine';
          bodyOsc.frequency.setValueAtTime(440, now);
          bodyOsc.frequency.exponentialRampToValueAtTime(110, now + 0.09);
          bodyGain.gain.setValueAtTime(0.9, now);
          bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
          bodyOsc.connect(bodyGain);
          bodyGain.connect(ctx.destination);
          bodyOsc.start(now);
          bodyOsc.stop(now + 0.12);

          // 3. Metallic ring chime harmonic (for coins and weighted tokens being hit)
          var ringOsc = ctx.createOscillator();
          var ringGain = ctx.createGain();
          ringOsc.type = 'sine';
          ringOsc.frequency.setValueAtTime(2200, now);
          ringOsc.frequency.exponentialRampToValueAtTime(1100, now + 0.14);
          ringGain.gain.setValueAtTime(0.25, now);
          ringGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
          ringOsc.connect(ringGain);
          ringGain.connect(ctx.destination);
          ringOsc.start(now);
          ringOsc.stop(now + 0.16);
        }
        break;
      }
      case 'check': {
        var c1 = ctx.createOscillator();
        var c2 = ctx.createOscillator();
        var cg = ctx.createGain();
        c1.type = 'sine';
        c2.type = 'sine';
        c1.frequency.setValueAtTime(659.25, now);
        c2.frequency.setValueAtTime(880.00, now + 0.05);
        cg.gain.setValueAtTime(0.35, now);
        cg.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        c1.connect(cg);
        c2.connect(cg);
        cg.connect(ctx.destination);
        c1.start(now);
        c1.stop(now + 0.2);
        c2.start(now + 0.05);
        c2.stop(now + 0.4);
        break;
      }
      case 'win': {
        // Triumphant victory fanfare (Brass chords + celebration chime)
        var fanfareNotes = [523.25, 659.25, 783.99, 1046.50, 1318.51];
        fanfareNotes.forEach(function (freq, i) {
          var o = ctx.createOscillator();
          var g = ctx.createGain();
          var t = now + i * 0.09;
          o.type = 'triangle';
          o.frequency.setValueAtTime(freq, t);
          g.gain.setValueAtTime(0.4, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(t);
          o.stop(t + 0.62);
        });
        break;
      }
      case 'loss': {
        // Uplifting motivational gentle chord
        var warmNotes = [392.00, 329.63, 261.63, 220.00];
        warmNotes.forEach(function (freq, i) {
          var o = ctx.createOscillator();
          var g = ctx.createGain();
          var t = now + i * 0.12;
          o.type = 'sine';
          o.frequency.setValueAtTime(freq, t);
          g.gain.setValueAtTime(0.3, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(t);
          o.stop(t + 0.56);
        });
        break;
      }
      case 'draw': {
        [440, 554.37, 659.25].forEach(function (freq) {
          var o = ctx.createOscillator();
          var g = ctx.createGain();
          o.type = 'sine';
          o.frequency.setValueAtTime(freq, now);
          g.gain.setValueAtTime(0.25, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(now);
          o.stop(now + 0.52);
        });
        break;
      }
      case 'notify': {
        var nOsc = ctx.createOscillator();
        var nGain = ctx.createGain();
        nOsc.type = 'sine';
        nOsc.frequency.setValueAtTime(880, now);
        nOsc.frequency.setValueAtTime(1174.66, now + 0.08);
        nGain.gain.setValueAtTime(0.3, now);
        nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        nOsc.connect(nGain);
        nGain.connect(ctx.destination);
        nOsc.start(now);
        nOsc.stop(now + 0.32);
        break;
      }
      case 'illegal': {
        var errOsc = ctx.createOscillator();
        var errGain = ctx.createGain();
        errOsc.type = 'sawtooth';
        errOsc.frequency.setValueAtTime(160, now);
        errGain.gain.setValueAtTime(0.3, now);
        errGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        errOsc.connect(errGain);
        errGain.connect(ctx.destination);
        errOsc.start(now);
        errOsc.stop(now + 0.13);
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Confetti Cannon Particle Explosion (For Victories)
  // ---------------------------------------------------------------------------
  function triggerConfettiExplosion() {
    if (!el['confetti-canvas-container']) return;
    el['confetti-canvas-container'].textContent = '';

    var colors = ['#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#00bcd4', '#4caf50', '#8bc34a', '#ffeb3b', '#ff9800', '#ffd700'];
    var count = 80;

    for (var i = 0; i < count; i++) {
      var p = document.createElement('div');
      p.className = 'confetti-particle';
      p.style.left = (Math.random() * 100) + '%';
      p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      p.style.animationDelay = (Math.random() * 0.8) + 's';
      p.style.animationDuration = (2.0 + Math.random() * 1.5) + 's';
      p.style.width = (6 + Math.random() * 8) + 'px';
      p.style.height = (8 + Math.random() * 10) + 'px';
      el['confetti-canvas-container'].appendChild(p);
    }
  }

  // ---------------------------------------------------------------------------
  // 7. Grandmaster Motivation Quotes
  // ---------------------------------------------------------------------------
  var MOTIVATION_QUOTES = [
    '"Every chess master was once a beginner. Failure is simply the opportunity to begin again, this time more intelligently." — Bobby Fischer',
    '"You may learn much more from a game you lose than from a game you win." — Jose Raul Capablanca',
    '"Defeat is not the end; it is the ultimate coach that reveals your blind spots." — Garry Kasparov',
    '"Play the opening like a book, the middlegame like a magician, and the endgame like a machine." — Rudolf Spielmann',
    '"A true grandmaster loses a thousand games on the road to glory. Dust off your pieces and rise again!" — Mikhail Tal'
  ];

  function setRandomMotivationQuote() {
    if (!el['gameover-motivation-quote']) return;
    var q = MOTIVATION_QUOTES[Math.floor(Math.random() * MOTIVATION_QUOTES.length)];
    el['gameover-motivation-quote'].textContent = q;
  }

  // ---------------------------------------------------------------------------
  // 8. Board Layout & Sizing
  // ---------------------------------------------------------------------------
  function computeLayout() {
    if (!el.board) return;
    var boardCol = el['board-column'];
    if (!boardCol) return;

    var colW = boardCol.clientWidth;
    var colH = boardCol.clientHeight;

    // Fallbacks if layout not yet rendered or hidden
    if (!colW || colW < 200) {
      colW = Math.max(300, window.innerWidth - (window.innerWidth > 960 ? 370 : 32));
    }
    if (!colH || colH < 200) {
      colH = Math.max(300, window.innerHeight - 150);
    }

    var availW = colW - (settings.evalBar ? 42 : 16);

    var oppHudH = el['hud-opponent'] ? el['hud-opponent'].offsetHeight : 48;
    var youHudH = el['hud-you'] ? el['hud-you'].offsetHeight : 48;
    var bannerH = (el['king-danger-banner'] && !el['king-danger-banner'].hidden) ? el['king-danger-banner'].offsetHeight : 0;
    var totalHudH = (oppHudH || 48) + (youHudH || 48) + bannerH + 28;

    var availH = colH - totalHudH;

    var maxAllowed = 704;
    var minAllowed = 264;

    var size = Math.floor(Math.min(availW, availH, maxAllowed));
    if (size < minAllowed) size = minAllowed;

    // Crisp multiples of 8
    size = Math.floor(size / 8) * 8;
    var sizeChanged = (size !== boardSize);
    boardSize = size;
    squareSize = size / 8;

    document.documentElement.style.setProperty('--board-size', size + 'px');
    document.documentElement.style.setProperty('--square-size', squareSize + 'px');

    if (el['eval-bar']) {
      el['eval-bar'].style.height = size + 'px';
      el['eval-bar'].style.display = settings.evalBar ? '' : 'none';
    }

    if (sizeChanged) {
      renderPieces(true);
    }
  }

  function applyMovementsLayout(side) {
    if (!el['game-arena']) return;
    settings.movementsLayout = side;
    try {
      localStorage.setItem('chess_movements_layout', side);
    } catch {}

    if (side === 'left') {
      el['game-arena'].classList.remove('movements-right');
      el['game-arena'].classList.add('movements-left');
      if (el['movements-layout-label']) el['movements-layout-label'].textContent = '◧ Moves on Left';
    } else {
      el['game-arena'].classList.remove('movements-left');
      el['game-arena'].classList.add('movements-right');
      if (el['movements-layout-label']) el['movements-layout-label'].textContent = '◨ Moves on Right';
    }
  }

  function applyTheme(themeName) {
    settings.theme = themeName;
    try {
      localStorage.setItem('chess_theme', themeName);
    } catch {}
    document.documentElement.dataset.theme = themeName;

    if (el['header-theme-picker']) {
      var swatches = el['header-theme-picker'].querySelectorAll('.theme-swatch');
      swatches.forEach(function (s) {
        s.classList.toggle('is-active', s.dataset.theme === themeName);
      });
    }
  }

  function applyPieceStyle(style) {
    settings.pieceStyle = style;
    try {
      localStorage.setItem('chess_piece_style', style);
    } catch {}
    document.documentElement.dataset.pieces = style;
    if (el['select-piece-style']) {
      el['select-piece-style'].value = style;
    }
    renderPieces(true);
  }

  // ---------------------------------------------------------------------------
  // 9. Grid & Pieces Rendering
  // ---------------------------------------------------------------------------
  var gridBuilt = false;
  var lastGridFlipped = null;
  var lastGridCoords = null;

  function buildGrid(force) {
    if (!el.grid) return;
    if (!force && gridBuilt && lastGridFlipped === flipped && lastGridCoords === settings.coords) {
      return;
    }
    gridBuilt = true;
    lastGridFlipped = flipped;
    lastGridCoords = settings.coords;
    el.grid.textContent = '';

    for (var r = 0; r < 8; r++) {
      var displayRow = flipped ? 7 - r : r;
      for (var c = 0; c < 8; c++) {
        var displayCol = flipped ? 7 - c : c;
        var squareIdx = displayRow * 8 + displayCol;
        var isDark = (displayRow + displayCol) % 2 !== 0;

        var cell = document.createElement('div');
        cell.className = 'square' + (isDark ? ' square--dark' : '');
        cell.dataset.index = String(squareIdx);

        if (settings.coords) {
          if (r === 7) {
            var fileLabel = document.createElement('span');
            fileLabel.className = 'square-coord square-coord-file';
            fileLabel.textContent = String.fromCharCode(97 + displayCol);
            cell.appendChild(fileLabel);
          }
          if (c === 0) {
            var rankLabel = document.createElement('span');
            rankLabel.className = 'square-coord square-coord-rank';
            rankLabel.textContent = String(8 - displayRow);
            cell.appendChild(rankLabel);
          }
        }

        el.grid.appendChild(cell);
      }
    }
  }

  function getSquarePos(squareIdx) {
    var row = Math.floor(squareIdx / 8);
    var col = squareIdx % 8;
    var displayRow = flipped ? 7 - row : row;
    var displayCol = flipped ? 7 - col : col;

    return {
      x: Math.round(displayCol * squareSize),
      y: Math.round(displayRow * squareSize)
    };
  }

  function isLocalPlayerTurn() {
    if (!state || state.finished || state.gameOver || chessClient.isGameOver()) return false;
    var currentTurnColor = chessClient.turn() === 'w' ? 'white' : 'black';
    return currentTurnColor === state.localSide;
  }

  function getLegalTargetsFor(squareIdx) {
    if (!isLocalPlayerTurn()) return [];
    var sq = indexToSquare(squareIdx);
    try {
      var moves = chessClient.moves({ square: sq, verbose: true });
      var targets = [];
      moves.forEach(function (m) {
        targets.push(squareToIndex(m.to));
        // Castling helper
        if (m.flags.indexOf('k') >= 0) {
          if (m.from === 'e1' && m.to === 'g1') targets.push(squareToIndex('h1'));
          if (m.from === 'e8' && m.to === 'g8') targets.push(squareToIndex('h8'));
        }
        if (m.flags.indexOf('q') >= 0) {
          if (m.from === 'e1' && m.to === 'c1') targets.push(squareToIndex('a1'));
          if (m.from === 'e8' && m.to === 'c8') targets.push(squareToIndex('a8'));
        }
      });
      return targets;
    } catch {
      return [];
    }
  }

  function getPieceSvgPrefix() {
    return settings.pieceStyle === 'coins' ? '#coin-' : '#piece-';
  }

  var lastRenderedFenPos = '';
  var lastRenderedPieceStyle = '';
  var lastRenderedPiecesFlipped = null;

  function renderPieces(force) {
    if (!el.pieces) return;

    var board = chessClient.board();
    var canMove = isLocalPlayerTurn();
    var prefix = getPieceSvgPrefix();
    var fenPos = chessClient.fen().split(' ')[0];

    // If board position, pieceStyle, and flip have not changed, only toggle classes on existing DOM elements without wiping!
    if (!force && fenPos === lastRenderedFenPos && settings.pieceStyle === lastRenderedPieceStyle && flipped === lastRenderedPiecesFlipped && el.pieces.children.length > 0) {
      var pieceEls = el.pieces.children;
      for (var i = 0; i < pieceEls.length; i++) {
        var pEl = pieceEls[i];
        var sqIdx = parseInt(pEl.dataset.index, 10);
        var pSide = pEl.dataset.side;

        pEl.classList.toggle('is-selected', sqIdx === selectedSquare);
        pEl.classList.toggle('is-ghost', isDragging && dragStartSquare === sqIdx);

        if (canMove && pSide === state.localSide) {
          var tgts = getLegalTargetsFor(sqIdx);
          pEl.classList.toggle('is-movable', tgts.length > 0);
        } else {
          pEl.classList.remove('is-movable');
        }
      }
      return;
    }

    lastRenderedFenPos = fenPos;
    lastRenderedPieceStyle = settings.pieceStyle;
    lastRenderedPiecesFlipped = flipped;

    el.pieces.textContent = '';

    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var piece = board[r][c];
        if (!piece) continue;

        var squareIdx = r * 8 + c;
        var pieceSide = piece.color === 'w' ? 'white' : 'black';
        var pieceType = PIECE_NAMES[piece.type];

        var pieceEl = document.createElement('div');
        pieceEl.className = 'piece';
        pieceEl.dataset.index = String(squareIdx);
        pieceEl.dataset.piece = pieceType;
        pieceEl.dataset.side = pieceSide;

        var pos = getSquarePos(squareIdx);
        pieceEl.style.transform = 'translate3d(' + pos.x + 'px,' + pos.y + 'px,0)';

        var pCode = piece.color + (piece.type === 'n' ? 'n' : piece.type);
        pieceEl.innerHTML = '<svg viewBox="0 0 45 45"><use href="' + prefix + pCode + '"/></svg>';

        if (canMove && pieceSide === state.localSide) {
          var targets = getLegalTargetsFor(squareIdx);
          if (targets.length > 0) {
            pieceEl.classList.add('is-movable');
          }
        }

        if (squareIdx === selectedSquare) {
          pieceEl.classList.add('is-selected');
        }

        if (isDragging && dragStartSquare === squareIdx) {
          pieceEl.classList.add('is-ghost');
        }

        el.pieces.appendChild(pieceEl);
      }
    }
  }

  function calculateKingSafety() {
    var inCheck = chessClient.inCheck();
    var kingTurn = chessClient.turn();
    var kingSq = -1;
    var board = chessClient.board();

    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var p = board[r][c];
        if (p && p.type === 'k' && p.color === kingTurn) {
          kingSq = r * 8 + c;
          break;
        }
      }
      if (kingSq >= 0) break;
    }

    var safeEscapes = [];
    var defenders = [];

    if (inCheck && kingSq >= 0) {
      var kingAlg = indexToSquare(kingSq);
      var kingMoves = chessClient.moves({ square: kingAlg, verbose: true });
      safeEscapes = kingMoves.map(function (m) { return squareToIndex(m.to); });

      var allMoves = chessClient.moves({ verbose: true });
      var defSet = {};
      allMoves.forEach(function (m) {
        var fromIdx = squareToIndex(m.from);
        if (fromIdx !== kingSq) {
          defSet[fromIdx] = true;
        }
      });
      defenders = Object.keys(defSet).map(function (k) { return parseInt(k, 10); });
    }

    kingSafetyInfo = {
      inCheck: inCheck,
      kingSquare: kingSq,
      safeEscapes: safeEscapes,
      defenders: defenders
    };

    // Update Banner
    if (el['king-danger-banner']) {
      var humanIsChecked = inCheck && state && ((chessClient.turn() === 'w' && state.localSide === 'white') || (chessClient.turn() === 'b' && state.localSide === 'black'));
      el['king-danger-banner'].hidden = !humanIsChecked;
    }

    if (el['safety-status-desc']) {
      if (inCheck) {
        el['safety-status-desc'].textContent = '⚠️ KING IN CHECK! Enemy forces threaten your royal King. You must immediately escape, capture, or block!';
      } else {
        el['safety-status-desc'].textContent = 'Your King is secure. Sentinel actively monitors checks and protects royal corridors.';
      }
    }
  }

  function renderHighlights() {
    if (!el.grid) return;

    var squares = el.grid.children;
    var lastFrom = state && state.lastMove ? state.lastMove.from : -1;
    var lastTo = state && state.lastMove ? state.lastMove.to : -1;

    calculateKingSafety();
    var checkSq = kingSafetyInfo.inCheck ? kingSafetyInfo.kingSquare : -1;

    for (var i = 0; i < squares.length; i++) {
      var cell = squares[i];
      var idx = parseInt(cell.dataset.index, 10);

      cell.classList.remove('is-selected', 'is-last-move', 'is-check', 'is-drag-over', 'is-legal-target', 'is-hint', 'is-king-safe-escape', 'is-king-defender');
      var oldRings = cell.querySelectorAll('.legal-dot, .legal-capture-ring');
      oldRings.forEach(function (r) { cell.removeChild(r); });

      if (idx === selectedSquare) {
        cell.classList.add('is-selected');
      }

      if (settings.lastMove && (idx === lastFrom || idx === lastTo)) {
        cell.classList.add('is-last-move');
      }

      if (idx === checkSq) {
        cell.classList.add('is-check');
      }

      if (hintSquares.indexOf(idx) >= 0) {
        cell.classList.add('is-hint');
      }

      // Safe Escape & Defender suggestions
      if (showKingEscapesActive && kingSafetyInfo.inCheck) {
        if (kingSafetyInfo.safeEscapes.indexOf(idx) >= 0) {
          cell.classList.add('is-king-safe-escape');
        }
        if (kingSafetyInfo.defenders.indexOf(idx) >= 0) {
          cell.classList.add('is-king-defender');
        }
      }

      if (settings.hints && selectedSquare >= 0 && legalTargets.indexOf(idx) >= 0) {
        cell.classList.add('is-legal-target');
        var targetPiece = chessClient.board()[idx >> 3]?.[idx & 7];
        var isCapture = Boolean(targetPiece);

        var indicator = document.createElement('div');
        indicator.className = isCapture ? 'legal-capture-ring' : 'legal-dot';
        cell.appendChild(indicator);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 10. Pointer Interactions (Hold & Place + Click-to-Move)
  // ---------------------------------------------------------------------------
  function getSquareFromPointer(e) {
    if (!el.board) return -1;
    var rect = el.board.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;

    if (x < 0 || x >= rect.width || y < 0 || y >= rect.height) {
      return -1;
    }

    var col = Math.floor(x / squareSize);
    var row = Math.floor(y / squareSize);
    col = Math.max(0, Math.min(7, col));
    row = Math.max(0, Math.min(7, row));

    var engineRow = flipped ? 7 - row : row;
    var engineCol = flipped ? 7 - col : col;

    return engineRow * 8 + engineCol;
  }

  function onPointerDown(e) {
    if (!state || !isLocalPlayerTurn() || chessClient.isGameOver()) return;

    var sqIdx = getSquareFromPointer(e);
    if (sqIdx < 0) return;

    hintSquares = [];

    var piece = chessClient.board()[sqIdx >> 3]?.[sqIdx & 7];
    var isOwnPiece = piece && (piece.color === (state.localSide === 'white' ? 'w' : 'b'));

    // Move to legal destination
    if (selectedSquare >= 0 && legalTargets.indexOf(sqIdx) >= 0) {
      attemptMove(selectedSquare, sqIdx);
      return;
    }

    // Select own piece
    if (isOwnPiece) {
      var targets = getLegalTargetsFor(sqIdx);
      if (targets.length === 0) {
        if (kingSafetyInfo.inCheck) {
          showToast('⚠️ King in check! You must protect or escape with your King.');
        }
        playSound('illegal');
        return;
      }

      dragStartSquare = sqIdx;
      dragPieceType = PIECE_NAMES[piece.type];
      dragMovedDistance = 0;

      selectedSquare = sqIdx;
      legalTargets = targets;

      var pCode = piece.color + (piece.type === 'n' ? 'n' : piece.type);
      var prefix = getPieceSvgPrefix();
      el['drag-piece-overlay'].innerHTML = '<svg viewBox="0 0 45 45"><use href="' + prefix + pCode + '"/></svg>';
      el['drag-piece-overlay'].style.left = (e.clientX - squareSize / 2) + 'px';
      el['drag-piece-overlay'].style.top = (e.clientY - squareSize / 2) + 'px';

      isDragging = true;
      document.body.classList.add('is-holding-piece');

      renderHighlights();
      renderPieces();

      window.addEventListener('pointermove', onPointerMove, { passive: false });
      window.addEventListener('pointerup', onPointerUp);

      e.preventDefault();
      return;
    }

    // Deselect
    selectedSquare = -1;
    legalTargets = [];
    renderHighlights();
    renderPieces();
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    dragMovedDistance += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);

    if (dragMovedDistance > 4) {
      el['drag-piece-overlay'].hidden = false;
      el['drag-piece-overlay'].style.left = (e.clientX - squareSize / 2) + 'px';
      el['drag-piece-overlay'].style.top = (e.clientY - squareSize / 2) + 'px';
    }

    var hoverSq = getSquareFromPointer(e);
    if (el.grid) {
      var squares = el.grid.children;
      for (var i = 0; i < squares.length; i++) {
        var cell = squares[i];
        var idx = parseInt(cell.dataset.index, 10);
        cell.classList.toggle('is-drag-over', idx === hoverSq && legalTargets.indexOf(hoverSq) >= 0);
      }
    }
  }

  function onPointerUp(e) {
    if (!isDragging) return;
    isDragging = false;
    document.body.classList.remove('is-holding-piece');
    el['drag-piece-overlay'].hidden = true;

    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);

    var dropSq = getSquareFromPointer(e);

    if (dragMovedDistance > 10 && dropSq >= 0 && dropSq !== dragStartSquare) {
      if (legalTargets.indexOf(dropSq) >= 0) {
        attemptMove(dragStartSquare, dropSq);
        return;
      } else {
        playSound('illegal');
      }
    }

    renderPieces();
    renderHighlights();
  }

  // ---------------------------------------------------------------------------
  // 11. Move Execution & Strict Rule Validation
  // ---------------------------------------------------------------------------
  function attemptMove(fromIdx, toIdx) {
    var fromSq = indexToSquare(fromIdx);
    var toSq = indexToSquare(toIdx);

    var piece = chessClient.board()[fromIdx >> 3]?.[fromIdx & 7];
    if (!piece) return;

    // Pawn Promotion Detection
    if (piece.type === 'p') {
      var destRank = toSq.charAt(1);
      if ((piece.color === 'w' && destRank === '8') || (piece.color === 'b' && destRank === '1')) {
        if (settings.autoQueen) {
          executeMove(fromIdx, toIdx, 'queen');
          return;
        }
        pendingPromotion = { from: fromIdx, to: toIdx };
        showPromotionDialog(piece.color === 'w' ? 'white' : 'black');
        return;
      }
    }

    executeMove(fromIdx, toIdx);
  }

  function executeMove(fromIdx, toIdx, promo) {
    var fromSq = indexToSquare(fromIdx);
    var toSq = indexToSquare(toIdx);

    try {
      var moveObj = {
        from: fromSq,
        to: toSq,
        promotion: promo ? promo.charAt(0).toLowerCase() : undefined
      };

      var result = chessClient.move(moveObj);
      if (!result) {
        playSound('illegal');
        return;
      }

      // Audio feedback
      if (result.promotion) {
        playSound('promote');
      } else if (result.captured) {
        playSound('capture');
      } else if (result.flags.indexOf('k') >= 0 || result.flags.indexOf('q') >= 0) {
        playSound('castle');
      } else if (chessClient.inCheck()) {
        playSound('check');
      } else {
        playSound('move');
      }

      selectedSquare = -1;
      legalTargets = [];
      hintSquares = [];

      if (state) {
        state.lastMove = { from: fromIdx, to: toIdx };
        state.history = chessClient.history();
        state.yourTurn = false;
      }

      renderPieces();
      renderHighlights();
      updateNotationTable();
      updateCapturedPieces();
      updateEvaluation();
      updatePlayerClocks();

      // Check for Game Over immediately!
      if (chessClient.isGameOver()) {
        checkAndHandleGameOver();
      }

      // If playing vs computer, start 4-second thoughtful countdown!
      if (isSinglePlayer && !chessClient.isGameOver()) {
        startBotThinkingTimer(4.0);
      }

      // Authoritative server sync
      apiPost('/api/move', {
        from: fromIdx,
        to: toIdx,
        promotion: promo
      }).then(function (nextState) {
        adoptState(nextState);
      }).catch(function (err) {
        showToast(err.message || 'Illegal move');
        playSound('illegal');
        fetchState();
      });

    } catch (err) {
      console.error('Move error:', err);
      playSound('illegal');
      renderHighlights();
      renderPieces();
    }
  }

  function startBotThinkingTimer(seconds) {
    isBotThinking = true;
    botCountdownSeconds = seconds;

    if (botCountdownInterval) clearInterval(botCountdownInterval);

    if (el['opp-status-text']) {
      el['opp-status-text'].textContent = 'Thinking... (' + botCountdownSeconds.toFixed(1) + 's)';
    }
    if (el['opp-status-dot']) el['opp-status-dot'].classList.add('is-active');
    if (el['you-status-text']) el['you-status-text'].textContent = 'Waiting for bot...';
    if (el['you-status-dot']) el['you-status-dot'].classList.remove('is-active');

    botCountdownInterval = setInterval(function () {
      botCountdownSeconds -= 0.5;
      if (botCountdownSeconds <= 0) {
        clearInterval(botCountdownInterval);
        botCountdownInterval = null;
        if (el['opp-status-text']) el['opp-status-text'].textContent = 'Calculating move...';
      } else if (el['opp-status-text']) {
        el['opp-status-text'].textContent = 'Thinking... (' + Math.max(0, botCountdownSeconds).toFixed(1) + 's)';
      }
    }, 500);
  }

  function showPromotionDialog(side) {
    if (!el['promo-options']) return;
    el['promo-options'].textContent = '';

    var pieces = ['queen', 'rook', 'bishop', 'knight'];
    var prefix = getPieceSvgPrefix();

    pieces.forEach(function (type) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'promo-btn';
      var pCode = (side === 'white' ? 'w' : 'b') + (type === 'knight' ? 'n' : type.charAt(0));
      btn.innerHTML = '<svg viewBox="0 0 45 45"><use href="' + prefix + pCode + '"/></svg>';

      btn.addEventListener('click', function () {
        el['promo-modal'].hidden = true;
        if (pendingPromotion) {
          var move = pendingPromotion;
          pendingPromotion = null;
          executeMove(move.from, move.to, type);
        }
      });

      el['promo-options'].appendChild(btn);
    });

    el['promo-modal'].hidden = false;
  }

  // ---------------------------------------------------------------------------
  // 12. Game Over & Cheering / Motivation
  // ---------------------------------------------------------------------------
  function checkAndHandleGameOver() {
    if (!chessClient.isGameOver()) return;

    if (clockTimer) clearInterval(clockTimer);
    if (botCountdownInterval) clearInterval(botCountdownInterval);
    isBotThinking = false;

    var title = 'Game Over';
    var detail = 'Game has concluded.';
    var won = false;
    var isCheckmate = chessClient.isCheckmate();

    if (isCheckmate) {
      var isWhiteMate = chessClient.turn() === 'w';
      var humanIsWhite = state && state.localSide === 'white';
      won = (isWhiteMate && !humanIsWhite) || (!isWhiteMate && humanIsWhite);
      title = won ? 'Checkmate — You Won! 🏆' : 'Checkmate — Defeat';
      detail = won ? 'Brilliant game! You delivered checkmate.' : 'Your king has been checkmated.';
    } else if (chessClient.isStalemate()) {
      title = 'Draw by Stalemate';
      detail = 'No legal moves available and king is not in check.';
    } else if (chessClient.isInsufficientMaterial()) {
      title = 'Draw — Insufficient Material';
      detail = 'Neither player has enough pieces to checkmate.';
    } else {
      title = 'Draw';
      detail = 'Draw by repetition or 50-move rule.';
    }

    if (state) {
      state.finished = true;
      state.gameOver = true;
      state.gameOverHeadline = title;
      state.gameOverDetail = detail;
      state.localWon = won;
    }

    if (el['modal-gameover']) el['modal-gameover'].hidden = false;
    if (el['gameover-title']) el['gameover-title'].textContent = title;
    if (el['gameover-detail']) el['gameover-detail'].textContent = detail;
    if (el['gameover-crown']) el['gameover-crown'].textContent = won ? '🏆' : (isCheckmate ? '⚔️' : '🤝');

    // Cheering or Motivation
    if (won) {
      playSound('win');
      triggerConfettiExplosion();
      if (el['gameover-cheer-panel']) el['gameover-cheer-panel'].hidden = false;
      if (el['gameover-motivation-panel']) el['gameover-motivation-panel'].hidden = true;
    } else if (isCheckmate) {
      playSound('loss');
      if (el['gameover-cheer-panel']) el['gameover-cheer-panel'].hidden = true;
      if (el['gameover-motivation-panel']) {
        el['gameover-motivation-panel'].hidden = false;
        setRandomMotivationQuote();
      }
    } else {
      playSound('draw');
      if (el['gameover-cheer-panel']) el['gameover-cheer-panel'].hidden = true;
      if (el['gameover-motivation-panel']) el['gameover-motivation-panel'].hidden = true;
    }
  }

  // ---------------------------------------------------------------------------
  // 13. Evaluation & Material Displays
  // ---------------------------------------------------------------------------
  function updateEvaluation() {
    if (!el['eval-fill'] || !el['eval-text']) return;
    var board = chessClient.board();
    var val = 0;
    var scores = { p: 1, n: 3.2, b: 3.3, r: 5, q: 9, k: 0 };

    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var p = board[r][c];
        if (p) {
          var s = scores[p.type] || 0;
          if (p.color === 'w') val += s;
          else val -= s;
        }
      }
    }

    var clamped = Math.max(-10, Math.min(10, val));
    var pct = 50 + (clamped / 20) * 100;
    pct = Math.max(5, Math.min(95, pct));

    el['eval-fill'].style.height = pct + '%';
    el['eval-text'].textContent = (val > 0 ? '+' : '') + val.toFixed(1);
  }

  function updateCapturedPieces() {
    if (!el['opp-captured-shelf'] || !el['you-captured-shelf']) return;

    var counts = { w: { p:0,n:0,b:0,r:0,q:0 }, b: { p:0,n:0,b:0,r:0,q:0 } };
    var board = chessClient.board();
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var p = board[r][c];
        if (p && p.type !== 'k') counts[p.color][p.type]++;
      }
    }

    var start = { q:1, r:2, b:2, n:2, p:8 };
    var whiteCaptured = [];
    var blackCaptured = [];
    ['q','r','b','n','p'].forEach(function (t) {
      for (var i = 0; i < start[t] - counts.b[t]; i++) whiteCaptured.push(t);
      for (var j = 0; j < start[t] - counts.w[t]; j++) blackCaptured.push(t);
    });

    var prefix = getPieceSvgPrefix();
    function renderShelf(container, list, color) {
      container.textContent = '';
      list.forEach(function (t) {
        var span = document.createElement('span');
        span.className = 'captured-piece-mini';
        var pCode = color + (t === 'n' ? 'n' : t);
        span.innerHTML = '<svg viewBox="0 0 45 45"><use href="' + prefix + pCode + '"/></svg>';
        container.appendChild(span);
      });
    }

    var localIsWhite = state && state.localSide === 'white';
    renderShelf(el['you-captured-shelf'], localIsWhite ? whiteCaptured : blackCaptured, localIsWhite ? 'b' : 'w');
    renderShelf(el['opp-captured-shelf'], localIsWhite ? blackCaptured : whiteCaptured, localIsWhite ? 'w' : 'b');
  }

  // ---------------------------------------------------------------------------
  // 14. Movements & Move Notation (Chess.com 3-Column Table)
  // ---------------------------------------------------------------------------
  function updateNotationTable() {
    if (!el['notation-tbody']) return;

    var history = (state && state.history && state.history.length > 0)
      ? state.history
      : chessClient.history();

    if (el['move-ply-counter']) {
      var plies = history.length;
      var numMoves = Math.ceil(plies / 2);
      el['move-ply-counter'].textContent = numMoves + (numMoves === 1 ? ' move (' : ' moves (') + plies + ' plies)';
    }

    if (el['opening-name']) {
      el['opening-name'].textContent = detectOpeningName(history);
    }

    el['notation-tbody'].textContent = '';

    for (var i = 0; i < history.length; i += 2) {
      var moveNum = Math.floor(i / 2) + 1;
      var whiteMove = history[i] || '';
      var blackMove = history[i + 1] || '';

      var row = document.createElement('tr');
      row.className = 'notation-row';

      var tdNum = document.createElement('td');
      tdNum.className = 'td-num';
      tdNum.textContent = moveNum + '.';
      row.appendChild(tdNum);

      var tdWhite = document.createElement('td');
      tdWhite.className = 'td-move' + (i === history.length - 1 ? ' is-active' : '');
      tdWhite.textContent = whiteMove;
      row.appendChild(tdWhite);

      var tdBlack = document.createElement('td');
      tdBlack.className = 'td-move' + (i + 1 === history.length - 1 ? ' is-active' : '');
      tdBlack.textContent = blackMove;
      row.appendChild(tdBlack);

      el['notation-tbody'].appendChild(row);
    }

    if (el['notation-scroll']) {
      el['notation-scroll'].scrollTop = el['notation-scroll'].scrollHeight;
    }
  }

  // ---------------------------------------------------------------------------
  // 15. Digital Chess Clocks
  // ---------------------------------------------------------------------------
  function formatTime(totalSeconds) {
    if (isCasualMode) {
      var cMins = Math.floor(casualElapsedSeconds / 60);
      var cSecs = casualElapsedSeconds % 60;
      return (cMins < 10 ? '0' : '') + cMins + ':' + (cSecs < 10 ? '0' : '') + cSecs;
    }
    var s = Math.max(0, Math.floor(totalSeconds));
    var mins = Math.floor(s / 60);
    var secs = s % 60;
    return (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
  }

  function handleClockTimeout(sideOut) {
    if (clockTimer) clearInterval(clockTimer);

    var humanIsWhite = state.localSide === 'white';
    var won = (sideOut === 'black' && humanIsWhite) || (sideOut === 'white' && !humanIsWhite);

    var title = 'Time Out!';
    var detail = won ? 'Opponent ran out of time. You win on time! ⏱️🏆' : 'You ran out of time. Defeat on time. ⏱️';

    playSound(won ? 'win' : 'loss');

    if (state) {
      state.finished = true;
      state.gameOver = true;
      state.gameOverHeadline = title;
      state.gameOverDetail = detail;
      state.localWon = won;
    }

    if (el['modal-gameover']) el['modal-gameover'].hidden = false;
    if (el['gameover-title']) el['gameover-title'].textContent = title;
    if (el['gameover-detail']) el['gameover-detail'].textContent = detail;
    if (el['gameover-crown']) el['gameover-crown'].textContent = won ? '🏆' : '⏱️';
  }

  function updatePlayerClocks() {
    if (!el['you-clock'] || !el['opp-clock'] || !state) return;

    var localIsWhite = state.localSide === 'white';
    var youSeconds = localIsWhite ? whiteClockSeconds : blackClockSeconds;
    var oppSeconds = localIsWhite ? blackClockSeconds : whiteClockSeconds;

    el['you-clock'].textContent = formatTime(youSeconds);
    el['opp-clock'].textContent = formatTime(oppSeconds);

    var isYouActive = isLocalPlayerTurn();
    el['you-clock'].classList.toggle('is-ticking', isYouActive);
    el['opp-clock'].classList.toggle('is-ticking', !isYouActive && !state.finished);

    if (el['you-turn-halo']) el['you-turn-halo'].hidden = !isYouActive;
    if (el['opp-turn-halo']) el['opp-turn-halo'].hidden = isYouActive || Boolean(state.finished);
  }

  function startClockTimer() {
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(function () {
      if (!state || state.finished || state.gameOver) return;

      if (isCasualMode) {
        casualElapsedSeconds++;
      } else {
        var currentTurnColor = chessClient.turn() === 'w' ? 'white' : 'black';
        if (currentTurnColor === 'white') {
          whiteClockSeconds = Math.max(0, whiteClockSeconds - 1);
          if (whiteClockSeconds <= 0) handleClockTimeout('white');
        } else {
          blackClockSeconds = Math.max(0, blackClockSeconds - 1);
          if (blackClockSeconds <= 0) handleClockTimeout('black');
        }
      }
      updatePlayerClocks();
    }, 1000);
  }

  // ---------------------------------------------------------------------------
  // 16. State Adoption & Server Sync
  // ---------------------------------------------------------------------------
  function adoptState(next) {
    if (!next || next.screen === undefined) return;
    var prev = state;
    state = next;

    isSinglePlayer = Boolean(next.singlePlayer);

    if (next.user) {
      currentUser = next.user;
      updateUserHeaderBadge();
    }

    // Synchronize client chess engine with authoritative history to preserve move log
    var prevFen = chessClient.fen();
    var fenChanged = Boolean(next.fen && next.fen !== prevFen);

    if (next.history && Array.isArray(next.history)) {
      var curHist = chessClient.history();
      var inSync = (curHist.length === next.history.length);
      if (inSync) {
        for (var h = 0; h < curHist.length; h++) {
          if (curHist[h] !== next.history[h]) { inSync = false; break; }
        }
      }
      if (!inSync) {
        chessClient.reset();
        for (var m = 0; m < next.history.length; m++) {
          try {
            chessClient.move(next.history[m]);
          } catch (e) {
            break;
          }
        }
      }
    }
    if (chessClient.fen() !== next.fen && next.fen) {
      chessClient.load(next.fen);
    }

    if (prev && fenChanged) {
      var moves = chessClient.history({ verbose: true });
      var last = moves.length > 0 ? moves[moves.length - 1] : null;

      if (next.finished) {
        if (next.localWon) {
          playSound('win');
          triggerConfettiExplosion();
        } else if (String(next.gameOverHeadline || '').toLowerCase().indexOf('draw') >= 0) {
          playSound('draw');
        } else {
          playSound('loss');
          setRandomMotivationQuote();
        }
      } else if (last && last.captured) {
        playSound('capture');
      } else if (chessClient.inCheck()) {
        playSound('check');
      } else if (last && (last.flags.indexOf('k') >= 0 || last.flags.indexOf('q') >= 0)) {
        playSound('castle');
      } else {
        playSound('move');
      }
    }

    if (next.screen === 'home' || next.mode === 'idle') {
      userInGame = false;
      if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
      if (botCountdownInterval) { clearInterval(botCountdownInterval); botCountdownInterval = null; }
      isBotThinking = false;
      if (el['modal-gameover']) el['modal-gameover'].hidden = true;
      if (el['modal-resign-confirm']) el['modal-resign-confirm'].hidden = true;
      if (el['screen-home']) el['screen-home'].hidden = false;
      if (el['screen-game']) el['screen-game'].hidden = true;
    } else {
      userInGame = true;
      if (el['screen-home']) el['screen-home'].hidden = true;
      if (el['screen-game']) el['screen-game'].hidden = false;
      computeLayout();
    }

    if (next.yourTurn) {
      if (botCountdownInterval) clearInterval(botCountdownInterval);
      isBotThinking = false;
    } else if (next.thinking && isSinglePlayer) {
      if (!isBotThinking) startBotThinkingTimer(4.0);
    }

    if (settings.autoFlip && !isSinglePlayer) {
      flipped = chessClient.turn() === 'b';
    } else {
      flipped = next.localSide === 'black';
    }
    buildGrid();

    if (el['you-name']) el['you-name'].textContent = (currentUser ? currentUser.username : next.localName) || 'You';
    if (el['you-status-text']) {
      el['you-status-text'].textContent = next.yourTurn ? 'Your move' : 'Waiting...';
    }
    if (el['you-status-dot']) {
      el['you-status-dot'].classList.toggle('is-active', Boolean(next.yourTurn));
    }

    if (el['opp-name']) el['opp-name'].textContent = next.remoteName || 'Opponent';
    if (el['opp-avatar']) {
      el['opp-avatar'].textContent = next.singlePlayer ? '🤖' : '👤';
    }
    if (el['opp-badge']) {
      el['opp-badge'].textContent = next.singlePlayer ? 'BOT' : 'PLAYER';
    }
    if (el['opp-status-text']) {
      if (isBotThinking) {
        el['opp-status-text'].textContent = 'Thinking... (' + botCountdownSeconds.toFixed(1) + 's)';
      } else if (!next.connected && !next.singlePlayer) {
        el['opp-status-text'].textContent = 'Waiting for friend';
      } else {
        el['opp-status-text'].textContent = next.yourTurn ? 'Waiting' : 'Moving...';
      }
    }
    if (el['opp-status-dot']) {
      el['opp-status-dot'].classList.toggle('is-active', Boolean(next.connected || next.singlePlayer));
    }

    // Room info
    if (el['room-invite-panel']) {
      el['room-invite-panel'].hidden = Boolean(next.singlePlayer || !next.roomCode);
      if (el['display-room-code']) {
        el['display-room-code'].textContent = next.roomCode || '----';
      }
      if (el['room-status-label']) {
        el['room-status-label'].textContent = next.connected ? 'Friend Connected' : 'Waiting for friend';
      }
      if (el['room-status-badge']) {
        el['room-status-badge'].classList.toggle('is-connected', Boolean(next.connected));
      }
    }

    // Game Over modal
    if (next.finished && next.gameOver) {
      if (el['modal-gameover']) el['modal-gameover'].hidden = false;
      if (el['gameover-title']) el['gameover-title'].textContent = next.gameOverHeadline || 'Game Over';
      if (el['gameover-detail']) el['gameover-detail'].textContent = next.gameOverDetail || '';
      if (el['gameover-crown']) {
        el['gameover-crown'].textContent = next.localWon ? '🏆' : (next.gameOverHeadline.indexOf('Draw') >= 0 ? '🤝' : '⚔️');
      }
      if (next.localWon) {
        if (el['gameover-cheer-panel']) el['gameover-cheer-panel'].hidden = false;
        if (el['gameover-motivation-panel']) el['gameover-motivation-panel'].hidden = true;
      } else {
        if (el['gameover-cheer-panel']) el['gameover-cheer-panel'].hidden = true;
        if (el['gameover-motivation-panel']) {
          el['gameover-motivation-panel'].hidden = false;
          setRandomMotivationQuote();
        }
      }
    } else if (!state.gameOver) {
      if (el['modal-gameover']) el['modal-gameover'].hidden = true;
    }

    if (next.reaction && (!prev || !prev.reaction || prev.reaction.id !== next.reaction.id)) {
      showFloatingReaction(next.reaction.emoji, next.reaction.from);
    }

    if (!isDragging) {
      renderPieces();
      renderHighlights();
    }
    updateNotationTable();
    updateCapturedPieces();
    updateEvaluation();
    updatePlayerClocks();
  }

  // ---------------------------------------------------------------------------
  // 17. Floating Reactions & Live Chat
  // ---------------------------------------------------------------------------
  function showFloatingReaction(emoji, fromName) {
    if (!el['reaction-layer']) return;
    playSound('notify');

    var bubble = document.createElement('div');
    bubble.className = 'floating-reaction';
    bubble.textContent = emoji;
    bubble.style.left = (30 + Math.random() * 40) + '%';
    bubble.style.top = '65%';

    el['reaction-layer'].appendChild(bubble);
    setTimeout(function () {
      if (bubble.parentElement) bubble.parentElement.removeChild(bubble);
    }, 2200);
  }

  function appendChatMessage(msg) {
    if (!el['chat-messages-scroll']) return;
    var isYou = currentUser ? (msg.senderName === currentUser.username) : (msg.senderId === sessionId);

    var row = document.createElement('div');
    row.className = 'chat-msg-row ' + (isYou ? 'is-you' : 'is-opp');

    var nameTag = document.createElement('span');
    nameTag.className = 'chat-sender-name';
    nameTag.textContent = msg.senderName;
    row.appendChild(nameTag);

    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = msg.text;
    row.appendChild(bubble);

    el['chat-messages-scroll'].appendChild(row);
    el['chat-messages-scroll'].scrollTop = el['chat-messages-scroll'].scrollHeight;

    if (!isYou) {
      playSound('notify');
      if (el['chat-unread-dot']) el['chat-unread-dot'].hidden = false;
    }
  }

  function fetchChatMessages() {
    apiGet('/api/chat/messages').then(function (data) {
      if (data && data.messages && el['chat-messages-scroll']) {
        el['chat-messages-scroll'].textContent = '';
        data.messages.forEach(appendChatMessage);
      }
    }).catch(function () {});
  }

  // ---------------------------------------------------------------------------
  // 18. Notifications & Friends System
  // ---------------------------------------------------------------------------
  function fetchNotifications() {
    apiGet('/api/notifications').then(function (res) {
      notificationsList = res.notifications || [];
      renderNotifications();
    }).catch(function () {});
  }

  function renderNotifications() {
    if (!el['notif-badge'] || !el['notif-list']) return;
    var count = notificationsList.length;
    el['notif-badge'].textContent = count;
    el['notif-badge'].hidden = count === 0;

    if (el['notif-head-count']) {
      el['notif-head-count'].textContent = count + ' pending';
    }

    el['notif-list'].textContent = '';
    if (count === 0) {
      var empty = document.createElement('div');
      empty.className = 'notif-item';
      empty.textContent = 'No pending notifications. You are all caught up!';
      el['notif-list'].appendChild(empty);
      return;
    }

    notificationsList.forEach(function (req) {
      var item = document.createElement('div');
      item.className = 'notif-item';

      var msg = document.createElement('div');
      msg.className = 'notif-item-msg';
      msg.textContent = (req.fromUsername || 'A friend') + ' (Rating ' + req.fromRating + ') challenged you to a chess match!';
      item.appendChild(msg);

      var btnRow = document.createElement('div');
      btnRow.className = 'notif-btn-row';

      var btnAcc = document.createElement('button');
      btnAcc.type = 'button';
      btnAcc.className = 'btn btn-primary btn-sm';
      btnAcc.textContent = 'Accept ✓';
      btnAcc.addEventListener('click', function () {
        respondToRequest(req.id, 'accept');
      });
      btnRow.appendChild(btnAcc);

      var btnDec = document.createElement('button');
      btnDec.type = 'button';
      btnDec.className = 'btn btn-quiet btn-sm';
      btnDec.textContent = 'Decline';
      btnDec.addEventListener('click', function () {
        respondToRequest(req.id, 'decline');
      });
      btnRow.appendChild(btnDec);

      item.appendChild(btnRow);
      el['notif-list'].appendChild(item);
    });
  }

  function respondToRequest(requestId, action) {
    apiPost('/api/friends/respond', { requestId: requestId, action: action }).then(function () {
      showToast(action === 'accept' ? '🎉 Challenge accepted! Starting game...' : 'Request declined.');
      fetchNotifications();
      if (action === 'accept') {
        if (el['notifications-dropdown']) el['notifications-dropdown'].hidden = true;
      }
    });
  }

  function fetchFriendsList() {
    apiGet('/api/friends').then(function (data) {
      if (!el['friends-items-list'] || !data || !data.friends) return;
      el['friends-items-list'].textContent = '';
      data.friends.forEach(function (f) {
        var row = document.createElement('div');
        row.className = 'friend-item-row';

        var info = document.createElement('div');
        info.className = 'friend-item-info';

        var av = document.createElement('span');
        av.className = 'friend-item-avatar';
        av.textContent = f.avatar || '👤';
        info.appendChild(av);

        var details = document.createElement('div');
        details.innerHTML = '<div class="friend-item-name">' + f.username + '</div><div class="friend-item-rating">Rating ' + f.rating + ' &bull; ' + f.status + '</div>';
        info.appendChild(details);

        row.appendChild(info);

        var chalBtn = document.createElement('button');
        chalBtn.type = 'button';
        chalBtn.className = 'btn btn-primary btn-sm';
        chalBtn.textContent = '⚔️ Challenge';
        chalBtn.addEventListener('click', function () {
          challengeFriend(f.id, f.username);
        });
        row.appendChild(chalBtn);

        el['friends-items-list'].appendChild(row);
      });
    });
  }

  function challengeFriend(friendId, friendName) {
    if (el['modal-friends']) el['modal-friends'].hidden = true;
    showToast('Sending match challenge to ' + friendName + '...');
    apiPost('/api/friends/challenge', { friendId: friendId, name: currentUser ? currentUser.username : 'Player' }).then(function (res) {
      showToast('⚔️ Room #' + res.roomCode + ' created! Waiting for ' + friendName + '...');
      if (res.roomCode) {
        showConnectModal(res.roomCode);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 19. User Authentication & 6-Digit Email Verification
  // ---------------------------------------------------------------------------
  function updateUserHeaderBadge() {
    if (!el['user-name-tag']) return;
    if (currentUser) {
      el['user-name-tag'].textContent = currentUser.username;
      if (el['user-avatar-tag']) el['user-avatar-tag'].textContent = currentUser.avatar || '👤';
      if (el['user-verified-badge']) el['user-verified-badge'].hidden = !currentUser.verified;

      if (el['profile-avatar-display']) el['profile-avatar-display'].textContent = currentUser.avatar || '👤';
      if (el['profile-username-display']) el['profile-username-display'].textContent = currentUser.username;
      if (el['profile-email-display']) el['profile-email-display'].textContent = currentUser.email;
      if (el['profile-rating-display']) el['profile-rating-display'].textContent = currentUser.rating;
      if (el['profile-wins-display']) el['profile-wins-display'].textContent = currentUser.wins;
      if (el['profile-losses-display']) el['profile-losses-display'].textContent = currentUser.losses;

      if (el['player-name-input']) el['player-name-input'].value = currentUser.username;
    } else {
      el['user-name-tag'].textContent = 'Sign In';
      if (el['user-avatar-tag']) el['user-avatar-tag'].textContent = '👤';
      if (el['user-verified-badge']) el['user-verified-badge'].hidden = true;
    }
  }

  function showAuthModal(view) {
    if (!el['modal-auth']) return;
    el['modal-auth'].hidden = false;

    if (currentUser) {
      if (el['form-signin']) el['form-signin'].hidden = true;
      if (el['form-register']) el['form-register'].hidden = true;
      if (el['view-verify-step']) el['view-verify-step'].hidden = true;
      if (el['auth-tabs-bar']) el['auth-tabs-bar'].hidden = true;
      if (el['view-profile']) el['view-profile'].hidden = false;
      return;
    }

    if (el['auth-tabs-bar']) el['auth-tabs-bar'].hidden = false;
    if (el['view-profile']) el['view-profile'].hidden = true;

    if (view === 'register') {
      if (el['tab-auth-register']) el['tab-auth-register'].classList.add('is-active');
      if (el['tab-auth-signin']) el['tab-auth-signin'].classList.remove('is-active');
      if (el['form-register']) el['form-register'].hidden = false;
      if (el['form-signin']) el['form-signin'].hidden = true;
      if (el['view-verify-step']) el['view-verify-step'].hidden = true;
    } else if (view === 'verify') {
      if (el['auth-tabs-bar']) el['auth-tabs-bar'].hidden = true;
      if (el['form-signin']) el['form-signin'].hidden = true;
      if (el['form-register']) el['form-register'].hidden = true;
      if (el['view-verify-step']) el['view-verify-step'].hidden = false;
      // focus first digit box
      var firstBox = el['code-boxes-container']?.querySelector('input');
      if (firstBox) firstBox.focus();
    } else {
      if (el['tab-auth-signin']) el['tab-auth-signin'].classList.add('is-active');
      if (el['tab-auth-register']) el['tab-auth-register'].classList.remove('is-active');
      if (el['form-signin']) el['form-signin'].hidden = false;
      if (el['form-register']) el['form-register'].hidden = true;
      if (el['view-verify-step']) el['view-verify-step'].hidden = true;
    }
  }

  // ---------------------------------------------------------------------------
  // 20. Device Connect Modal & Links
  // ---------------------------------------------------------------------------
  function showConnectModal(roomCode) {
    if (!el['modal-device-connect']) return;

    var url = window.location.origin + '/?room=' + roomCode;
    if (el['input-share-link']) el['input-share-link'].value = url;
    if (el['modal-display-pin']) el['modal-display-pin'].textContent = roomCode;

    if (el['qr-canvas-container']) {
      el['qr-canvas-container'].innerHTML = generateQRCodeSVG(url);
    }

    if (el['btn-share-whatsapp']) {
      el['btn-share-whatsapp'].onclick = function () {
        var text = encodeURIComponent('Play chess with me! Room #' + roomCode + ': ' + url);
        window.open('https://api.whatsapp.com/send?text=' + text, '_blank');
      };
    }

    if (el['btn-share-email']) {
      el['btn-share-email'].onclick = function () {
        var sub = encodeURIComponent('Play Chess Arena: Room #' + roomCode);
        var body = encodeURIComponent('Join my live chess match on Chess Arena:\n' + url + '\nOr enter Room PIN: ' + roomCode);
        window.location.href = 'mailto:?subject=' + sub + '&body=' + body;
      };
    }

    el['modal-device-connect'].hidden = false;
  }

  // ---------------------------------------------------------------------------
  // 21. Toast & Clipboard
  // ---------------------------------------------------------------------------
  function showToast(msg) {
    if (!el['toast-pill'] || !el['toast-message']) return;
    el['toast-message'].textContent = msg;
    el['toast-pill'].hidden = false;
    el['toast-pill'].classList.remove('is-fading');

    setTimeout(function () {
      el['toast-pill'].classList.add('is-fading');
      setTimeout(function () {
        el['toast-pill'].hidden = true;
      }, 300);
    }, 2800);
  }

  function copyToClipboard(text, successMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showToast(successMsg);
      }).catch(function () {
        fallbackCopy(text, successMsg);
      });
    } else {
      fallbackCopy(text, successMsg);
    }
  }

  function fallbackCopy(text, successMsg) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast(successMsg);
    } catch {
      showToast('Copied: ' + text);
    }
    document.body.removeChild(ta);
  }

  // ---------------------------------------------------------------------------
  // 22. Server API Fetch & SSE Streams
  // ---------------------------------------------------------------------------
  function apiGet(url) {
    return fetch(url, {
      headers: {
        'x-session-id': sessionId,
        'Accept': 'application/json'
      }
    }).then(function (r) { return r.json(); });
  }

  function apiPost(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': sessionId,
        'Accept': 'application/json'
      },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data.error || 'Server error ' + r.status);
        return data;
      });
    });
  }

  function fetchState() {
    apiGet('/api/state').then(adoptState).catch(function () {});
  }

  function initSSE() {
    if (sseSource) {
      sseSource.close();
      sseSource = null;
    }

    try {
      sseSource = new EventSource('/api/events?sessionId=' + encodeURIComponent(sessionId));
      sseSource.onmessage = function (e) {
        try {
          var data = JSON.parse(e.data);
          adoptState(data);
        } catch {}
      };
      sseSource.onerror = function () {
        if (!pollTimer) {
          pollTimer = setInterval(fetchState, 1500);
        }
      };
    } catch {
      pollTimer = setInterval(fetchState, 1500);
    }
  }

  // ---------------------------------------------------------------------------
  // 23. Event Listeners & Match Setup
  // ---------------------------------------------------------------------------
  function setupEvents() {
    window.addEventListener('resize', computeLayout);

    if (el.board) {
      el.board.addEventListener('pointerdown', onPointerDown);
    }

    // Header Piece Shape Picker
    if (el['select-piece-style']) {
      el['select-piece-style'].value = settings.pieceStyle;
      el['select-piece-style'].addEventListener('change', function (e) {
        applyPieceStyle(e.target.value);
        showToast('Piece style: ' + (e.target.value === 'coins' ? '🪙 Coins & Tokens' : '♟️ Staunton Classic'));
      });
    }

    // Header Theme Swatches
    if (el['header-theme-picker']) {
      var swatches = el['header-theme-picker'].querySelectorAll('.theme-swatch');
      swatches.forEach(function (s) {
        s.addEventListener('click', function () {
          applyTheme(s.dataset.theme);
        });
      });
    }

    // Toggle Movements Layout (Left / Right side)
    if (el['btn-toggle-movements-layout']) {
      el['btn-toggle-movements-layout'].addEventListener('click', function () {
        var nextLayout = settings.movementsLayout === 'left' ? 'right' : 'left';
        applyMovementsLayout(nextLayout);
        showToast('Movements positioned on ' + nextLayout.toUpperCase() + ' side');
      });
    }

    // Sidebar Tab Navigation
    function switchTab(tabId) {
      [el['tab-btn-moves'], el['tab-btn-chat'], el['tab-btn-safety']].forEach(function (b) { if (b) b.classList.remove('is-active'); });
      [el['pane-moves'], el['pane-chat'], el['pane-safety']].forEach(function (p) { if (p) p.hidden = true; });

      if (tabId === 'moves') {
        if (el['tab-btn-moves']) el['tab-btn-moves'].classList.add('is-active');
        if (el['pane-moves']) el['pane-moves'].hidden = false;
      } else if (tabId === 'chat') {
        if (el['tab-btn-chat']) el['tab-btn-chat'].classList.add('is-active');
        if (el['pane-chat']) el['pane-chat'].hidden = false;
        if (el['chat-unread-dot']) el['chat-unread-dot'].hidden = true;
        fetchChatMessages();
      } else if (tabId === 'safety') {
        if (el['tab-btn-safety']) el['tab-btn-safety'].classList.add('is-active');
        if (el['pane-safety']) el['pane-safety'].hidden = false;
      }
    }

    if (el['tab-btn-moves']) el['tab-btn-moves'].addEventListener('click', function () { switchTab('moves'); });
    if (el['tab-btn-chat']) el['tab-btn-chat'].addEventListener('click', function () { switchTab('chat'); });
    if (el['tab-btn-safety']) el['tab-btn-safety'].addEventListener('click', function () { switchTab('safety'); });

    // King Escapes Toggles
    if (el['btn-banner-show-escapes']) {
      el['btn-banner-show-escapes'].addEventListener('click', function () {
        showKingEscapesActive = !showKingEscapesActive;
        renderHighlights();
      });
    }

    if (el['btn-toggle-king-escapes']) {
      el['btn-toggle-king-escapes'].addEventListener('click', function () {
        showKingEscapesActive = !showKingEscapesActive;
        el['btn-toggle-king-escapes'].classList.toggle('is-active', showKingEscapesActive);
        renderHighlights();
        showToast(showKingEscapesActive ? '🛡️ Highlighting King safe escapes' : 'Normal view');
      });
    }

    // Notifications Button & Dropdown
    if (el['btn-notifications']) {
      el['btn-notifications'].addEventListener('click', function () {
        if (el['notifications-dropdown']) {
          el['notifications-dropdown'].hidden = !el['notifications-dropdown'].hidden;
          if (!el['notifications-dropdown'].hidden) fetchNotifications();
        }
      });
    }

    // User Auth Pill Button
    if (el['btn-user-auth']) {
      el['btn-user-auth'].addEventListener('click', function () {
        showAuthModal(currentUser ? 'profile' : 'signin');
      });
    }

    // Friends Modal Trigger
    if (el['nav-btn-friends-modal']) {
      el['nav-btn-friends-modal'].addEventListener('click', function () {
        if (el['modal-friends']) {
          el['modal-friends'].hidden = false;
          fetchFriendsList();
        }
      });
    }

    if (el['btn-close-friends']) {
      el['btn-close-friends'].addEventListener('click', function () {
        if (el['modal-friends']) el['modal-friends'].hidden = true;
      });
    }

    if (el['btn-send-friend-req']) {
      el['btn-send-friend-req'].addEventListener('click', function () {
        var uname = el['input-add-friend'] ? el['input-add-friend'].value : '';
        if (uname) {
          apiPost('/api/friends/request', { username: uname }).then(function (res) {
            showToast(res.message || 'Request sent!');
            if (el['input-add-friend']) el['input-add-friend'].value = '';
          }).catch(function (err) {
            showToast(err.message);
          });
        }
      });
    }

    // Live In-Game Chat Submission
    if (el['form-chat']) {
      el['form-chat'].addEventListener('submit', function (e) {
        e.preventDefault();
        var text = el['input-chat-text'] ? el['input-chat-text'].value : '';
        if (text) {
          apiPost('/api/chat/send', { text: text }).then(function (res) {
            if (el['input-chat-text']) el['input-chat-text'].value = '';
            if (res.message) appendChatMessage(res.message);
          });
        }
      });
    }

    // Quick Reaction Dock
    if (el['reactions-dock']) {
      var emojiButtons = el['reactions-dock'].querySelectorAll('.emoji-btn');
      emojiButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var em = btn.dataset.emoji;
          apiPost('/api/reaction', { emoji: em });
          showFloatingReaction(em, currentUser ? currentUser.username : 'You');
        });
      });
    }

    // Auth Modal Elements
    if (el['btn-close-auth']) {
      el['btn-close-auth'].addEventListener('click', function () {
        if (el['modal-auth']) el['modal-auth'].hidden = true;
      });
    }

    if (el['tab-auth-signin']) {
      el['tab-auth-signin'].addEventListener('click', function () { showAuthModal('signin'); });
    }
    if (el['tab-auth-register']) {
      el['tab-auth-register'].addEventListener('click', function () { showAuthModal('register'); });
    }
    if (el['btn-back-to-auth']) {
      el['btn-back-to-auth'].addEventListener('click', function () { showAuthModal('register'); });
    }

    // Sign In form
    if (el['form-signin']) {
      el['form-signin'].addEventListener('submit', function (e) {
        e.preventDefault();
        var u = el['signin-username'] ? el['signin-username'].value : '';
        var p = el['signin-password'] ? el['signin-password'].value : '';
        apiPost('/api/auth/login', { usernameOrEmail: u, password: p }).then(function (res) {
          if (res.requiresVerification) {
            pendingVerifyUser = { username: res.username, email: res.email };
            if (el['verify-email-text']) el['verify-email-text'].textContent = 'Verification code sent to ' + res.email + '. Enter the 6-digit code below:';
            if (el['verify-generated-code']) el['verify-generated-code'].textContent = res.verificationCode;
            showAuthModal('verify');
            return;
          }
          currentUser = res.user;
          updateUserHeaderBadge();
          if (el['modal-auth']) el['modal-auth'].hidden = true;
          showToast(res.message || 'Logged in!');
          fetchState();
        }).catch(function (err) {
          showToast(err.message);
        });
      });
    }

    // Register form (triggers 6-digit verification code)
    if (el['form-register']) {
      el['form-register'].addEventListener('submit', function (e) {
        e.preventDefault();
        var u = el['reg-username'] ? el['reg-username'].value : '';
        var mail = el['reg-email'] ? el['reg-email'].value : '';
        var p = el['reg-password'] ? el['reg-password'].value : '';

        apiPost('/api/auth/register', { username: u, email: mail, password: p }).then(function (res) {
          pendingVerifyUser = { username: u, email: mail };
          if (el['verify-email-text']) el['verify-email-text'].textContent = 'Verification code sent to ' + mail + '. Enter your 6-digit code below:';
          if (el['verify-generated-code']) el['verify-generated-code'].textContent = res.verificationCode;
          showAuthModal('verify');
          showToast('📬 Verification code sent to ' + mail);
        }).catch(function (err) {
          showToast(err.message);
        });
      });
    }

    // 6-Digit Verification Box auto-advancing inputs
    if (el['code-boxes-container']) {
      var digitInputs = el['code-boxes-container'].querySelectorAll('.digit-box');
      digitInputs.forEach(function (inp, idx) {
        inp.addEventListener('input', function () {
          inp.value = inp.value.replace(/\D/g, '');
          if (inp.value && idx < digitInputs.length - 1) {
            digitInputs[idx + 1].focus();
          }
        });
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Backspace' && !inp.value && idx > 0) {
            digitInputs[idx - 1].focus();
          }
        });
      });
    }

    // Submit Verification Code
    if (el['btn-submit-code']) {
      el['btn-submit-code'].addEventListener('click', function () {
        var digitInputs = el['code-boxes-container']?.querySelectorAll('.digit-box');
        var code = '';
        if (digitInputs) {
          digitInputs.forEach(function (d) { code += d.value; });
        }
        if (code.length !== 6) {
          showToast('Please enter all 6 digits of the verification code.');
          return;
        }

        apiPost('/api/auth/verify', {
          email: pendingVerifyUser ? pendingVerifyUser.email : '',
          username: pendingVerifyUser ? pendingVerifyUser.username : '',
          code: code
        }).then(function (res) {
          currentUser = res.user;
          updateUserHeaderBadge();
          if (el['modal-auth']) el['modal-auth'].hidden = true;
          showToast('🎉 Account Verified Successfully!');
          playSound('win');
          fetchState();
        }).catch(function (err) {
          showToast(err.message);
          playSound('illegal');
        });
      });
    }

    // Resend Code
    if (el['btn-resend-code']) {
      el['btn-resend-code'].addEventListener('click', function () {
        showToast('Resent verification code to your email!');
      });
    }

    // Sign Out
    if (el['btn-logout-auth']) {
      el['btn-logout-auth'].addEventListener('click', function () {
        apiPost('/api/auth/logout').then(function () {
          currentUser = null;
          updateUserHeaderBadge();
          if (el['modal-auth']) el['modal-auth'].hidden = true;
          showToast('Signed out.');
          fetchState();
        });
      });
    }

    // Level selector
    if (el['level-selector']) {
      var levelCards = el['level-selector'].querySelectorAll('.level-card');
      levelCards.forEach(function (card) {
        card.addEventListener('click', function () {
          levelCards.forEach(function (c) {
            c.classList.remove('is-active');
            c.setAttribute('aria-checked', 'false');
          });
          card.classList.add('is-active');
          card.setAttribute('aria-checked', 'true');
          chosenLevel = card.dataset.level;
          playSound('move');
        });
      });
    }

    // Color picker
    var colorOptions = document.querySelectorAll('.color-option');
    colorOptions.forEach(function (opt) {
      opt.addEventListener('click', function () {
        colorOptions.forEach(function (o) { o.classList.remove('is-active'); });
        opt.classList.add('is-active');
        chosenColor = opt.dataset.color;
        playSound('move');
      });
    });

    // Time selectors
    if (el['time-selector-computer']) {
      var badges = el['time-selector-computer'].querySelectorAll('.time-badge');
      badges.forEach(function (b) {
        b.addEventListener('click', function () {
          badges.forEach(function (x) { x.classList.remove('is-active'); });
          b.classList.add('is-active');
          chosenTimeControl = parseInt(b.dataset.time, 10);
          playSound('move');
        });
      });
    }

    if (el['time-selector-friend']) {
      var fBadges = el['time-selector-friend'].querySelectorAll('.time-badge');
      fBadges.forEach(function (b) {
        b.addEventListener('click', function () {
          fBadges.forEach(function (x) { x.classList.remove('is-active'); });
          b.classList.add('is-active');
          chosenFriendTimeControl = parseInt(b.dataset.time, 10);
          playSound('move');
        });
      });
    }

    // Start single player vs Computer
    if (el['btn-start-computer']) {
      el['btn-start-computer'].addEventListener('click', function () {
        var name = (el['player-name-input'] && el['player-name-input'].value) || (currentUser ? currentUser.username : 'Player');
        playSound('move');

        isSinglePlayer = true;
        isCasualMode = chosenTimeControl === 0;
        casualElapsedSeconds = 0;
        whiteClockSeconds = chosenTimeControl || 600;
        blackClockSeconds = chosenTimeControl || 600;

        userInGame = true;
        chessClient.reset();

        apiPost('/api/single-player', {
          level: chosenLevel,
          colour: chosenColor,
          name: name
        }).then(function (next) {
          userInGame = true;
          adoptState(next);
          startClockTimer();
          showToast('Game started vs Computer (' + chosenLevel.toUpperCase() + ') — 4s Pacing');
        });
      });
    }

    // Host room
    if (el['btn-host-room']) {
      el['btn-host-room'].addEventListener('click', function () {
        var name = (el['player-name-input'] && el['player-name-input'].value) || (currentUser ? currentUser.username : 'Player');
        playSound('move');

        isSinglePlayer = false;
        isCasualMode = chosenFriendTimeControl === 0;
        casualElapsedSeconds = 0;
        whiteClockSeconds = chosenFriendTimeControl || 600;
        blackClockSeconds = chosenFriendTimeControl || 600;

        userInGame = true;
        chessClient.reset();

        apiPost('/api/host', { name: name }).then(function (next) {
          userInGame = true;
          adoptState(next);
          startClockTimer();
          showConnectModal(next.roomCode);
        }).catch(function (err) {
          userInGame = false;
          showToast('Failed to create room: ' + err.message);
        });
      });
    }

    // Join room
    if (el['btn-join-room']) {
      el['btn-join-room'].addEventListener('click', function () {
        var code = (el['input-room-code'] && el['input-room-code'].value || '').trim();
        var name = (el['player-name-input'] && el['player-name-input'].value) || (currentUser ? currentUser.username : 'Player');
        if (!/^\d{4}$/.test(code)) {
          showToast('Room PIN must be a 4-digit number.');
          return;
        }

        apiPost('/api/join', { code: code, name: name }).then(function (next) {
          if (next.error) {
            showToast(next.error);
            return;
          }
          userInGame = true;
          isSinglePlayer = false;
          adoptState(next);
          startClockTimer();
          showToast('🎉 Joined Room #' + code);
        }).catch(function (err) {
          showToast(err.message);
        });
      });
    }

    // Undo (Takeback vs computer)
    if (el['btn-action-undo']) {
      el['btn-action-undo'].addEventListener('click', function () {
        if (!isSinglePlayer) {
          showToast('Takeback is only available against the computer.');
          return;
        }
        apiPost('/api/undo').then(function (next) {
          adoptState(next);
          showToast('↩️ Move taken back.');
          playSound('move');
        });
      });
    }

    // Hint
    if (el['btn-action-hint']) {
      el['btn-action-hint'].addEventListener('click', function () {
        apiGet('/api/hint').then(function (res) {
          if (res && res.hint) {
            hintSquares = [res.hint.fromIdx, res.hint.toIdx];
            renderHighlights();
            showToast('💡 Engine suggestion: ' + res.hint.san);
            playSound('move');
          } else {
            showToast('No hint available.');
          }
        });
      });
    }

    // Flip board
    if (el['btn-flip-board']) {
      el['btn-flip-board'].addEventListener('click', function () {
        flipped = !flipped;
        buildGrid();
        renderPieces();
        renderHighlights();
        playSound('move');
      });
    }

    // Connect phone
    if (el['btn-connect-phone-game']) {
      el['btn-connect-phone-game'].addEventListener('click', function () {
        if (state && state.roomCode) {
          showConnectModal(state.roomCode);
        } else {
          showToast('Host a multiplayer room to connect devices.');
        }
      });
    }

    // Copy PGN & FEN
    if (el['btn-copy-pgn']) {
      el['btn-copy-pgn'].addEventListener('click', function () {
        var pgn = chessClient.pgn() || chessClient.history().join(' ');
        copyToClipboard(pgn, '📋 PGN copied to clipboard!');
      });
    }

    if (el['btn-copy-fen']) {
      el['btn-copy-fen'].addEventListener('click', function () {
        copyToClipboard(chessClient.fen(), '📋 FEN copied to clipboard!');
      });
    }

    // Resign
    if (el['btn-action-resign']) {
      el['btn-action-resign'].addEventListener('click', function () {
        if (el['modal-resign-confirm']) el['modal-resign-confirm'].hidden = false;
      });
    }

    if (el['btn-confirm-resign']) {
      el['btn-confirm-resign'].addEventListener('click', function () {
        if (el['modal-resign-confirm']) el['modal-resign-confirm'].hidden = true;
        apiPost('/api/resign').then(function (next) {
          adoptState(next);
          checkAndHandleGameOver();
        });
      });
    }

    if (el['btn-cancel-resign']) {
      el['btn-cancel-resign'].addEventListener('click', function () {
        if (el['modal-resign-confirm']) el['modal-resign-confirm'].hidden = true;
      });
    }

    // Rematch
    function triggerRematch() {
      if (el['modal-gameover']) el['modal-gameover'].hidden = true;
      showToast('Starting Rematch...');
      apiPost('/api/rematch').then(function (next) {
        userInGame = true;
        chessClient.reset();
        adoptState(next);
        startClockTimer();
      });
    }

    if (el['btn-action-rematch']) el['btn-action-rematch'].addEventListener('click', triggerRematch);
    if (el['btn-modal-rematch']) el['btn-modal-rematch'].addEventListener('click', triggerRematch);

    // Return to menu
    function returnToMenu() {
      userInGame = false;
      if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
      if (botCountdownInterval) { clearInterval(botCountdownInterval); botCountdownInterval = null; }
      isBotThinking = false;
      reviewPly = -1;
      if (el['modal-gameover']) el['modal-gameover'].hidden = true;
      if (el['modal-resign-confirm']) el['modal-resign-confirm'].hidden = true;
      if (el['screen-game']) el['screen-game'].hidden = true;
      if (el['screen-home']) el['screen-home'].hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });

      apiPost('/api/leave').then(function (next) {
        userInGame = false;
        adoptState(next);
      }).catch(function () {
        userInGame = false;
      });
    }

    if (el['btn-action-menu']) el['btn-action-menu'].addEventListener('click', returnToMenu);
    if (el['btn-modal-menu']) el['btn-modal-menu'].addEventListener('click', returnToMenu);
    if (el['btn-brand']) {
      el['btn-brand'].addEventListener('click', function (e) {
        e.preventDefault();
        returnToMenu();
      });
    }

    // Move Review Stepper
    function updateReviewState(plyIndex) {
      var hist = chessClient.history({ verbose: true });
      if (hist.length === 0) return;

      plyIndex = Math.max(0, Math.min(hist.length, plyIndex));
      reviewPly = plyIndex;

      var tempChess = new ChessEngine();
      for (var i = 0; i < reviewPly; i++) {
        tempChess.move(hist[i]);
      }

      var b = tempChess.board();
      var prefix = getPieceSvgPrefix();

      if (el.pieces) {
        el.pieces.textContent = '';
        for (var r = 0; r < 8; r++) {
          for (var c = 0; c < 8; c++) {
            var piece = b[r][c];
            if (!piece) continue;
            var sqIdx = r * 8 + c;
            var pieceEl = document.createElement('div');
            pieceEl.className = 'piece';
            var pos = getSquarePos(sqIdx);
            pieceEl.style.transform = 'translate3d(' + pos.x + 'px,' + pos.y + 'px,0)';
            var pCode = piece.color + (piece.type === 'n' ? 'n' : piece.type);
            pieceEl.innerHTML = '<svg viewBox="0 0 45 45"><use href="' + prefix + pCode + '"/></svg>';
            el.pieces.appendChild(pieceEl);
          }
        }
      }

      if (reviewPly === hist.length) {
        renderPieces();
        renderHighlights();
      }
    }

    if (el['btn-step-start']) el['btn-step-start'].addEventListener('click', function () { updateReviewState(0); playSound('move'); });
    if (el['btn-step-prev']) el['btn-step-prev'].addEventListener('click', function () { updateReviewState((reviewPly >= 0 ? reviewPly : chessClient.history().length) - 1); playSound('move'); });
    if (el['btn-step-next']) el['btn-step-next'].addEventListener('click', function () { updateReviewState((reviewPly >= 0 ? reviewPly : chessClient.history().length) + 1); playSound('move'); });
    if (el['btn-step-end']) el['btn-step-end'].addEventListener('click', function () { reviewPly = -1; renderPieces(); renderHighlights(); playSound('move'); });

    // Header nav links
    if (el['nav-btn-computer']) {
      el['nav-btn-computer'].addEventListener('click', function () {
        el['nav-btn-computer'].classList.add('is-active');
        if (el['nav-btn-friend']) el['nav-btn-friend'].classList.remove('is-active');
        var compCard = document.querySelector('.card-computer');
        if (compCard) compCard.scrollIntoView({ behavior: 'smooth' });
      });
    }

    if (el['nav-btn-friend']) {
      el['nav-btn-friend'].addEventListener('click', function () {
        el['nav-btn-friend'].classList.add('is-active');
        if (el['nav-btn-computer']) el['nav-btn-computer'].classList.remove('is-active');
        var friendCard = document.querySelector('.card-friend');
        if (friendCard) friendCard.scrollIntoView({ behavior: 'smooth' });
      });
    }

    // Settings Modal
    if (el['btn-settings-open']) {
      el['btn-settings-open'].addEventListener('click', function () {
        if (el['modal-settings']) el['modal-settings'].hidden = false;
      });
    }
    if (el['btn-settings-close']) {
      el['btn-settings-close'].addEventListener('click', function () {
        if (el['modal-settings']) el['modal-settings'].hidden = true;
      });
    }
    if (el['btn-settings-done']) {
      el['btn-settings-done'].addEventListener('click', function () {
        if (el['modal-settings']) el['modal-settings'].hidden = true;
      });
    }

    // Sound toggle in header
    if (el['btn-sound-toggle']) {
      el['btn-sound-toggle'].addEventListener('click', function () {
        soundEnabled = !soundEnabled;
        if (el['sound-icon-state']) el['sound-icon-state'].innerHTML = soundEnabled ? '&#128266;' : '&#128263;';
        showToast(soundEnabled ? 'Audio enabled' : 'Audio muted');
      });
    }

    // Modal close for device connect
    if (el['btn-close-connect']) {
      el['btn-close-connect'].addEventListener('click', function () {
        if (el['modal-device-connect']) el['modal-device-connect'].hidden = true;
      });
    }

    // Copy direct invite link
    if (el['btn-copy-link']) {
      el['btn-copy-link'].addEventListener('click', function () {
        if (state && state.roomCode) {
          var url = window.location.origin + '/?room=' + state.roomCode;
          copyToClipboard(url, '📋 Room invite link copied!');
        }
      });
    }
    if (el['btn-copy-code']) {
      el['btn-copy-code'].addEventListener('click', function () {
        if (state && state.roomCode) {
          copyToClipboard(state.roomCode, '📋 4-digit PIN copied: ' + state.roomCode);
        }
      });
    }

    // Settings event listeners
    if (el['setting-theme-select']) {
      el['setting-theme-select'].addEventListener('change', function (e) {
        applyTheme(e.target.value);
        showToast('Board theme: ' + e.target.value);
      });
    }

    if (el['setting-pieces-select']) {
      el['setting-pieces-select'].addEventListener('change', function (e) {
        applyPieceStyle(e.target.value);
        renderPieces(true);
        showToast('Piece style: ' + e.target.value);
      });
    }

    if (el['setting-soundpack-select']) {
      el['setting-soundpack-select'].addEventListener('change', function (e) {
        settings.soundPack = e.target.value;
        try { localStorage.setItem('chess_sound_pack', e.target.value); } catch {}
        playSound('capture');
        showToast('Hit audio pack updated');
      });
    }

    if (el['setting-sound-toggle']) {
      el['setting-sound-toggle'].addEventListener('change', function (e) {
        settings.sound = e.target.checked;
        soundEnabled = e.target.checked;
        try { localStorage.setItem('chess_sound', String(e.target.checked)); } catch {}
        if (el['sound-icon-state']) el['sound-icon-state'].innerHTML = soundEnabled ? '&#128266;' : '&#128263;';
      });
    }

    if (el['setting-hints-toggle']) {
      el['setting-hints-toggle'].addEventListener('change', function (e) {
        settings.hints = e.target.checked;
        try { localStorage.setItem('chess_hints', String(e.target.checked)); } catch {}
        renderHighlights();
      });
    }

    if (el['setting-lastmove-toggle']) {
      el['setting-lastmove-toggle'].addEventListener('change', function (e) {
        settings.lastMove = e.target.checked;
        try { localStorage.setItem('chess_lastmove', String(e.target.checked)); } catch {}
        renderHighlights();
      });
    }

    if (el['setting-coords-toggle']) {
      el['setting-coords-toggle'].addEventListener('change', function (e) {
        settings.coords = e.target.checked;
        try { localStorage.setItem('chess_coords', String(e.target.checked)); } catch {}
        buildGrid();
      });
    }

    if (el['setting-movements-toggle']) {
      el['setting-movements-toggle'].addEventListener('change', function (e) {
        applyMovementsLayout(e.target.checked ? 'left' : 'right');
      });
    }

    if (el['setting-eval-toggle']) {
      el['setting-eval-toggle'].addEventListener('change', function (e) {
        settings.evalBar = e.target.checked;
        try { localStorage.setItem('chess_eval_bar', String(e.target.checked)); } catch {}
        if (el['eval-bar']) el['eval-bar'].style.display = e.target.checked ? '' : 'none';
        computeLayout();
      });
    }

    if (el['setting-king-alert-toggle']) {
      el['setting-king-alert-toggle'].addEventListener('change', function (e) {
        settings.kingAlert = e.target.checked;
        try { localStorage.setItem('chess_king_alert', String(e.target.checked)); } catch {}
        if (!e.target.checked && el['king-danger-banner']) el['king-danger-banner'].hidden = true;
        renderHighlights();
        computeLayout();
      });
    }

    if (el['setting-animation-toggle']) {
      el['setting-animation-toggle'].addEventListener('change', function (e) {
        settings.animations = e.target.checked;
        try { localStorage.setItem('chess_animations', String(e.target.checked)); } catch {}
        document.documentElement.dataset.noAnim = e.target.checked ? 'false' : 'true';
      });
    }

    if (el['setting-auto-queen-toggle']) {
      el['setting-auto-queen-toggle'].addEventListener('change', function (e) {
        settings.autoQueen = e.target.checked;
        try { localStorage.setItem('chess_auto_queen', String(e.target.checked)); } catch {}
      });
    }

    if (el['setting-material-toggle']) {
      el['setting-material-toggle'].addEventListener('change', function (e) {
        settings.materialShelf = e.target.checked;
        try { localStorage.setItem('chess_material_shelf', String(e.target.checked)); } catch {}
        if (el['you-captured-shelf']) el['you-captured-shelf'].style.display = e.target.checked ? '' : 'none';
        if (el['opp-captured-shelf']) el['opp-captured-shelf'].style.display = e.target.checked ? '' : 'none';
      });
    }

    if (el['setting-autoflip-toggle']) {
      el['setting-autoflip-toggle'].addEventListener('change', function (e) {
        settings.autoFlip = e.target.checked;
        try { localStorage.setItem('chess_auto_flip', String(e.target.checked)); } catch {}
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 24. URL Room Auto-Join
  // ---------------------------------------------------------------------------
  function checkUrlRoom() {
    var params = new URLSearchParams(window.location.search);
    var roomCode = params.get('room');
    if (roomCode && /^\d{4}$/.test(roomCode)) {
      if (el['input-room-code']) el['input-room-code'].value = roomCode;
      showToast('Connecting to Room #' + roomCode + '...');
      apiPost('/api/join', { code: roomCode, name: currentUser ? currentUser.username : 'Guest' }).then(function (next) {
        if (next.error) {
          showToast(next.error);
          return;
        }
        adoptState(next);
        startClockTimer();
        showToast('🎉 Joined Room #' + roomCode);
      }).catch(function () {});
    }
  }

  function syncSettingsUI() {
    if (el['setting-theme-select']) el['setting-theme-select'].value = settings.theme;
    if (el['setting-pieces-select']) el['setting-pieces-select'].value = settings.pieceStyle;
    if (el['setting-soundpack-select']) el['setting-soundpack-select'].value = settings.soundPack;
    if (el['setting-sound-toggle']) el['setting-sound-toggle'].checked = settings.sound;
    if (el['setting-hints-toggle']) el['setting-hints-toggle'].checked = settings.hints;
    if (el['setting-lastmove-toggle']) el['setting-lastmove-toggle'].checked = settings.lastMove;
    if (el['setting-coords-toggle']) el['setting-coords-toggle'].checked = settings.coords;
    if (el['setting-movements-toggle']) el['setting-movements-toggle'].checked = settings.movementsLayout === 'left';
    if (el['setting-eval-toggle']) el['setting-eval-toggle'].checked = settings.evalBar;
    if (el['setting-king-alert-toggle']) el['setting-king-alert-toggle'].checked = settings.kingAlert;
    if (el['setting-animation-toggle']) el['setting-animation-toggle'].checked = settings.animations;
    if (el['setting-auto-queen-toggle']) el['setting-auto-queen-toggle'].checked = settings.autoQueen;
    if (el['setting-material-toggle']) el['setting-material-toggle'].checked = settings.materialShelf;
    if (el['setting-autoflip-toggle']) el['setting-autoflip-toggle'].checked = settings.autoFlip;

    if (el['eval-bar']) el['eval-bar'].style.display = settings.evalBar ? '' : 'none';
    if (el['you-captured-shelf']) el['you-captured-shelf'].style.display = settings.materialShelf ? '' : 'none';
    if (el['opp-captured-shelf']) el['opp-captured-shelf'].style.display = settings.materialShelf ? '' : 'none';
    document.documentElement.dataset.noAnim = settings.animations ? 'false' : 'true';
  }

  // ---------------------------------------------------------------------------
  // 25. Initialization
  // ---------------------------------------------------------------------------
  function init() {
    initElements();
    syncSettingsUI();
    applyTheme(settings.theme);
    applyPieceStyle(settings.pieceStyle);
    applyMovementsLayout(settings.movementsLayout);
    setupEvents();
    buildGrid();
    computeLayout();
    initSSE();
    fetchState();
    fetchNotifications();

    // Fetch Auth Profile
    apiGet('/api/auth/me').then(function (res) {
      if (res && res.user) {
        currentUser = res.user;
        updateUserHeaderBadge();
      }
    }).catch(function () {});

    checkUrlRoom();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
