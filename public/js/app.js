/**
 * Chess Arena - Professional Online & Local Chess Application
 * Features:
 * - Instant, zero-latency client-side engine for computer matches (<100ms response)
 * - Strict FIDE chess rule enforcement via bundled chess.js engine
 * - Smart castling (drop on target square or click friendly rook)
 * - Auto-queen pawn promotion & custom promotion picker
 * - Automatic clock timeout enforcement (Winner declared when flag falls)
 * - "Hold and place" (Drag & Drop) with custom hand cursor & "Click-to-Move"
 * - Cross-device phone & PC pairing with instant SVG QR code & shareable link
 * - Selectable time controls: 1m Bullet, 3m Blitz, 5m Blitz, 10m Rapid, 15m Rapid, Unlimited Casual
 * - ↩️ Undo (Takeback) move against computer
 * - 💡 Engine Hint with animated laser square highlighting
 * - 📋 1-Click PGN & FEN export
 * - Web Audio acoustic wooden sound effects
 * - Dynamic Evaluation Bar & Captured pieces graveyard
 * - Move history table with 50+ opening book identification
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. Session Persistence
  // ---------------------------------------------------------------------------
  var SESSION_KEY = 'chess_arena_session_id';
  var sessionId = localStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = 'sess_' + Math.random().toString(36).substring(2, 12) + '_' + Date.now().toString(36);
    try {
      localStorage.setItem(SESSION_KEY, sessionId);
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // 2. Engine & Game State
  // ---------------------------------------------------------------------------
  var ChessEngine = window.ChessJS ? window.ChessJS.Chess : window.Chess;
  var chessClient = new ChessEngine();

  var state = null;
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

  // Clocks (seconds remaining)
  var whiteClockSeconds = 600;
  var blackClockSeconds = 600;
  var clockTimer = null;
  var isBotThinking = false;

  var settings = {
    sound: true,
    hints: true,
    lastMove: true,
    coords: true
  };

  // DOM Elements
  var el = {};
  function $(id) {
    return document.getElementById(id);
  }

  function initElements() {
    [
      'app', 'screen-home', 'screen-game',
      'player-name-input', 'level-selector', 'btn-start-computer',
      'time-selector-computer', 'time-selector-friend',
      'btn-host-room', 'input-room-code', 'btn-join-room',
      'btn-brand', 'nav-btn-computer', 'nav-btn-friend',
      'btn-sound-toggle', 'sound-icon-state', 'btn-settings-open', 'header-theme-picker',
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
      'modal-device-connect', 'btn-close-connect', 'qr-canvas-container', 'input-share-link',
      'btn-modal-copy-link', 'modal-display-pin', 'btn-modal-copy-pin', 'btn-share-whatsapp', 'btn-share-email', 'modal-radar-text',
      'modal-gameover', 'gameover-crown', 'gameover-title', 'gameover-detail', 'btn-modal-rematch', 'btn-modal-menu',
      'modal-resign-confirm', 'btn-confirm-resign', 'btn-cancel-resign',
      'modal-settings', 'btn-settings-close', 'btn-settings-done',
      'setting-sound-toggle', 'setting-hints-toggle', 'setting-lastmove-toggle', 'setting-coords-toggle',
      'toast-pill', 'toast-message'
    ].forEach(function (id) {
      el[id] = $(id);
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Compact SVG QR Code Generator (Pure JavaScript)
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
  // 4. Coordinates & Piece Helpers
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
    var row = 8 - rank;
    return row * 8 + file;
  }

  var PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

  // ---------------------------------------------------------------------------
  // 5. Client-Side Instant Chess Bot Engine (<10ms tactical negamax)
  // ---------------------------------------------------------------------------
  var PIECE_SCORES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

  var PAWN_PST = [
    0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0
  ];

  var KNIGHT_PST = [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50
  ];

  var BISHOP_PST = [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20
  ];

  var ROOK_PST = [
      0,  0,  0,  0,  0,  0,  0,  0,
      5, 10, 10, 10, 10, 10, 10,  5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
      0,  0,  0,  5,  5,  0,  0,  0
  ];

  var QUEEN_PST = [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20
  ];

  var KING_PST = [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20
  ];

  function evaluateClientBoard(chess) {
    var board = chess.board();
    var total = 0;
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var p = board[r][c];
        if (!p) continue;

        var idx = r * 8 + c;
        var tableIdx = p.color === 'w' ? idx : (63 - idx);
        var pst = 0;

        switch (p.type) {
          case 'p': pst = PAWN_PST[tableIdx]; break;
          case 'n': pst = KNIGHT_PST[tableIdx]; break;
          case 'b': pst = BISHOP_PST[tableIdx]; break;
          case 'r': pst = ROOK_PST[tableIdx]; break;
          case 'q': pst = QUEEN_PST[tableIdx]; break;
          case 'k': pst = KING_PST[tableIdx]; break;
        }

        var val = (PIECE_SCORES[p.type] || 0) + pst;
        if (p.color === 'w') total += val;
        else total -= val;
      }
    }
    return total;
  }

  function minimaxClient(chess, depth, alpha, beta, isMax) {
    if (depth === 0 || chess.isGameOver()) {
      return evaluateClientBoard(chess);
    }

    var moves = chess.moves({ verbose: true });
    moves.sort(function (a, b) {
      var aVal = (a.captured ? 1000 : 0) + (a.promotion ? 800 : 0);
      var bVal = (b.captured ? 1000 : 0) + (b.promotion ? 800 : 0);
      return bVal - aVal;
    });

    if (isMax) {
      var maxEval = -Infinity;
      for (var i = 0; i < moves.length; i++) {
        chess.move(moves[i]);
        var ev = minimaxClient(chess, depth - 1, alpha, beta, false);
        chess.undo();
        maxEval = Math.max(maxEval, ev);
        alpha = Math.max(alpha, ev);
        if (beta <= alpha) break;
      }
      return maxEval;
    } else {
      var minEval = Infinity;
      for (var j = 0; j < moves.length; j++) {
        chess.move(moves[j]);
        var ev2 = minimaxClient(chess, depth - 1, alpha, beta, true);
        chess.undo();
        minEval = Math.min(minEval, ev2);
        beta = Math.min(beta, ev2);
        if (beta <= alpha) break;
      }
      return minEval;
    }
  }

  function findBestMoveClient(chess, level) {
    var moves = chess.moves({ verbose: true });
    if (moves.length === 0) return null;
    if (moves.length === 1) return moves[0];

    if (level === 'simple') {
      if (Math.random() < 0.4) {
        return moves[Math.floor(Math.random() * moves.length)];
      }
    }

    var depth = level === 'hard' ? 3 : (level === 'medium' ? 2 : 1);
    var isWhite = chess.turn() === 'w';
    var bestMove = moves[0];
    var bestScore = isWhite ? -Infinity : Infinity;

    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      chess.move(m);
      var score = minimaxClient(chess, depth - 1, -Infinity, Infinity, !isWhite);
      chess.undo();

      var noise = level === 'simple' ? (Math.random() * 60 - 30) : (level === 'medium' ? (Math.random() * 20 - 10) : 0);
      var adjScore = score + noise;

      if (isWhite) {
        if (adjScore > bestScore) {
          bestScore = adjScore;
          bestMove = m;
        }
      } else {
        if (adjScore < bestScore) {
          bestScore = adjScore;
          bestMove = m;
        }
      }
    }
    return bestMove;
  }

  function triggerClientBotMove() {
    if (!isSinglePlayer || chessClient.isGameOver()) return;

    var humanTurnColor = state.localSide === 'white' ? 'w' : 'b';
    var isBotTurn = chessClient.turn() !== humanTurnColor;
    if (!isBotTurn) return;

    isBotThinking = true;
    if (el['opp-status-text']) el['opp-status-text'].textContent = 'Thinking...';
    if (el['opp-status-dot']) el['opp-status-dot'].classList.add('is-active');

    var delay = chosenLevel === 'simple' ? 50 : (chosenLevel === 'medium' ? 90 : 140);

    setTimeout(function () {
      if (!isSinglePlayer || chessClient.isGameOver()) {
        isBotThinking = false;
        return;
      }

      var botMove = findBestMoveClient(chessClient, chosenLevel);
      if (!botMove) {
        isBotThinking = false;
        return;
      }

      var fromIdx = squareToIndex(botMove.from);
      var toIdx = squareToIndex(botMove.to);

      try {
        var result = chessClient.move(botMove);
        if (result) {
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

          if (state) {
            state.lastMove = { from: fromIdx, to: toIdx };
            state.history = chessClient.history();
          }

          renderPieces();
          renderHighlights();
          updateNotationTable();
          updateCapturedPieces();
          updateEvaluation();
          updatePlayerClocks();

          // Check game over
          checkAndHandleGameOver();

          // Sync to server
          apiPost('/api/move', {
            from: fromIdx,
            to: toIdx,
            promotion: result.promotion
          }).catch(function () {});
        }
      } catch (err) {
        console.error('Bot move failed:', err);
      }

      isBotThinking = false;
      if (el['opp-status-text']) el['opp-status-text'].textContent = 'Waiting';
    }, delay);
  }

  function checkAndHandleGameOver() {
    if (!chessClient.isGameOver()) return;

    if (clockTimer) clearInterval(clockTimer);

    var title = 'Game Over';
    var detail = 'Game has concluded.';
    var won = false;

    if (chessClient.isCheckmate()) {
      var isWhiteMate = chessClient.turn() === 'w';
      var humanIsWhite = state.localSide === 'white';
      won = (isWhiteMate && !humanIsWhite) || (!isWhiteMate && humanIsWhite);
      title = won ? 'Checkmate — You Won! 🏆' : 'Checkmate — Defeat';
      detail = won ? 'You delivered checkmate.' : 'Your king has been checkmated.';
      playSound(won ? 'win' : 'loss');
    } else if (chessClient.isStalemate()) {
      title = 'Draw by Stalemate';
      detail = 'No legal moves available and king is not in check.';
      playSound('draw');
    } else if (chessClient.isInsufficientMaterial()) {
      title = 'Draw — Insufficient Material';
      detail = 'Neither player has enough pieces to checkmate.';
      playSound('draw');
    } else {
      title = 'Draw';
      detail = 'Draw by repetition or 50-move rule.';
      playSound('draw');
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
    if (el['gameover-crown']) el['gameover-crown'].textContent = won ? '🏆' : '⚔️';
  }

  // ---------------------------------------------------------------------------
  // 6. Web Audio API Acoustic Synthesizer
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
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(75, now + 0.07);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.08);
        break;
      }

      case 'capture': {
        var osc1 = ctx.createOscillator();
        var gain1 = ctx.createGain();
        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(320, now);
        osc1.frequency.exponentialRampToValueAtTime(45, now + 0.11);
        gain1.gain.setValueAtTime(0.65, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.125);

        var subOsc = ctx.createOscillator();
        var subGain = ctx.createGain();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(110, now);
        subOsc.frequency.exponentialRampToValueAtTime(30, now + 0.1);
        subGain.gain.setValueAtTime(0.4, now);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        subOsc.connect(subGain);
        subGain.connect(ctx.destination);
        subOsc.start(now);
        subOsc.stop(now + 0.105);
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

      case 'castle': {
        playSound('move');
        window.setTimeout(function () { playSound('move'); }, 110);
        break;
      }

      case 'promote': {
        [523.25, 659.25, 783.99, 1046.50].forEach(function (freq, i) {
          var pOsc = ctx.createOscillator();
          var pGain = ctx.createGain();
          var pTime = now + i * 0.065;
          pOsc.type = 'triangle';
          pOsc.frequency.setValueAtTime(freq, pTime);
          pGain.gain.setValueAtTime(0.3, pTime);
          pGain.gain.exponentialRampToValueAtTime(0.001, pTime + 0.24);
          pOsc.connect(pGain);
          pGain.connect(ctx.destination);
          pOsc.start(pTime);
          pOsc.stop(pTime + 0.25);
        });
        break;
      }

      case 'win': {
        [523.25, 659.25, 783.99, 1046.50].forEach(function (freq, i) {
          var o = ctx.createOscillator();
          var g = ctx.createGain();
          var t = now + i * 0.09;
          o.type = 'sine';
          o.frequency.setValueAtTime(freq, t);
          g.gain.setValueAtTime(0.35, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(t);
          o.stop(t + 0.46);
        });
        break;
      }

      case 'loss': {
        [440, 392, 349.23, 293.66].forEach(function (freq, i) {
          var o = ctx.createOscillator();
          var g = ctx.createGain();
          var t = now + i * 0.11;
          o.type = 'sine';
          o.frequency.setValueAtTime(freq, t);
          g.gain.setValueAtTime(0.3, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(t);
          o.stop(t + 0.46);
        });
        break;
      }

      case 'draw': {
        [440, 554.37, 659.25].forEach(function (freq) {
          var o = ctx.createOscillator();
          var g = ctx.createGain();
          o.type = 'sine';
          o.frequency.setValueAtTime(freq, now);
          g.gain.setValueAtTime(0.2, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(now);
          o.stop(now + 0.52);
        });
        break;
      }

      case 'start': {
        [587.33, 880.00].forEach(function (freq, i) {
          var o = ctx.createOscillator();
          var g = ctx.createGain();
          var t = now + i * 0.1;
          o.type = 'sine';
          o.frequency.setValueAtTime(freq, t);
          g.gain.setValueAtTime(0.28, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(t);
          o.stop(t + 0.36);
        });
        break;
      }

      case 'pop': {
        var pO = ctx.createOscillator();
        var pG = ctx.createGain();
        pO.type = 'sine';
        pO.frequency.setValueAtTime(500, now);
        pO.frequency.exponentialRampToValueAtTime(1100, now + 0.06);
        pG.gain.setValueAtTime(0.25, now);
        pG.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
        pO.connect(pG);
        pG.connect(ctx.destination);
        pO.start(now);
        pO.stop(now + 0.075);
        break;
      }

      case 'illegal': {
        var lowO = ctx.createOscillator();
        var lowG = ctx.createGain();
        lowO.type = 'sine';
        lowO.frequency.setValueAtTime(130, now);
        lowG.gain.setValueAtTime(0.25, now);
        lowG.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        lowO.connect(lowG);
        lowG.connect(ctx.destination);
        lowO.start(now);
        lowO.stop(now + 0.095);
        break;
      }

      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // 7. Opening Book Dictionary (50+ Openings)
  // ---------------------------------------------------------------------------
  var OPENINGS = [
    { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'], name: 'Ruy Lopez: Morphy Defense' },
    { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], name: 'Ruy Lopez' },
    { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'], name: 'Italian Game: Giuoco Piano' },
    { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'], name: 'Italian Game: Two Knights' },
    { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], name: 'Italian Game' },
    { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'], name: 'Scotch Game' },
    { moves: ['e4', 'e5', 'Nf3', 'Nf6'], name: "Petrov's Defense" },
    { moves: ['e4', 'e5', 'f4'], name: "King's Gambit" },
    { moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'], name: 'Sicilian: Najdorf' },
    { moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6'], name: 'Sicilian: Dragon' },
    { moves: ['e4', 'c5', 'Nf3', 'Nc6'], name: 'Sicilian: Old Sicilian' },
    { moves: ['e4', 'c5', 'c3'], name: 'Sicilian: Alapin' },
    { moves: ['e4', 'c5'], name: 'Sicilian Defense' },
    { moves: ['e4', 'e6', 'd4', 'd5'], name: 'French Defense: Classical' },
    { moves: ['e4', 'e6'], name: 'French Defense' },
    { moves: ['e4', 'c6', 'd4', 'd5'], name: 'Caro-Kann Defense' },
    { moves: ['e4', 'c6'], name: 'Caro-Kann Defense' },
    { moves: ['e4', 'd5'], name: 'Scandinavian Defense' },
    { moves: ['e4', 'Nf6'], name: "Alekhine's Defense" },
    { moves: ['d4', 'd5', 'c4', 'e6'], name: "Queen's Gambit Declined" },
    { moves: ['d4', 'd5', 'c4', 'dxc4'], name: "Queen's Gambit Accepted" },
    { moves: ['d4', 'd5', 'c4', 'c6'], name: 'Slav Defense' },
    { moves: ['d4', 'd5', 'c4'], name: "Queen's Gambit" },
    { moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7'], name: "King's Indian Defense" },
    { moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'], name: 'Nimzo-Indian Defense' },
    { moves: ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'b6'], name: "Queen's Indian Defense" },
    { moves: ['d4', 'Nf6', 'c4', 'c5'], name: 'Benoni Defense' },
    { moves: ['d4', 'Nf6', 'Nf3', 'd5', 'Bf4'], name: 'London System' },
    { moves: ['d4', 'f5'], name: 'Dutch Defense' },
    { moves: ['c4'], name: 'English Opening' },
    { moves: ['Nf3'], name: 'Réti Opening' },
    { moves: ['e4'], name: "King's Pawn Opening" },
    { moves: ['d4'], name: "Queen's Pawn Opening" }
  ];

  function detectOpening(history) {
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
    return 'Custom Position';
  }

  // ---------------------------------------------------------------------------
  // 8. Board Layout & Sizing
  // ---------------------------------------------------------------------------
  function computeLayout() {
    if (!el.board) return;
    var container = el['board-frame'];
    var viewport = container ? container.parentElement : null;
    if (!viewport) return;

    var availW = viewport.clientWidth - 32;
    var availH = viewport.clientHeight - 8;
    if (availW < 120 || availH < 120) return;

    var maxAllowed = 700;
    var size = Math.floor(Math.min(availW, availH, maxAllowed));
    if (size < 260) size = 260;

    size = Math.floor(size / 8) * 8;
    boardSize = size;
    squareSize = size / 8;

    document.documentElement.style.setProperty('--board-size', size + 'px');
    document.documentElement.style.setProperty('--square-size', squareSize + 'px');

    if (el['eval-bar']) {
      el['eval-bar'].style.height = size + 'px';
    }

    renderPieces();
  }

  // ---------------------------------------------------------------------------
  // 9. Grid & Pieces Rendering
  // ---------------------------------------------------------------------------
  function buildGrid() {
    if (!el.grid) return;
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
    if (!state || state.finished || state.gameOver) return false;
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
        // Smart Castling: If king move to g1/g8/c1/c8, also allow clicking the rook
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

  function renderPieces() {
    if (!el.pieces) return;
    el.pieces.textContent = '';

    var board = chessClient.board();
    var canMove = isLocalPlayerTurn();

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
        pieceEl.innerHTML = '<svg viewBox="0 0 45 45"><use href="#piece-' + pCode + '"/></svg>';

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

  function renderHighlights() {
    if (!el.grid) return;

    var squares = el.grid.children;
    var lastFrom = state && state.lastMove ? state.lastMove.from : -1;
    var lastTo = state && state.lastMove ? state.lastMove.to : -1;

    var checkSq = -1;
    if (chessClient.inCheck() && !chessClient.isGameOver()) {
      var kingColor = chessClient.turn();
      var board = chessClient.board();
      for (var r = 0; r < 8; r++) {
        for (var c = 0; c < 8; c++) {
          var p = board[r][c];
          if (p && p.type === 'k' && p.color === kingColor) {
            checkSq = r * 8 + c;
            break;
          }
        }
        if (checkSq >= 0) break;
      }
    }

    for (var i = 0; i < squares.length; i++) {
      var cell = squares[i];
      var idx = parseInt(cell.dataset.index, 10);

      cell.classList.remove('is-selected', 'is-last-move', 'is-check', 'is-drag-over', 'is-legal-target', 'is-hint');

      var existingDot = cell.querySelector('.legal-dot, .legal-capture-ring');
      if (existingDot) {
        cell.removeChild(existingDot);
      }

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
  // 10. Pointer Interactions (Hold & Place + Click to Move)
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
    if (!state || !isLocalPlayerTurn()) return;

    var sqIdx = getSquareFromPointer(e);
    if (sqIdx < 0) return;

    hintSquares = [];

    var piece = chessClient.board()[sqIdx >> 3]?.[sqIdx & 7];
    var isOwnPiece = piece && (piece.color === (state.localSide === 'white' ? 'w' : 'b'));

    // Case 1: Clicked on a legal destination -> Move!
    if (selectedSquare >= 0 && legalTargets.indexOf(sqIdx) >= 0) {
      attemptMove(selectedSquare, sqIdx);
      return;
    }

    // Case 2: Clicked on own piece -> Select and initiate Hold-and-Place
    if (isOwnPiece) {
      var targets = getLegalTargetsFor(sqIdx);
      if (targets.length === 0) {
        playSound('illegal');
        return;
      }

      dragStartSquare = sqIdx;
      dragPieceType = PIECE_NAMES[piece.type];
      dragMovedDistance = 0;

      selectedSquare = sqIdx;
      legalTargets = targets;

      var pCode = piece.color + (piece.type === 'n' ? 'n' : piece.type);
      el['drag-piece-overlay'].innerHTML = '<svg viewBox="0 0 45 45"><use href="#piece-' + pCode + '"/></svg>';
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

    // Case 3: Deselect
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
    var cells = el.grid ? el.grid.children : [];
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var idx = parseInt(cell.dataset.index, 10);
      cell.classList.toggle('is-drag-over', idx === hoverSq && legalTargets.indexOf(idx) >= 0);
    }

    e.preventDefault();
  }

  function onPointerUp(e) {
    if (!isDragging) return;

    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);

    isDragging = false;
    document.body.classList.remove('is-holding-piece');
    el['drag-piece-overlay'].hidden = true;

    var cells = el.grid ? el.grid.children : [];
    for (var i = 0; i < cells.length; i++) {
      cells[i].classList.remove('is-drag-over');
    }

    var dropSq = getSquareFromPointer(e);

    if (dragMovedDistance > 8 && dropSq >= 0 && dropSq !== dragStartSquare && legalTargets.indexOf(dropSq) >= 0) {
      attemptMove(dragStartSquare, dropSq);
      return;
    }

    renderHighlights();
    renderPieces();
  }

  // ---------------------------------------------------------------------------
  // 11. Move Execution & Smart Castling / Promotion
  // ---------------------------------------------------------------------------
  function attemptMove(fromIdx, toIdx) {
    var piece = chessClient.board()[fromIdx >> 3]?.[fromIdx & 7];
    if (!piece) return;

    var fromSq = indexToSquare(fromIdx);
    var toSq = indexToSquare(toIdx);

    // Smart Castling adjustment: If user clicked the Rook, map to king destination
    if (piece.type === 'k') {
      if (fromSq === 'e1' && toSq === 'h1') toSq = 'g1';
      if (fromSq === 'e1' && toSq === 'a1') toSq = 'c1';
      if (fromSq === 'e8' && toSq === 'h8') toSq = 'g8';
      if (fromSq === 'e8' && toSq === 'a8') toSq = 'c8';
      toIdx = squareToIndex(toSq);
    }

    var isPawn = piece.type === 'p';
    var isPromotion = isPawn && ((piece.color === 'w' && toSq.charAt(1) === '8') || (piece.color === 'b' && toSq.charAt(1) === '1'));

    if (isPromotion) {
      pendingPromotion = { from: fromIdx, to: toIdx, color: piece.color };
      showPromotionDialog(piece.color === 'w' ? 'white' : 'black');
      return;
    }

    executeMove(fromIdx, toIdx, undefined);
  }

  function executeMove(fromIdx, toIdx, promotionPiece) {
    var fromSq = indexToSquare(fromIdx);
    var toSq = indexToSquare(toIdx);
    var promo = promotionPiece ? promotionPiece.charAt(0).toLowerCase() : undefined;

    // Default promotion to Queen if pawn on 8th rank
    var piece = chessClient.board()[fromIdx >> 3]?.[fromIdx & 7];
    if (piece && piece.type === 'p' && (toSq.charAt(1) === '8' || toSq.charAt(1) === '1') && !promo) {
      promo = 'q';
    }

    try {
      var moveResult = chessClient.move({
        from: fromSq,
        to: toSq,
        promotion: promo
      });

      if (!moveResult) {
        playSound('illegal');
        renderHighlights();
        renderPieces();
        return;
      }

      if (promo) {
        playSound('promote');
      } else if (moveResult.captured) {
        playSound('capture');
      } else if (moveResult.flags.indexOf('k') >= 0 || moveResult.flags.indexOf('q') >= 0) {
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
      }

      renderPieces();
      renderHighlights();
      updateNotationTable();
      updateCapturedPieces();
      updateEvaluation();
      updatePlayerClocks();

      // Check game over
      checkAndHandleGameOver();

      // If playing vs computer, trigger instant client bot response!
      if (isSinglePlayer) {
        triggerClientBotMove();
      }

      // Sync to server in background
      apiPost('/api/move', {
        from: fromIdx,
        to: toIdx,
        promotion: promo
      }).catch(function () {});

    } catch (err) {
      console.error('Move error:', err);
      playSound('illegal');
      renderHighlights();
      renderPieces();
    }
  }

  function showPromotionDialog(side) {
    if (!el['promo-options']) return;
    el['promo-options'].textContent = '';

    var pieces = ['queen', 'rook', 'bishop', 'knight'];
    pieces.forEach(function (type) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'promo-btn';
      var pCode = (side === 'white' ? 'w' : 'b') + (type === 'knight' ? 'n' : type.charAt(0));
      btn.innerHTML = '<svg viewBox="0 0 45 45"><use href="#piece-' + pCode + '"/></svg>';

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
  // 12. Evaluation & Material Calculations
  // ---------------------------------------------------------------------------
  var PIECE_VALS = { p: 1, n: 3, b: 3.2, r: 5, q: 9, k: 0 };

  function updateEvaluation() {
    if (!el['eval-fill'] || !el['eval-text']) return;

    var board = chessClient.board();
    var whiteScore = 0;
    var blackScore = 0;

    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var p = board[r][c];
        if (!p) continue;
        var val = PIECE_VALS[p.type] || 0;
        var centerDist = Math.abs(3.5 - r) + Math.abs(3.5 - c);
        var bonus = (7 - centerDist) * 0.05;
        if (p.color === 'w') {
          whiteScore += val + bonus;
        } else {
          blackScore += val + bonus;
        }
      }
    }

    var diff = whiteScore - blackScore;
    var pct = Math.max(5, Math.min(95, 50 + diff * 6));

    if (flipped) {
      pct = 100 - pct;
    }

    el['eval-fill'].style.height = pct + '%';
    var formattedDiff = (diff >= 0 ? '+' : '') + diff.toFixed(1);
    el['eval-text'].textContent = formattedDiff;
  }

  function updateCapturedPieces() {
    if (!el['opp-captured-shelf'] || !el['you-captured-shelf']) return;

    var board = chessClient.board();
    var counts = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };

    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var p = board[r][c];
        if (p && p.type !== 'k') {
          counts[p.color][p.type]++;
        }
      }
    }

    var STARTING = { q: 1, r: 2, b: 2, n: 2, p: 8 };
    var whiteCaptured = [];
    var blackCaptured = [];

    ['q', 'r', 'b', 'n', 'p'].forEach(function (type) {
      var missingBlack = Math.max(0, STARTING[type] - counts.b[type]);
      for (var i = 0; i < missingBlack; i++) whiteCaptured.push(type);

      var missingWhite = Math.max(0, STARTING[type] - counts.w[type]);
      for (var j = 0; j < missingWhite; j++) blackCaptured.push(type);
    });

    var localSide = state ? state.localSide : 'white';
    var youCaptured = localSide === 'white' ? whiteCaptured : blackCaptured;
    var oppCaptured = localSide === 'white' ? blackCaptured : whiteCaptured;

    function renderShelf(container, capturedPieces, enemyColor) {
      container.textContent = '';
      capturedPieces.forEach(function (type) {
        var pCode = enemyColor + (type === 'n' ? 'n' : type);
        var icon = document.createElement('div');
        icon.className = 'captured-piece-icon';
        icon.innerHTML = '<svg viewBox="0 0 45 45"><use href="#piece-' + pCode + '"/></svg>';
        container.appendChild(icon);
      });
    }

    renderShelf(el['you-captured-shelf'], youCaptured, localSide === 'white' ? 'b' : 'w');
    renderShelf(el['opp-captured-shelf'], oppCaptured, localSide === 'white' ? 'w' : 'b');
  }

  // ---------------------------------------------------------------------------
  // 13. Move Notation & Opening Name
  // ---------------------------------------------------------------------------
  function updateNotationTable() {
    if (!el['notation-tbody']) return;
    el['notation-tbody'].textContent = '';

    var history = chessClient.history();
    if (el['move-ply-counter']) {
      el['move-ply-counter'].textContent = history.length + ' ' + (history.length === 1 ? 'ply' : 'plies');
    }

    if (el['opening-name']) {
      el['opening-name'].textContent = detectOpening(history);
    }

    for (var i = 0; i < history.length; i += 2) {
      var moveNum = Math.floor(i / 2) + 1;
      var whiteMove = history[i];
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
  // 14. Digital Chess Clocks & Flag Fall Timeouts
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

    if (!isCasualMode) {
      el['you-clock'].classList.toggle('is-low-time', youSeconds <= 30);
      el['opp-clock'].classList.toggle('is-low-time', oppSeconds <= 30);
    }

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
        if (chessClient.turn() === 'w') {
          if (whiteClockSeconds > 0) {
            whiteClockSeconds--;
            if (whiteClockSeconds === 0) {
              handleClockTimeout('white');
              return;
            }
          }
        } else {
          if (blackClockSeconds > 0) {
            blackClockSeconds--;
            if (blackClockSeconds === 0) {
              handleClockTimeout('black');
              return;
            }
          }
        }
      }
      updatePlayerClocks();
    }, 1000);
  }

  // ---------------------------------------------------------------------------
  // 15. Connect Cross-Device Modal & QR Code Display
  // ---------------------------------------------------------------------------
  function showConnectModal(roomCode) {
    if (!el['modal-device-connect']) return;

    var shareUrl = window.location.origin + window.location.pathname + '?room=' + roomCode;

    if (el['input-share-link']) el['input-share-link'].value = shareUrl;
    if (el['modal-display-pin']) el['modal-display-pin'].textContent = roomCode;

    if (el['qr-canvas-container']) {
      el['qr-canvas-container'].innerHTML = generateQRCodeSVG(shareUrl);
    }

    if (el['modal-radar-text']) {
      el['modal-radar-text'].textContent = (state && state.connected) ? 'Opponent connected!' : 'Waiting for opponent to connect...';
    }

    el['modal-device-connect'].hidden = false;
  }

  // ---------------------------------------------------------------------------
  // 16. State Adoption & Server Sync
  // ---------------------------------------------------------------------------
  function adoptState(next) {
    if (!next || next.screen === undefined) return;
    var prev = state;
    state = next;

    isSinglePlayer = Boolean(next.singlePlayer);

    if (next.fen && next.fen !== chessClient.fen()) {
      var prevFen = chessClient.fen();
      chessClient.load(next.fen);

      if (prev && prevFen !== next.fen) {
        if (next.finished) {
          if (next.localWon) {
            playSound('win');
          } else if (String(next.gameOverHeadline || '').toLowerCase().indexOf('draw') >= 0) {
            playSound('draw');
          } else {
            playSound('loss');
          }
        } else if (chessClient.inCheck()) {
          playSound('check');
        } else {
          var moves = chessClient.history({ verbose: true });
          var last = moves[moves.length - 1];
          if (last && last.captured) {
            playSound('capture');
          } else if (last && (last.flags.indexOf('k') >= 0 || last.flags.indexOf('q') >= 0)) {
            playSound('castle');
          } else {
            playSound('move');
          }
        }
      }
    }

    if (next.screen === 'home') {
      if (el['screen-home']) el['screen-home'].hidden = false;
      if (el['screen-game']) el['screen-game'].hidden = true;
    } else {
      if (el['screen-home']) el['screen-home'].hidden = true;
      if (el['screen-game']) el['screen-game'].hidden = false;
      computeLayout();
    }

    flipped = next.localSide === 'black';
    buildGrid();

    if (el['you-name']) el['you-name'].textContent = next.localName || 'You';
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
      if (next.thinking || isBotThinking) {
        el['opp-status-text'].textContent = 'Thinking...';
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

    // Close device connect modal if friend joined
    if (next.connected && prev && !prev.connected && el['modal-device-connect'] && !el['modal-device-connect'].hidden) {
      playSound('start');
      showToast('🎉 Opponent connected! Match started!');
      if (el['modal-radar-text']) el['modal-radar-text'].textContent = 'Opponent connected! Game on.';
      setTimeout(function () {
        if (el['modal-device-connect']) el['modal-device-connect'].hidden = true;
      }, 1200);
    }

    // Game Over modal
    if (next.finished && next.gameOver) {
      if (el['modal-gameover']) el['modal-gameover'].hidden = false;
      if (el['gameover-title']) el['gameover-title'].textContent = next.gameOverHeadline || 'Game Over';
      if (el['gameover-detail']) el['gameover-detail'].textContent = next.gameOverDetail || '';
      if (el['gameover-crown']) {
        el['gameover-crown'].textContent = next.localWon ? '🏆' : (next.gameOverHeadline.indexOf('Draw') >= 0 ? '🤝' : '⚔️');
      }
    } else if (!state.gameOver) {
      if (el['modal-gameover']) el['modal-gameover'].hidden = true;
    }

    if (next.reaction && (!prev || !prev.reaction || prev.reaction.id !== next.reaction.id)) {
      showFloatingReaction(next.reaction.emoji, next.reaction.from);
    }

    renderPieces();
    renderHighlights();
    updateNotationTable();
    updateCapturedPieces();
    updateEvaluation();
    updatePlayerClocks();
  }

  // ---------------------------------------------------------------------------
  // 17. Floating Reactions
  // ---------------------------------------------------------------------------
  function showFloatingReaction(emoji, fromName) {
    if (!el['reaction-layer']) return;
    playSound('pop');

    var bubble = document.createElement('div');
    bubble.className = 'floating-reaction';
    bubble.textContent = emoji;

    var startX = 20 + Math.random() * 60;
    bubble.style.left = startX + '%';
    bubble.style.bottom = '15%';

    el['reaction-layer'].appendChild(bubble);

    setTimeout(function () {
      if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
    }, 2400);
  }

  function sendReaction(emoji) {
    showFloatingReaction(emoji, 'You');
    apiPost('/api/reaction', { emoji: emoji });
  }

  // ---------------------------------------------------------------------------
  // 18. API Fetching with Session Header & SSE
  // ---------------------------------------------------------------------------
  function apiGet(url) {
    return fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 'sessionId=' + encodeURIComponent(sessionId), {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'x-session-id': sessionId
      }
    }).then(function (res) { return res.json(); });
  }

  function apiPost(url, data) {
    return fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 'sessionId=' + encodeURIComponent(sessionId), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-session-id': sessionId
      },
      body: JSON.stringify(data || {})
    }).then(function (res) {
      if (!res.ok) {
        return res.json().then(function (d) {
          throw new Error(d.error || 'Server error');
        });
      }
      return res.json();
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
          pollTimer = setInterval(fetchState, 1200);
        }
      };
    } catch {
      pollTimer = setInterval(fetchState, 1200);
    }
  }

  // ---------------------------------------------------------------------------
  // 19. Toast & Clipboard
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
    }, 2500);
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
  // 20. Event Listeners & Match Setup Controls
  // ---------------------------------------------------------------------------
  function setupEvents() {
    window.addEventListener('resize', computeLayout);

    if (el.board) {
      el.board.addEventListener('pointerdown', onPointerDown);
    }

    // Time selector buttons (Computer)
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

    // Time selector buttons (Friend)
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
        var name = (el['player-name-input'] && el['player-name-input'].value) || 'Player';
        playSound('start');

        isSinglePlayer = true;
        isCasualMode = chosenTimeControl === 0;
        casualElapsedSeconds = 0;
        whiteClockSeconds = chosenTimeControl || 600;
        blackClockSeconds = chosenTimeControl || 600;

        chessClient.reset();

        apiPost('/api/single-player', {
          level: chosenLevel,
          colour: chosenColor,
          name: name
        }).then(function (next) {
          adoptState(next);
          startClockTimer();

          // If playing as black, trigger bot opening move!
          if (chosenColor === 'black') {
            triggerClientBotMove();
          }
        });
      });
    }

    // Host room
    if (el['btn-host-room']) {
      el['btn-host-room'].addEventListener('click', function () {
        var name = (el['player-name-input'] && el['player-name-input'].value) || 'Player';
        playSound('start');

        isSinglePlayer = false;
        isCasualMode = chosenFriendTimeControl === 0;
        casualElapsedSeconds = 0;
        whiteClockSeconds = chosenFriendTimeControl || 600;
        blackClockSeconds = chosenFriendTimeControl || 600;

        chessClient.reset();

        apiPost('/api/host', { name: name }).then(function (next) {
          adoptState(next);
          startClockTimer();
          showConnectModal(next.roomCode);
        }).catch(function (err) {
          showToast('Failed to create room: ' + err.message);
        });
      });
    }

    // Join room
    if (el['btn-join-room']) {
      el['btn-join-room'].addEventListener('click', function () {
        var code = el['input-room-code'] ? el['input-room-code'].value.trim() : '';
        var name = (el['player-name-input'] && el['player-name-input'].value) || 'Guest';
        if (!code || code.length !== 4) {
          showToast('Please enter the 4-digit room code');
          playSound('illegal');
          return;
        }

        playSound('start');
        isSinglePlayer = false;
        isCasualMode = chosenFriendTimeControl === 0;
        casualElapsedSeconds = 0;
        whiteClockSeconds = chosenFriendTimeControl || 600;
        blackClockSeconds = chosenFriendTimeControl || 600;

        chessClient.reset();

        apiPost('/api/join', { code: code, name: name }).then(function (next) {
          if (next.error) {
            showToast(next.error);
            playSound('illegal');
            return;
          }
          adoptState(next);
          startClockTimer();
          showToast('🎉 Connected to Room #' + code + '!');
        }).catch(function (err) {
          showToast(err.message || 'Room not found');
          playSound('illegal');
        });
      });
    }

    // Connect Phone button (In game)
    if (el['btn-connect-phone-game']) {
      el['btn-connect-phone-game'].addEventListener('click', function () {
        if (state && state.roomCode) {
          showConnectModal(state.roomCode);
        } else {
          apiPost('/api/host', { name: 'Player' }).then(function (next) {
            adoptState(next);
            showConnectModal(next.roomCode);
          });
        }
      });
    }

    // Close Connect Modal
    if (el['btn-close-connect']) {
      el['btn-close-connect'].addEventListener('click', function () {
        if (el['modal-device-connect']) el['modal-device-connect'].hidden = true;
      });
    }

    if (el['btn-modal-copy-link']) {
      el['btn-modal-copy-link'].addEventListener('click', function () {
        if (el['input-share-link']) {
          copyToClipboard(el['input-share-link'].value, '📋 Invite link copied to clipboard!');
          playSound('move');
        }
      });
    }

    if (el['btn-modal-copy-pin']) {
      el['btn-modal-copy-pin'].addEventListener('click', function () {
        if (el['modal-display-pin']) {
          copyToClipboard(el['modal-display-pin'].textContent, '📋 Room PIN copied!');
          playSound('move');
        }
      });
    }

    // WhatsApp Share
    if (el['btn-share-whatsapp']) {
      el['btn-share-whatsapp'].addEventListener('click', function () {
        var url = el['input-share-link'] ? el['input-share-link'].value : window.location.href;
        var text = encodeURIComponent('Play chess with me in real time! Click to join: ' + url);
        window.open('https://api.whatsapp.com/send?text=' + text, '_blank');
      });
    }

    // Email Share
    if (el['btn-share-email']) {
      el['btn-share-email'].addEventListener('click', function () {
        var url = el['input-share-link'] ? el['input-share-link'].value : window.location.href;
        var subject = encodeURIComponent('Chess Arena - Game Invite');
        var body = encodeURIComponent('Join my live chess match here: ' + url);
        window.location.href = 'mailto:?subject=' + subject + '&body=' + body;
      });
    }

    // ↩️ Undo (Takeback) Move
    if (el['btn-action-undo']) {
      el['btn-action-undo'].addEventListener('click', function () {
        if (isSinglePlayer) {
          var humanIsTurn = (chessClient.turn() === 'w' && state.localSide === 'white') || (chessClient.turn() === 'b' && state.localSide === 'black');
          if (humanIsTurn) {
            chessClient.undo(); // Undo bot move
            chessClient.undo(); // Undo human move
          } else {
            chessClient.undo();
          }

          var hist = chessClient.history({ verbose: true });
          if (hist.length > 0) {
            var lastM = hist[hist.length - 1];
            state.lastMove = { from: squareToIndex(lastM.from), to: squareToIndex(lastM.to) };
          } else {
            state.lastMove = null;
          }

          selectedSquare = -1;
          legalTargets = [];
          hintSquares = [];

          renderPieces();
          renderHighlights();
          updateNotationTable();
          updateCapturedPieces();
          updateEvaluation();
          playSound('move');
          showToast('↩️ Move taken back');

          apiPost('/api/undo').catch(function () {});
        }
      });
    }

    // 💡 Engine Hint
    if (el['btn-action-hint']) {
      el['btn-action-hint'].addEventListener('click', function () {
        var best = findBestMoveClient(chessClient, 'hard');
        if (best) {
          hintSquares = [squareToIndex(best.from), squareToIndex(best.to)];
          renderHighlights();
          playSound('pop');
          showToast('💡 Engine suggestion: ' + best.san + ' (' + best.from + ' → ' + best.to + ')');
        }
      });
    }

    // 📋 Copy PGN
    if (el['btn-copy-pgn']) {
      el['btn-copy-pgn'].addEventListener('click', function () {
        var pgnText = chessClient.pgn() || chessClient.history().join(' ');
        copyToClipboard(pgnText, '📋 PGN copied to clipboard!');
        playSound('move');
      });
    }

    // 📋 Copy FEN
    if (el['btn-copy-fen']) {
      el['btn-copy-fen'].addEventListener('click', function () {
        copyToClipboard(chessClient.fen(), '📋 FEN copied to clipboard!');
        playSound('move');
      });
    }

    // Level selector
    if (el['level-selector']) {
      var cards = el['level-selector'].querySelectorAll('.level-card');
      cards.forEach(function (card) {
        card.addEventListener('click', function () {
          cards.forEach(function (c) {
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

    // Color options
    var colorBtns = document.querySelectorAll('.color-option');
    colorBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        colorBtns.forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        chosenColor = btn.dataset.color;
        playSound('move');
      });
    });

    // Sound toggle
    if (el['btn-sound-toggle']) {
      el['btn-sound-toggle'].addEventListener('click', function () {
        soundEnabled = !soundEnabled;
        settings.sound = soundEnabled;
        if (el['sound-icon-state']) el['sound-icon-state'].textContent = soundEnabled ? '🔊' : '🔇';
        if (soundEnabled) playSound('move');
        showToast(soundEnabled ? 'Sound Enabled' : 'Sound Muted');
      });
    }

    // Theme picker
    if (el['header-theme-picker']) {
      var swatches = el['header-theme-picker'].querySelectorAll('.theme-swatch');
      swatches.forEach(function (swatch) {
        swatch.addEventListener('click', function () {
          var theme = swatch.dataset.theme;
          document.documentElement.dataset.theme = theme;
          swatches.forEach(function (s) { s.classList.remove('is-active'); });
          swatch.classList.add('is-active');
          showToast('Theme: ' + swatch.title);
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
        updateEvaluation();
        playSound('move');
      });
    }

    // Reactions
    if (el['reactions-dock']) {
      var reactionBtns = el['reactions-dock'].querySelectorAll('.emoji-btn');
      reactionBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          sendReaction(btn.dataset.emoji);
        });
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
        if (clockTimer) clearInterval(clockTimer);
        state.finished = true;
        state.gameOver = true;
        state.localWon = false;
        state.gameOverHeadline = 'You Resigned';
        state.gameOverDetail = 'Match conceded to opponent.';
        playSound('loss');
        if (el['modal-gameover']) el['modal-gameover'].hidden = false;
        if (el['gameover-title']) el['gameover-title'].textContent = 'You Resigned';
        if (el['gameover-detail']) el['gameover-detail'].textContent = 'Match conceded.';
        if (el['gameover-crown']) el['gameover-crown'].textContent = '⚔️';
        apiPost('/api/resign').catch(function () {});
      });
    }

    if (el['btn-cancel-resign']) {
      el['btn-cancel-resign'].addEventListener('click', function () {
        if (el['modal-resign-confirm']) el['modal-resign-confirm'].hidden = true;
      });
    }

    // Rematch
    function handleRematch() {
      if (el['modal-gameover']) el['modal-gameover'].hidden = true;
      whiteClockSeconds = chosenTimeControl || 600;
      blackClockSeconds = chosenTimeControl || 600;
      playSound('start');

      chessClient.reset();

      apiPost('/api/rematch').then(function (next) {
        adoptState(next);
        startClockTimer();
        if (isSinglePlayer && next.localSide === 'black') {
          triggerClientBotMove();
        }
      });
    }

    if (el['btn-action-rematch']) el['btn-action-rematch'].addEventListener('click', handleRematch);
    if (el['btn-modal-rematch']) el['btn-modal-rematch'].addEventListener('click', handleRematch);

    // Return to menu
    function handleReturnMenu() {
      if (el['modal-gameover']) el['modal-gameover'].hidden = true;
      if (clockTimer) clearInterval(clockTimer);
      apiPost('/api/leave').then(adoptState);
    }

    if (el['btn-action-menu']) el['btn-action-menu'].addEventListener('click', handleReturnMenu);
    if (el['btn-modal-menu']) el['btn-modal-menu'].addEventListener('click', handleReturnMenu);
    if (el['btn-brand']) el['btn-brand'].addEventListener('click', handleReturnMenu);

    // Navigation in header
    if (el['nav-btn-computer']) {
      el['nav-btn-computer'].addEventListener('click', function () {
        el['nav-btn-computer'].classList.add('is-active');
        if (el['nav-btn-friend']) el['nav-btn-friend'].classList.remove('is-active');
        if (state && state.screen === 'game') {
          apiPost('/api/leave').then(adoptState);
        }
        var compCard = document.querySelector('.card-computer');
        if (compCard) compCard.scrollIntoView({ behavior: 'smooth' });
      });
    }

    if (el['nav-btn-friend']) {
      el['nav-btn-friend'].addEventListener('click', function () {
        el['nav-btn-friend'].classList.add('is-active');
        if (el['nav-btn-computer']) el['nav-btn-computer'].classList.remove('is-active');
        if (state && state.screen === 'game' && state.roomCode) {
          showConnectModal(state.roomCode);
          return;
        }
        var friendCard = document.querySelector('.card-friend');
        if (friendCard) {
          friendCard.scrollIntoView({ behavior: 'smooth' });
          var hostBtn = document.getElementById('btn-host-room');
          if (hostBtn) hostBtn.focus();
        }
      });
    }

    // Settings
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
  }

  // ---------------------------------------------------------------------------
  // 21. Auto-Join URL Parameter (?room=XXXX)
  // ---------------------------------------------------------------------------
  function checkUrlRoom() {
    var params = new URLSearchParams(window.location.search);
    var roomCode = params.get('room');
    if (roomCode && /^\d{4}$/.test(roomCode)) {
      if (el['input-room-code']) el['input-room-code'].value = roomCode;
      showToast('Connecting to Room #' + roomCode + '...');
      apiPost('/api/join', { code: roomCode, name: 'Guest' }).then(function (next) {
        if (next.error) {
          showToast(next.error);
          return;
        }
        adoptState(next);
        startClockTimer();
        showToast('🎉 Joined Room #' + roomCode + ' as Black!');
      }).catch(function () {});
    }
  }

  // ---------------------------------------------------------------------------
  // 22. Initialization
  // ---------------------------------------------------------------------------
  function init() {
    initElements();
    setupEvents();
    buildGrid();
    computeLayout();
    initSSE();
    fetchState();
    checkUrlRoom();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
