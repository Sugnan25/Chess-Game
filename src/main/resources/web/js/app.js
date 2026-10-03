/* ==========================================================================
   Chess Game - web side
   The browser draws what the Java side reports and sends back clicks and
   commands. It never decides what is legal.

   Pieces live in their own layer above the grid. When a state arrives, the
   Java side says which pieces changed square, each on-screen piece is matched
   to one of them, and the node is sent to its new square. A piece that was
   taken fades out where it stood. Nothing here guesses: if the backend did not
   list a relocation, no piece is animated across the board.
   ========================================================================== */
(function () {
  'use strict';

  var IDLE_MS = 420;
  var BUSY_MS = 110;
  var QUICK_MS = 170;

  /*
     How long a piece stays flagged as moving, and how long a captured piece
     stays in the document before it is taken out.

     These are read from the stylesheet rather than written out here, because
     taking a node away before its animation has finished does not look like a
     cut-off animation, it looks like a stutter: the element is yanked out on
     the frame the fade was still running. The one number that has to outlive
     the animations is the leave window, which is the delay plus the shrink.
  */
  var MOVE_MS = 300;
  var CAPTURE_MS = 370;
  var moveBase = 240;

  var THEMES = [
    { id: 'ember', name: 'Ember', s1: '#e2a54c', s2: '#cd6f42' },
    { id: 'slate', name: 'Slate', s1: '#71a9dc', s2: '#9a92de' },
    { id: 'forest', name: 'Forest', s1: '#cbab52', s2: '#74b98a' }
  ];

  var GLYPH = {
    white: { king: '\u2654', queen: '\u2655', rook: '\u2656', bishop: '\u2657', knight: '\u2658', pawn: '\u2659' },
    black: { king: '\u265A', queen: '\u265B', rook: '\u265C', bishop: '\u265D', knight: '\u265E', pawn: '\u265F' }
  };

  var PROMOTION = ['queen', 'rook', 'bishop', 'knight'];
  var FULL_SET = { king: 1, queen: 2, rook: 2, bishop: 2, knight: 2, pawn: 8 };
  var PIECE_ORDER = ['queen', 'rook', 'bishop', 'knight', 'pawn'];

  var state = null;
  var levels = [];
  var chosenLevel = 'medium';
  var chosenColour = 'white';
  var busy = false;
  var pendingPromotion = null;
  var promotingSide = 'white';
  var lastError = '';
  var lastPending = '';
  var modalKey = null;
  var toastTimer = null;

  var flipped = false;
  /*
     The board's size and the size of one square. These two are a pair: 0 means
     "not measured yet", and squareSize is only ever derived in layout(). They
     used to start as 560 and 60, which are not a pair at all - 560 is seventy
     squares of 70, not sixty of 60 - so a board that was never re-measured drew
     every piece ten pixels out and two pieces shared a square.
  */
  var boardSize = 0;
  var squareSize = 0;
  var pieces = [];
  var gridKey = '';
  var moveKey = '';
  var historyKey = '';

  var el = {};

  function $(id) { return document.getElementById(id); }

  /* Reads a duration such as "240ms" off the document root as a number. */
  function cssMillis(name, fallback) {
    var raw = window.getComputedStyle(document.documentElement).getPropertyValue(name);
    var value = parseFloat(raw);
    return isFinite(value) ? value : fallback;
  }

  function readTimings() {
    var move = cssMillis('--move-ms', 240);
    var lift = cssMillis('--lift-ms', 240);
    var capture = cssMillis('--capture-ms', 220);
    var delay = cssMillis('--leave-delay', 60);
    moveBase = Math.max(move, lift);
    MOVE_MS = Math.ceil(moveBase) + 20;
    CAPTURE_MS = Math.ceil(capture + delay) + 20;
  }

  function cache() {
    [
      'app', 'screen-home', 'screen-game', 'level-list', 'player-name', 'themes',
      'join-code', 'join-host', 'btn-play-computer', 'btn-host', 'btn-join', 'btn-join-direct', 'btn-menu',
      'gamebar-sub', 'room-badge',
      'board', 'grid', 'pieces', 'board-flash', 'promo', 'promo-choices', 'btn-promo-cancel',
      'opponent-name', 'opponent-state', 'opponent-avatar', 'opponent-captured', 'opponent-dot',
      'local-name', 'local-state', 'local-avatar', 'local-captured', 'local-dot',
      'status-dot', 'status-text', 'status-meta',
      'move-list', 'move-count', 'room-facts', 'facts', 'fact-room', 'fact-address',
      'btn-rematch', 'btn-resign',
      'modal', 'modal-eyebrow', 'modal-title', 'modal-body', 'btn-modal-rematch', 'btn-modal-dismiss',
      'toast',
      'settings', 'settings-themes', 'speed-note', 'volume-wrap', 'volume-out',
      'opt-sound', 'opt-volume', 'opt-dots', 'opt-last', 'opt-coords', 'opt-speed',
      'btn-settings', 'btn-settings-home', 'btn-settings-close', 'btn-settings-done'
    ].forEach(function (id) { el[id] = $(id); });
    el.game = document.querySelector('.game');
    el.shell = document.querySelector('.board-shell');
  }

  // ================================================================== layout

  /* The board is as large as the window allows, then everything is measured
     from it. Returns true when the size actually changed. */
  /*
     Works out how big the board can be, in CSS pixels, writes it to
     --board-size, and derives the size of one square from it. Returns true when
     the board actually changed, so the caller knows to re-place the pieces.

     Two rules keep this honest.

     A measurement that cannot be trusted is thrown away, not clamped. The game
     screen is hidden on the start screen and a hidden element measures zero, so
     reading it there used to hand back the minimum size and the board would open
     far too small. When there is no box, the answer is "not now": nothing is
     written, and the next frame that has a box tries again.

     The square size is only ever set here, immediately after the board size it
     belongs to. There is deliberately no dead band on the comparison. A dead
     band is meant to stop a stray pixel from re-placing the pieces, but a board
     that measures within a few pixels of the size already in the stylesheet is
     precisely the case where squareSize still has to be worked out, and
     skipping it is what leaves the pieces on the wrong grid.
  */
  function layout() {
    var width = el.shell.clientWidth;
    var height = el.shell.clientHeight;
    if (width < 80 || height < 80) {
      return false;
    }
    /* The frame's own padding and border, which sit outside the board. */
    var frame = 24;
    var ceiling = cssMillis('--board-max', 720);
    var size = Math.floor(Math.min(width, height) - frame);
    if (size < 260) {
      size = 260;
    }
    if (size > ceiling) {
      size = ceiling;
    }
    if (size === boardSize) {
      return false;
    }
    boardSize = size;
    squareSize = size / 8;
    document.documentElement.style.setProperty('--board-size', size + 'px');
    return true;
  }

  /*
     Takes the size the stylesheet already asks for as the starting point, so
     the very first frame has a square size that matches the board being drawn
     even if the row cannot be measured yet.
  */
  function adoptStyleSize() {
    var declared = cssMillis('--board-size', 560);
    if (declared > 0) {
      boardSize = declared;
      squareSize = declared / 8;
    }
  }

  /* Re-measure every piece after the board was resized. The pieces are told to
     skip their transition so they land on the new squares at once. */
  function reflow() {
    layout();
    pieces.forEach(function (node) {
      node.el.classList.add('is-still');
      sizePiece(node);
      placePiece(node);
    });
    if (pieces.length) {
      window.requestAnimationFrame(function () {
        pieces.forEach(function (node) { node.el.classList.remove('is-still'); });
      });
    }
  }

  function sizePiece(node) {
    node.el.style.width = squareSize + 'px';
    node.el.style.height = squareSize + 'px';
    node.glyph.style.fontSize = Math.round(squareSize * 0.76) + 'px';
  }

  function placePiece(node) {
    var row = Math.floor(node.square / 8);
    var file = node.square % 8;
    var displayRow = flipped ? 7 - row : row;
    var displayCol = flipped ? 7 - file : file;
    node.el.style.transform =
      'translate3d(' + Math.round(displayCol * squareSize) + 'px,'
      + Math.round(displayRow * squareSize) + 'px,0)';
  }

  // ==================================================================== board

  function buildGrid() {
    var key = flipped ? 'black' : 'white';
    if (key === gridKey) {
      return;
    }
    gridKey = key;
    el.grid.textContent = '';
    var byIndex = indexMap();
    for (var row = 0; row < 8; row++) {
      var engineRow = flipped ? 7 - row : row;
      for (var file = 0; file < 8; file++) {
        /*
           Both ends of the board turn over when the view is flipped, not just
           the ranks. Turning only the ranks left every piece standing on the
           mirror image of the square it belonged on: the a-file pieces were drawn
           on the h-file, so they looked badly out of place and, worse, clicking
           one sent the server the square under the pointer rather than the square
           the piece was really standing on.
        */
        var engineFile = flipped ? 7 - file : file;
        var index = engineRow * 8 + engineFile;
        var square = byIndex[index] || { index: index, file: '?', rank: '?', piece: null };
        var cell = document.createElement('div');
        cell.className = 'square' + (((file + engineRow) % 2 !== 0) ? ' square--dark' : '');
        cell.setAttribute('role', 'gridcell');
        cell.dataset.index = String(index);

        var mark = document.createElement('span');
        mark.className = 'square__mark';
        cell.appendChild(mark);

        var fileLabel = document.createElement('span');
        fileLabel.className = 'square__coord square__coord--file';
        fileLabel.textContent = square.file;
        if (row === 7) {
          cell.appendChild(fileLabel);
        }
        var rankLabel = document.createElement('span');
        rankLabel.className = 'square__coord square__coord--rank';
        rankLabel.textContent = square.rank;
        if (file === 0) {
          cell.appendChild(rankLabel);
        }
        el.grid.appendChild(cell);
      }
    }
  }

  function indexMap() {
    var byIndex = {};
    (state.squares || []).forEach(function (square) { byIndex[square.index] = square; });
    return byIndex;
  }

  /*
   * A piece is three nested elements on purpose. The outer one only ever holds
   * the position, so its transition is a pure translate; the middle one takes
   * the lift scale; the glyph holds the artwork. Because they are separate, a
   * move can be picked up and carried without the lift fighting the travel.
   */
  function makePiece(square, entering) {
    var elPiece = document.createElement('div');
    elPiece.className = 'piece' + (entering ? ' is-entering' : '');
    var lift = document.createElement('span');
    lift.className = 'piece__lift';
    var glyph = document.createElement('span');
    glyph.className = 'piece__glyph piece__glyph--' + square.side;
    glyph.textContent = GLYPH[square.side][square.piece];
    lift.appendChild(glyph);
    elPiece.appendChild(lift);
    el.pieces.appendChild(elPiece);
    var node = {
      el: elPiece,
      lift: lift,
      glyph: glyph,
      side: square.side,
      type: square.piece,
      square: square.index
    };
    sizePiece(node);
    placePiece(node);
    if (entering) {
      window.setTimeout(function () { elPiece.classList.remove('is-entering'); }, CAPTURE_MS);
    }
    return node;
  }

  /*
   A move is not one fixed length.

   Nearly every move on a chessboard is a short one: a pawn steps, a knight hops,
   a castling rook crosses. Giving a pawn's single square and a queen's walk
   across the board the same number of milliseconds is what makes a board feel
   slow, because the long move is the rare one and the short move is left
   sitting on the board long after it should be done. So the travel time follows
   the distance, and only a piece that genuinely crosses the board takes the
   full time the settings ask for.

   Measured on the old fixed timing, a pawn step took 189ms of travel for 79px
   and read as hesitation. This brings the same step to roughly 120ms.
 */
var LONGEST_MOVE = 7;

function travelMillis(from, to) {
    if (from === undefined || to === undefined || from < 0 || to < 0) {
      return Math.round(moveBase);
    }
    var rows = Math.abs(Math.floor(from / 8) - Math.floor(to / 8));
    var files = Math.abs((from % 8) - (to % 8));
    /* The longer of the two legs: a diagonal is as far as its longest side. */
    var span = Math.max(rows, files) || 1;
    var share = 0.42 + 0.58 * (span / LONGEST_MOVE);
    /*
       Scaled, never floored to a fixed number: the presets have to keep their
       own character, and "instant" means a piece jumps to its square rather than
       gliding there over however long a number of milliseconds suits it.
    */
    return Math.max(1, Math.round(moveBase * share));
  }

  /* Gives this piece its own length for this move, before its position changes. */
  function setTravel(node, from, to) {
    var ms = travelMillis(from, to);
    node.travelMs = ms;
    /*
       Set on the piece rather than on the document, so the setting still decides
       the pace while each move is scaled to its own distance. The lift is given
       the same length, or the piece is still scaling after it has landed.
    */
    node.el.style.setProperty('--move-ms', ms + 'ms');
    node.el.style.setProperty('--lift-ms', Math.round(ms * 0.92) + 'ms');
    return ms;
  }

  /* Flags a node for the length of the glide so the CSS lifts it, then sets it down. */
  function glide(node) {
    /*
       The obvious way to restart the lift is to take the class off, read
       offsetWidth to force a layout, and put it straight back. That read is a
       synchronous reflow of the whole page in the middle of a move, and it is
       felt exactly where it should not be: the piece hesitates on the first
       frame of every glide. Waiting a frame lets the browser retire the old
       animation on its own, which costs nothing.
    */
    var ms = node.travelMs || MOVE_MS;
    node.el.classList.remove('is-moving');
    window.requestAnimationFrame(function () {
      if (!node.el.parentNode) {
        return;
      }
      node.el.classList.add('is-moving');
      window.setTimeout(function () { node.el.classList.remove('is-moving'); }, ms + 20);
    });
  }

  /*
   * Moves the piece standing on `from` to `to` without waiting for the server.
   *
   * The click already knows the move is legal, because the server supplied the
   * target, so there is no reason to leave the piece sitting there for a round
   * trip. When the real state lands the piece is already in the right place and
   * the board simply agrees with it.
   */
  function previewMove(from, to) {
    for (var i = 0; i < pieces.length; i++) {
      if (pieces[i].square === from) {
        setTravel(pieces[i], from, to);
        pieces[i].square = to;
        placePiece(pieces[i]);
        glide(pieces[i]);
        return true;
      }
    }
    return false;
  }

  /*
   * Match every piece on the board to one already on screen.
   *
   * The backend sends the full set of relocations for the move, so a castling
   * rook and an en passant victim are carried across like the piece that was
   * dragged. Anything left over was captured, and fades where it stood.
   */
  function syncPieces() {
    var byIndex = indexMap();
    var plan = (state.moved || []).slice();

    if (!plan.length && state.lastMove && state.lastMove.from >= 0 && state.lastMove.to >= 0
        && state.lastMove.from !== state.lastMove.to) {
      plan = [{ from: state.lastMove.from, to: state.lastMove.to }];
    }

    var travellers = [];
    plan.forEach(function (step) {
      if (step.from < 0 || step.to < 0 || step.from === step.to) {
        return;
      }
      var landing = byIndex[step.to];
      if (!landing) {
        return;
      }
      for (var i = 0; i < pieces.length; i++) {
        var node = pieces[i];
        if (node.square !== step.from || node.reserved) {
          continue;
        }
        if (landing.piece !== node.type || landing.side !== node.side) {
          return;
        }
        node.square = step.to;
        node.reserved = true;
        node.travelFrom = step.from;
        node.travelTo = step.to;
        travellers.push(node);
        break;
      }
    });

    var kept = [];
    var gone = [];
    pieces.forEach(function (node) {
      var want = byIndex[node.square];
      if (want && want.piece === node.type && want.side === node.side) {
        kept.push(node);
      } else {
        gone.push(node);
      }
    });
    pieces = kept;

    gone.forEach(function (node) {
      node.el.classList.add('is-leaving');
      window.setTimeout(function () {
        if (node.el.parentNode) {
          node.el.parentNode.removeChild(node.el);
        }
      }, CAPTURE_MS);
    });

    var taken = {};
    pieces.forEach(function (node) { taken[node.square] = true; });

    var arrivals = [];
    (state.squares || []).forEach(function (square) {
      if (square.piece && !taken[square.index]) {
        arrivals.push(makePiece(square, true));
        pieces.push(arrivals[arrivals.length - 1]);
      }
    });

    var changed = [];
    pieces.forEach(function (node) {
      node.el.classList.remove('is-leaving');
      node.reserved = false;
      /*
         Not `is-entering` here. A piece made a moment ago in this same pass has
         only just been given that class, and taking it off again in the same
         tick is the same as never having added it: the piece appeared at full
         size with nothing easing it in. It is left alone and clears itself on a
         timer, once the animation it is actually running has finished.
      */
      if (arrivals.indexOf(node) < 0) {
        node.el.classList.remove('is-entering');
      }
      if (travellers.indexOf(node) >= 0) {
        changed.push(node);
      } else {
        sizePiece(node);
        placePiece(node);
      }
    });

    /*
     * The travellers are placed inside this same frame as the class change, so
     * the browser has the old position and the new one in the same style pass
     * and animates the difference. Sizing them here rather than up front is
     * what makes that reliable.
     */
    changed.forEach(function (node) {
      setTravel(node, node.travelFrom, node.travelTo);
      sizePiece(node);
      placePiece(node);
      glide(node);
    });
  }

  function clearPieces() {
    pieces.forEach(function (node) {
      if (node.el.parentNode) {
        node.el.parentNode.removeChild(node.el);
      }
    });
    pieces = [];
  }

  function paintBoard() {
    var byIndex = indexMap();
    var last = state.lastMove;
    var plan = [];
    (state.moved || []).forEach(function (step) { plan.push(step.from + '-' + step.to); });
    var key = state.fen + '|' + state.selected + '|' + (state.legalTargets || []).join(',') + '|'
      + state.checkSquare + '|' + (last ? last.from + '-' + last.to : '-') + '|' + plan.join(',') + '|'
      + state.yourTurn + '|' + state.localSide;
    if (key === moveKey) {
      return;
    }

    var wasNewGame = state.fen.indexOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR') === 0
      && (state.history || []).length <= 1;

    buildGrid();
    syncPieces();
    moveKey = key;

    var targets = {};
    (state.legalTargets || []).forEach(function (index) { targets[index] = true; });
    /*
       The hints and the last-move tint are the two board settings that are
       painted rather than styled. Both can change while a game is sitting on
       screen, so both are read here and the repaint that carries them is forced
       by clearing moveKey in applySettings.
    */
    var showHints = settings.dots;
    var showLast = settings.last;

    Array.prototype.forEach.call(el.grid.children, function (cell) {
      var index = Number(cell.dataset.index);
      var square = byIndex[index];
      var marked = showHints && Boolean(targets[index]);
      cell.classList.toggle('square--last', showLast && Boolean(last)
        && (index === last.from || index === last.to));
      cell.classList.toggle('square--selected', index === state.selected);
      cell.classList.toggle('square--check', index === state.checkSquare);
      var clickable = state.yourTurn && Boolean(square) && square.side === state.localSide;
      cell.classList.toggle('square--clickable', clickable);

      var hasDot = Boolean(cell.querySelector('.square__dot'));
      if (marked && !hasDot) {
        var dot = document.createElement('span');
        dot.className = 'square__dot';
        cell.appendChild(dot);
      } else if (!marked && hasDot) {
        cell.querySelector('.square__dot').remove();
      }
      cell.classList.toggle('square--capture', marked && Boolean(square) && Boolean(square.piece));
    });

    if (wasNewGame && (state.history || []).length === 1) {
      el['board-flash'].hidden = false;
      window.setTimeout(function () { el['board-flash'].hidden = true; }, 520);
    }
  }

  // ================================================================== render

  function render() {
    if (!state) {
      return;
    }
    var onGame = state.screen === 'game';
    var wasHidden = el['screen-game'].hidden;
    el['screen-home'].hidden = onGame;
    el['screen-game'].hidden = !onGame;

    if (!onGame) {
      closeModal();
      return;
    }
    flipped = state.localSide === 'black';

    /*
       The board is measured on the way in and on a window resize, not on every
       poll. Asking for clientWidth forces the browser to lay the page out, and
       doing that two or three times a second for a number that cannot have
       changed is work the compositor would rather spend on the animation.
    */
    if (wasHidden) {
      if (layout()) {
        reflow();
      }
      /* One more look on the next frame, in case the row had not settled yet. */
      window.requestAnimationFrame(function () {
        if (layout()) {
          reflow();
        }
      });
    }
    paintBoard();
    renderSeats();
    renderStatus();
    renderHistory();
    renderRail();
    renderMessages();
  }

  function renderSeats() {
    var localIsBlack = state.localSide === 'black';
    var you = state.localName || state.playerName || 'You';
    var them = state.singlePlayer ? 'Computer' : (state.remoteName || 'Opponent');

    el['local-name'].textContent = you + '  \u00B7  ' + (localIsBlack ? 'Black' : 'White');
    el['local-avatar'].textContent = you.charAt(0);
    el['opponent-name'].textContent = them + '  \u00B7  ' + (localIsBlack ? 'White' : 'Black');
    el['opponent-avatar'].textContent = them.charAt(0);

    var lost = capturedFor('white');
    var won = capturedFor('black');
    drawCaptured(el['local-captured'], won, 'black');
    drawCaptured(el['opponent-captured'], lost, 'white');

    var yourMove = !state.finished && state.connected && state.yourTurn;
    var theirTurn = !state.finished && state.connected && !state.yourTurn;

    el['local-dot'].hidden = !yourMove;
    el['opponent-dot'].hidden = !theirTurn;

    el['local-state'].textContent = state.finished
      ? (state.gameOverHeadline || 'Game over')
      : (state.singlePlayer ? (state.connected ? 'You are playing' : 'Ready') : (state.connected ? 'You' : 'Not connected'));
    el['local-state'].classList.remove('is-thinking');

    var note = state.pending;
    if (!note && state.finished) {
      note = 'Waiting for you to start a new game';
    } else if (!note && !state.connected) {
      note = 'Waiting for an opponent';
    } else if (!note && theirTurn) {
      note = state.thinking ? 'Thinking' : 'Moving';
    } else if (!note) {
      note = 'Waiting';
    }
    el['opponent-state'].textContent = note;
    el['opponent-state'].classList.toggle('is-thinking', Boolean(state.thinking) || Boolean(state.pending));
  }

  function capturedFor(side) {
    var left = { king: 0, queen: 0, rook: 0, bishop: 0, knight: 0, pawn: 0 };
    (state.squares || []).forEach(function (square) {
      if (square.side === side && left[square.piece] > 0) {
        left[square.piece] -= 1;
      }
    });
    var missing = {};
    Object.keys(FULL_SET).forEach(function (type) {
      missing[type] = FULL_SET[type] - left[type];
    });
    return missing;
  }

  function drawCaptured(host, missing, side) {
    var wanted = PIECE_ORDER.filter(function (type) { return missing[type] > 0; });
    var key = wanted.join(',') + '|' + side;
    if (host.dataset.key === key) {
      return;
    }
    host.dataset.key = key;
    host.textContent = '';
    wanted.forEach(function (type) {
      for (var n = 0; n < missing[type]; n++) {
        var span = document.createElement('span');
        span.className = 'glyph glyph--' + side;
        span.textContent = GLYPH[side][type];
        host.appendChild(span);
      }
    });
  }

  function renderStatus() {
    var dot = el['status-dot'];
    var text = state.status || (state.finished ? 'Game over' : 'Ready');
    var meta = '';
    dot.className = 'statusbar__dot';

    if (state.finished) {
      dot.classList.add('is-over');
      meta = state.gameOverDetail || '';
    } else if (state.pending) {
      dot.classList.add('is-think');
      meta = state.mode === 'hosting' ? 'Share the code' : '';
    } else if (!state.connected) {
      dot.classList.add('is-think');
      meta = state.singlePlayer ? '' : 'Not connected';
    } else if (state.yourTurn) {
      dot.classList.add('is-you');
      meta = 'Click a piece to move it';
    } else {
      dot.classList.add('is-think');
      meta = state.singlePlayer ? 'The computer is thinking' : 'Waiting for a reply';
    }
    el['status-text'].textContent = text;
    el['status-meta'].textContent = meta;
  }

  function renderHistory() {
    var history = state.history || [];
    el['move-count'].textContent = String(history.length);
    var key = history.length + '|' + (history[history.length - 1] || '');
    if (historyKey === key) {
      return;
    }
    historyKey = key;
    el['move-list'].textContent = '';
    if (!history.length) {
      var empty = document.createElement('li');
      empty.className = 'is-empty';
      empty.textContent = 'No moves yet';
      el['move-list'].appendChild(empty);
      return;
    }
    for (var i = 0; i < history.length; i += 2) {
      var row = document.createElement('li');
      if (i + 1 === history.length) {
        row.className = 'is-latest';
      }
      var no = document.createElement('span');
      no.className = 'moves__no';
      no.textContent = (i / 2 + 1) + '.';
      var white = document.createElement('span');
      white.className = 'moves__ply';
      white.textContent = history[i];
      var black = document.createElement('span');
      black.className = 'moves__ply';
      black.textContent = history[i + 1] || '';
      row.appendChild(no);
      row.appendChild(white);
      row.appendChild(black);
      el['move-list'].appendChild(row);
    }
    el['move-list'].scrollTop = el['move-list'].scrollHeight;
  }

  function renderRail() {
    var networked = !state.singlePlayer;
    el['room-facts'].hidden = !networked;
    el['facts'].hidden = !networked;
    el['room-badge'].hidden = !state.roomCode;
    el['room-badge'].textContent = state.roomCode ? 'Room ' + state.roomCode : '';
    el['gamebar-sub'].textContent = networked
      ? 'Friend game' + (state.roomCode ? '  \u00B7  code ' + state.roomCode : '')
      : 'Playing the computer';
    if (networked) {
      el['fact-room'].textContent = state.roomCode || '----';
      el['fact-address'].textContent = state.localAddress || '-';
    }
    el['btn-resign'].hidden = state.finished || !state.connected;
    el['btn-rematch'].hidden = !state.finished || !state.connected;
  }

  function renderMessages() {
    if (state.error && state.error !== lastError) {
      lastError = state.error;
      toast(state.error, false);
    }
    if (!state.error) {
      lastError = '';
    }
    if (state.rematchOffered && modalKey !== 'rematch') {
      toast('Your opponent wants a rematch.', true);
    }

    if (state.pending && !state.finished) {
      if (lastPending !== state.pending) {
        lastPending = state.pending;
        openModal({
          key: 'wait',
          eyebrow: 'Please wait',
          title: state.pending.replace(/[.]{3}$/, ''),
          body: state.mode === 'hosting'
            ? 'Read the room code out to the other player. This window will start as soon as they join.'
            : 'Keep this window open while the room is found.',
          dismiss: 'Cancel'
        });
      }
      return;
    }
    lastPending = '';

    if (state.finished) {
      if (modalKey !== 'over') {
        openModal({
          key: 'over',
          eyebrow: state.localWon ? 'You won' : 'Result',
          title: state.gameOverHeadline || 'Game over',
          body: state.gameOverDetail || '',
          rematch: state.connected,
          dismiss: 'Back to menu'
        });
      }
      return;
    }

    if (state.mode === 'idle' || (modalKey === 'wait')) {
      closeModal();
    }
  }

  function openModal(options) {
    modalKey = options.key || 'wait';
    el['modal-eyebrow'].textContent = options.eyebrow || '';
    el['modal-title'].textContent = options.title || '';
    el['modal-body'].textContent = options.body || '';
    el['btn-modal-dismiss'].textContent = options.dismiss || 'Close';
    el['btn-modal-rematch'].hidden = !options.rematch;
    el.modal.hidden = false;
  }

  function closeModal() {
    if (modalKey === null) {
      return;
    }
    modalKey = null;
    el.modal.hidden = true;
  }

  function toast(text, info) {
    el.toast.textContent = text;
    el.toast.classList.toggle('is-info', Boolean(info));
    el.toast.hidden = false;
    if (toastTimer) {
      window.clearTimeout(toastTimer);
    }
    toastTimer = window.setTimeout(function () { el.toast.hidden = true; }, 6000);
  }

  // ==================================================================== talk

  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (response) { return response.json().catch(function () { return {}; }); });
  }

  /*
     Takes a state that has arrived and decides whether it is worth painting.
     Returns it either way, so a caller can carry on with it.
  */
  function adopt(next, quiet) {
    /*
     * While a command is in flight the answer can still describe the old
     * position. Painting it would drag the piece the player just moved back
     * to where it came from and then out again, so those responses are
     * dropped and the command's own refresh does the painting.
     */
    if (quiet || !next || next.screen === undefined) {
      return next;
    }
    var previous = state;
    var changed = !state
      || next.fen !== state.fen
      || next.mode !== state.mode
      || next.screen !== state.screen
      || next.status !== state.status
      || next.finished !== state.finished
      || next.gameOver !== state.gameOver
      || next.pending !== state.pending
      || next.error !== state.error
      || next.localName !== state.localName
      || next.remoteName !== state.remoteName
      || next.rematchOffered !== state.rematchOffered
      || next.yourTurn !== state.yourTurn
      || next.thinking !== state.thinking
      || next.selected !== state.selected
      || next.connected !== state.connected
      || next.localSide !== state.localSide;
    notice(previous, next);
    state = next;
    if (changed) {
      render();
    }
    return next;
  }

  function getState(quiet) {
    return fetch('/api/state', { cache: 'no-store' })
      .then(function (response) { return response.json(); })
      .then(function (next) {
        return adopt(next, quiet);
      });
  }

  /* Poll fast when something is about to change, slowly when it is not. */
  function delay() {
    if (!state) {
      return 200;
    }
    if (state.pending) {
      return 120;
    }
    if (state.finished || state.mode === 'idle') {
      return IDLE_MS;
    }
    if (state.connected && !state.yourTurn) {
      return BUSY_MS;
    }
    return QUICK_MS;
  }

  function loop() {
    if (document.hidden) {
      window.setTimeout(loop, 1000);
      return;
    }
    if (busy) {
      window.setTimeout(loop, 120);
      return;
    }
    getState(false).catch(function () { /* the window may still be starting */ })
      .then(function () { window.setTimeout(loop, delay()); });
  }

  /*
   * Sends a command, then repaints from the state that comes back with it.
   *
   * The reply is the state the command produced, so a click costs one round trip
   * instead of a round trip followed by a poll for the result. A command the
   * server refused answers with an error rather than a state, and the state is
   * then asked for as it always was.
   */
  function command(path, body) {
    if (busy) {
      return;
    }
    busy = true;
    post(path, body)
      .then(function (next) {
        if (!next || next.screen === undefined) {
          return getState(false);
        }
        return adopt(next, false);
      })
      .catch(function (e) { toast('Could not talk to the game: ' + e.message, true); })
      .then(function () {
        busy = false;
        window.setTimeout(loop, 0);
      });
  }

  // ============================================================== interaction

  function squareAt(index) {
    var found = null;
    (state.squares || []).forEach(function (square) { if (square.index === index) { found = square; } });
    return found;
  }

  function needsPromotion(mover, to) {
    if (!mover || mover.piece !== 'pawn') {
      return false;
    }
    return mover.side === 'white' ? to < 8 : to >= 56;
  }

  /*
   * A promoting pawn cannot be previewed, because the server only reveals which
   * piece it becomes after the choice. Rather than move it to a square that
   * might be wrong, it is hidden where it stands while the panel is open. It is
   * never displaced, so clearing the selection cannot snap it anywhere, and on
   * confirmation the ordinary relocation sends it sliding to its real square.
   */
  function setPromotingPawnHidden(hidden) {
    for (var i = 0; i < pieces.length; i++) {
      var node = pieces[i];
      if (node.type === 'pawn' && node.side === promotingSide && isPromotionRank(node.square)) {
        node.el.classList.toggle('is-hidden', hidden);
      }
    }
  }

  function isPromotionRank(square) {
    return promotingSide === 'white' ? square >= 48 : square < 8;
  }

  function onBoardDown(event) {
    var cell = event.target.closest ? event.target.closest('.square') : null;
    if (cell && cell.classList.contains('square--clickable')) {
      cell.classList.add('is-pressed');
    }
  }

  function onBoardUp(event) {
    Array.prototype.forEach.call(el.grid.querySelectorAll('.is-pressed'), function (cell) {
      cell.classList.remove('is-pressed');
    });
  }

  function onBoardClick(event) {
    var cell = event.target.closest ? event.target.closest('.square') : null;
    if (!cell || !state || !state.yourTurn || busy) {
      return;
    }
    var index = Number(cell.dataset.index);
    var square = squareAt(index);
    if (!square) {
      return;
    }

    if (state.selected >= 0 && (state.legalTargets || []).indexOf(index) >= 0) {
      var from = state.selected;
      var mover = squareAt(from);
      if (needsPromotion(mover, index)) {
        pendingPromotion = { from: from, to: index };
        showPromotion(mover.side);
        return;
      }
      /* The server already called this destination legal, so slide it now. */
      previewMove(from, index);
      command('/api/move', { from: from, to: index, promotion: '' });
      return;
    }
    if (index === state.selected) {
      command('/api/select', { square: index });
      return;
    }
    if (square.side === state.localSide) {
      command('/api/select', { square: index });
      return;
    }
    /*
       A square that cannot be played: an empty one that the piece in hand does
       not reach, or one of the opponent's own. Nothing is sent to the server,
       so without a sound here the click would pass off as the board being slow.
    */
    play('deny');
  }

  function showPromotion(side) {
    promotingSide = side;
    setPromotingPawnHidden(true);
    el['promo-choices'].textContent = '';
    PROMOTION.forEach(function (type) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'glyph glyph--' + side;
      button.textContent = GLYPH[side][type];
      button.title = type.charAt(0).toUpperCase() + type.slice(1);
      button.addEventListener('click', function () {
        var move = pendingPromotion;
        hidePromotion(true);
        if (move) {
          command('/api/move', { from: move.from, to: move.to, promotion: type });
        }
      });
      el['promo-choices'].appendChild(button);
    });
    el.promo.hidden = false;
  }

  /* `commanding` means a move is about to be sent, so the caller refreshes. */
  function hidePromotion(commanding) {
    var wasOpen = pendingPromotion !== null;
    pendingPromotion = null;
    el.promo.hidden = true;
    setPromotingPawnHidden(false);
    if (wasOpen && !commanding && !busy) {
      getState(false);
    }
  }

  // ========================================================= sound and settings

  /*
     The three animation lengths, as the stylesheet has them. Changing the speed
     is a change to these variables and nothing else; the script reads the values
     back afterwards, so there is only ever one set of numbers in play.
  */
  var SPEEDS = {
    calm: { move: 420, lift: 420, capture: 380, leave: 110, fade: 320, pop: 320,
      note: 'Pieces glide for a little under half a second.' },
    normal: { move: 240, lift: 240, capture: 220, leave: 60, fade: 200, pop: 200,
      note: 'Pieces glide for a quarter of a second.' },
    instant: { move: 1, lift: 1, capture: 1, leave: 0, fade: 1, pop: 90,
      note: 'Pieces jump straight to the square they belong on.' }
  };
  var SETTINGS_KEY = 'chessgame.settings';

  var settings = {
    sound: true,
    volume: 60,
    dots: true,
    last: true,
    coords: true,
    speed: 'normal'
  };

  /*
     Reads what was saved last time. A missing, unreadable or half-written entry
     is simply ignored, so a corrupt line in local storage costs the player their
     preferences and nothing else - the panel still opens and every control still
     has a usable value behind it.
  */
  function loadSettings() {
    var raw = null;
    try {
      raw = window.localStorage.getItem(SETTINGS_KEY);
    } catch (e) {
      return;
    }
    if (!raw) {
      return;
    }
    var saved = null;
    try {
      saved = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (!saved || typeof saved !== 'object') {
      return;
    }
    ['sound', 'dots', 'last', 'coords'].forEach(function (key) {
      if (typeof saved[key] === 'boolean') {
        settings[key] = saved[key];
      }
    });
    if (typeof saved.volume === 'number' && isFinite(saved.volume)) {
      settings.volume = clampVolume(saved.volume);
    }
    if (SPEEDS[saved.speed]) {
      settings.speed = saved.speed;
    }
  }

  function saveSettings() {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      /* Nowhere to keep them. They still apply for this session. */
    }
  }

  function clampVolume(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value) / 5) * 5));
  }

  function themeId() {
    return document.documentElement.getAttribute('data-theme') || THEMES[0].id;
  }

  /*
     Puts every setting into effect, in one place, so there is a single answer to
     "what does changing this actually do".

     Coordinates are hidden with a class rather than by not drawing them. The
     labels belong to the grid and are built once per side, so taking them away
     would mean rebuilding sixty-four squares and would throw away the piece
     positions with them. The hints and the last-move tint are the opposite: they
     belong to the squares rather than to the frame, so they are handed to CSS
     only if a rule needs them, and turning them off has to be able to reach the
     squares that already have one.
  */
  function applySettings() {
    var root = document.documentElement;
    var speed = SPEEDS[settings.speed] || SPEEDS.normal;
    root.style.setProperty('--move-ms', speed.move + 'ms');
    root.style.setProperty('--lift-ms', speed.lift + 'ms');
    root.style.setProperty('--capture-ms', speed.capture + 'ms');
    root.style.setProperty('--leave-delay', speed.leave + 'ms');
    root.style.setProperty('--fade-ms', speed.fade + 'ms');
    root.style.setProperty('--pop-ms', speed.pop + 'ms');
    readTimings();

    el.board.classList.toggle('board--no-coords', !settings.coords);

    if (audio && master) {
      master.gain.value = settings.sound ? settings.volume / 100 : 0;
    }

    if (state) {
      moveKey = '';
      paintBoard();
    }

    saveSettings();
    paintSettings();
  }

  /*
     Shows what is in force. Called after every change and once at startup, so
     the panel can never show a setting that the board is not using.
  */
  function paintSettings() {
    el['opt-sound'].checked = settings.sound;
    el['opt-volume'].value = String(settings.volume);
    el['volume-out'].textContent = settings.volume + '%';
    el['volume-wrap'].classList.toggle('is-muted', !settings.sound);
    el['opt-dots'].checked = settings.dots;
    el['opt-last'].checked = settings.last;
    el['opt-coords'].checked = settings.coords;
    el['speed-note'].textContent = (SPEEDS[settings.speed] || SPEEDS.normal).note;

    Array.prototype.forEach.call(el['opt-speed'].children, function (button) {
      var on = button.dataset.speed === settings.speed;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-checked', on ? 'true' : 'false');
    });

    Array.prototype.forEach.call(el['settings-themes'].children, function (button) {
      button.classList.toggle('is-active', button.dataset.theme === themeId());
    });
  }

  function openSettings() {
    paintSettings();
    el.settings.hidden = false;
  }

  function closeSettings() {
    el.settings.hidden = true;
  }

  // --------------------------------------------------------------------- sound

  /*
     The sounds are made rather than loaded. A piece landing on a board is mostly
     a knock: a very short burst of noise for the strike, with a low tone under
     it for the wood. Generating that costs a few lines and, unlike a folder of
     audio files, it is a rounding error on the size of the program - and it
     cannot go missing, because there is nothing to go missing.
  */
  var audio = null;
  var master = null;
  var noiseBuffer = null;

  function audioOut() {
    if (audio) {
      return audio;
    }
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) {
      return null;
    }
    try {
      audio = new Ctor();
    } catch (e) {
      audio = null;
      return null;
    }
    master = audio.createGain();
    master.gain.value = settings.sound ? settings.volume / 100 : 0;
    master.connect(audio.destination);
    return audio;
  }

  /* One pitched blip with a soft edge, so nothing clicks in or out. */
  function blip(at, frequency, span, peak, shape) {
    var osc = audio.createOscillator();
    var gain = audio.createGain();
    osc.type = shape || 'sine';
    osc.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + span);
    osc.connect(gain);
    gain.connect(master);
    osc.start(at);
    osc.stop(at + span + 0.03);
  }

  /* The strike itself: a band of noise that dies away almost at once. */
  function knock(at, peak, colour, when) {
    var start = when || at;
    if (!noiseBuffer) {
      var frames = Math.floor(audio.sampleRate * 0.25);
      noiseBuffer = audio.createBuffer(1, frames, audio.sampleRate);
      var data = noiseBuffer.getChannelData(0);
      for (var i = 0; i < frames; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
      }
    }
    var src = audio.createBufferSource();
    var filter = audio.createBiquadFilter();
    var gain = audio.createGain();
    src.buffer = noiseBuffer;
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(colour, start);
    filter.Q.value = 1.2;
    gain.gain.setValueAtTime(peak, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.09);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(start);
    src.stop(start + 0.12);
  }

  function chord(at, notes, span, peak, shape) {
    notes.forEach(function (frequency, n) {
      blip(at + n * 0.085, frequency, span, peak, shape);
    });
  }

  var SOUNDS = {
    ui: function (at) {
      blip(at, 760, 0.045, 0.05, 'triangle');
    },
    select: function (at) {
      knock(at, 0.11, 2600);
      blip(at, 430, 0.05, 0.045, 'sine');
    },
    deny: function (at) {
      blip(at, 165, 0.11, 0.06, 'sine');
    },
    move: function (at) {
      knock(at, 0.30, 1500);
      blip(at, 185, 0.09, 0.10, 'sine');
    },
    capture: function (at) {
      knock(at, 0.42, 950);
      blip(at, 124, 0.15, 0.13, 'sine');
    },
    castle: function (at) {
      knock(at, 0.28, 1500, at);
      knock(at, 0.26, 1350, at + 0.115);
    },
    check: function (at) {
      blip(at, 659, 0.1, 0.09, 'triangle');
      blip(at, 880, 0.18, 0.09, 'triangle');
    },
    win: function (at) {
      chord(at, [523, 659, 784, 1047], 0.26, 0.1, 'triangle');
    },
    lose: function (at) {
      chord(at, [392, 349, 294], 0.3, 0.09, 'triangle');
    },
    draw: function (at) {
      chord(at, [440, 523], 0.26, 0.08, 'triangle');
    }
  };

  /*
     Everything that makes a noise goes through here.

     The context is built on the first sound rather than at startup, because a
     browser will not let audio start without a gesture and would only log a
     complaint about a context nobody had asked for yet. A context that is still
     suspended - the window was opened, and this is the first click - is resumed
     here, in the same gesture that caused the sound.
  */
  function play(name) {
    if (!settings.sound || settings.volume === 0) {
      return;
    }
    var sound = SOUNDS[name];
    if (!sound || !audioOut()) {
      return;
    }
    if (audio.state === 'suspended' && audio.resume) {
      audio.resume();
    }
    sound(audio.currentTime + 0.012);
  }

  /* Let the first click anywhere open the gate, so the first sound is not late. */
  function unlockAudio() {
    if (!settings.sound) {
      return;
    }
    if (audioOut() && audio.state === 'suspended' && audio.resume) {
      audio.resume();
    }
  }

  // ------------------------------------------------------------------- notices

  function piecesOnBoard(position) {
    var count = 0;
    ((position && position.squares) || []).forEach(function (square) {
      if (square.piece) {
        count += 1;
      }
    });
    return count;
  }

  /*
     Works out what just happened by comparing the position that was on screen
     with the one that has arrived, and makes the noise that belongs to it.

     Comparing two states rather than listening for the click is what keeps this
     honest. A click that was refused must be silent, a move by the computer must
     sound exactly like a move by the player, and a piece that slides as the
     player drags it must not click twice. None of those can be told apart at the
     pointer, and all of them can be told apart here.

     The polls that run while a command is in flight are dropped by `adopt`
     before they get this far, so one event is one sound however many requests
     were on the wire when it happened.
  */
  function notice(previous, next) {
    if (!previous || !next) {
      return;
    }

    if (next.selected >= 0 && next.selected !== previous.selected) {
      play('select');
    } else if (next.selected < 0 && previous.selected >= 0 && next.fen === previous.fen) {
      /* A piece put back down where it came from: refused, not played. */
      play('deny');
    }

    if (next.fen === previous.fen) {
      return;
    }

    var relocations = next.moved || [];
    if (relocations.length === 2) {
      play('castle');
    } else if (piecesOnBoard(next) < piecesOnBoard(previous)) {
      play('capture');
    } else {
      play('move');
    }

    if (next.finished) {
      var won = Boolean(next.localWon);
      var headline = String(next.gameOverHeadline || '').toLowerCase();
      var draw = !won && headline.indexOf('draw') >= 0;
      play(draw ? 'draw' : (won ? 'win' : 'lose'));
    } else if (next.checkSquare >= 0 && next.checkSquare !== previous.checkSquare) {
      play('check');
    }
  }

  // ==================================================================== setup

  function buildLevels() {
    el['level-list'].textContent = '';
    levels.forEach(function (level, order) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'level' + (level.id === chosenLevel ? ' is-active' : '');
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', level.id === chosenLevel ? 'true' : 'false');
      card.dataset.level = level.id;

      var name = document.createElement('span');
      name.className = 'level__name';
      name.textContent = level.label;
      var blurb = document.createElement('span');
      blurb.className = 'level__blurb';
      blurb.textContent = level.blurb;
      var clock = document.createElement('span');
      clock.className = 'level__clock';
      clock.textContent = 'Thinks for about ' + seconds(level.minimumThinkMillis);
      var bars = document.createElement('span');
      bars.className = 'level__bars';
      for (var b = 0; b < 3; b++) {
        var bar = document.createElement('i');
        if (b <= order) {
          bar.className = 'on';
        }
        bars.appendChild(bar);
      }
      card.appendChild(name);
      card.appendChild(blurb);
      card.appendChild(clock);
      card.appendChild(bars);
      card.addEventListener('click', function () {
        chosenLevel = level.id;
        Array.prototype.forEach.call(el['level-list'].children, function (other) {
          var on = other.dataset.level === chosenLevel;
          other.classList.toggle('is-active', on);
          other.setAttribute('aria-checked', on ? 'true' : 'false');
        });
      });
      el['level-list'].appendChild(card);
    });
  }

  function seconds(millis) {
    if (!millis) {
      return 'a moment';
    }
    var tenths = Math.round(millis / 100);
    return (tenths / 10).toFixed(tenths % 10 === 0 ? 0 : 1) + ' seconds';
  }

  /* ------------------------------------------------------------------ themes */

  function applyTheme(id) {
    document.documentElement.setAttribute('data-theme', id);
    window.localStorage.setItem('chessgame.theme', id);
    /*
       The theme is offered in two places - the start screen and the settings
       panel - so both sets of swatches are marked. Otherwise picking a theme in
       one place left the other set still showing the old choice as selected.
    */
    Array.prototype.forEach.call(document.querySelectorAll('.swatch[data-theme]'), function (button) {
      button.classList.toggle('is-active', button.dataset.theme === id);
    });
  }

  function buildThemes() {
    // Only the swatches are replaced: the group keeps its own label.
    Array.prototype.forEach.call(el.themes.querySelectorAll('.swatch'), function (button) {
      el.themes.removeChild(button);
    });
    THEMES.forEach(function (theme) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.dataset.theme = theme.id;
      button.title = theme.name + ' theme';
      button.setAttribute('aria-label', theme.name + ' theme');
      var dot = document.createElement('i');
      dot.style.setProperty('--s1', theme.s1);
      dot.style.setProperty('--s2', theme.s2);
      button.appendChild(dot);
      button.addEventListener('click', function () { applyTheme(theme.id); });
      el.themes.appendChild(button);
    });
    var saved = window.localStorage.getItem('chessgame.theme');
    var known = THEMES.some(function (theme) { return theme.id === saved; });
    applyTheme(known ? saved : THEMES[0].id);
  }

  /* -------------------------------------------------------------- settings ui */

  /*
     The same swatches as the start screen, built the same way, so a theme picked
     in either place is the theme the other place shows as chosen.
  */
  function buildSettingsThemes() {
    THEMES.forEach(function (theme) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.dataset.theme = theme.id;
      button.title = theme.name + ' theme';
      button.setAttribute('aria-label', theme.name + ' theme');
      var dot = document.createElement('i');
      dot.style.setProperty('--s1', theme.s1);
      dot.style.setProperty('--s2', theme.s2);
      button.appendChild(dot);
      button.addEventListener('click', function () {
        applyTheme(theme.id);
        play('ui');
      });
      el['settings-themes'].appendChild(button);
    });
  }

  function wireSettings() {
    el['btn-settings'].addEventListener('click', function () {
      play('ui');
      openSettings();
    });
    el['btn-settings-home'].addEventListener('click', function () {
      play('ui');
      openSettings();
    });
    el['btn-settings-close'].addEventListener('click', function () {
      play('ui');
      closeSettings();
    });
    el['btn-settings-done'].addEventListener('click', function () {
      play('ui');
      closeSettings();
    });

    /* A click on the dimmed area behind the panel is a request to be done. */
    el.settings.addEventListener('click', function (event) {
      if (event.target === el.settings) {
        play('ui');
        closeSettings();
      }
    });

    var toggle = function (id, key) {
      el[id].addEventListener('change', function (event) {
        settings[key] = event.target.checked;
        applySettings();
        play('ui');
      });
    };
    toggle('opt-sound', 'sound');
    toggle('opt-dots', 'dots');
    toggle('opt-last', 'last');
    toggle('opt-coords', 'coords');

    el['opt-volume'].addEventListener('input', function (event) {
      settings.volume = clampVolume(event.target.value);
      applySettings();
    });

    Array.prototype.forEach.call(el['opt-speed'].children, function (button) {
      button.addEventListener('click', function () {
        if (settings.speed === button.dataset.speed) {
          return;
        }
        settings.speed = button.dataset.speed;
        applySettings();
        play('ui');
      });
    });

    /*
       Escape closes the panel before it reaches the promotion chooser: the panel
       is the outer layer, so it is the one the player means to get rid of.
    */
    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !el.settings.hidden) {
        closeSettings();
        return;
      }
      if (event.key === 'Escape' && !el.promo.hidden) {
        hidePromotion(false);
      }
    });

    /* The first click anywhere is what lets the browser start audio at all. */
    window.addEventListener('pointerdown', unlockAudio, { once: true });
  }

  function playerName() {
    var name = el['player-name'].value.trim();
    window.localStorage.setItem('chessgame.name', name);
    return name;
  }

  function wire() {
    el.board.addEventListener('pointerdown', onBoardDown);
    window.addEventListener('pointerup', onBoardUp);
    el.board.addEventListener('click', onBoardClick);
    el['btn-promo-cancel'].addEventListener('click', function () { hidePromotion(false); });
    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !el.promo.hidden && el.settings.hidden) {
        hidePromotion(false);
      }
    });
    window.addEventListener('resize', function () {
      if (layout()) {
        reflow();
      }
    });

    el['btn-play-computer'].addEventListener('click', function () {
      closeModal();
      command('/api/single-player', { level: chosenLevel, colour: chosenColour, name: playerName() });
    });
    el['btn-host'].addEventListener('click', function () {
      closeModal();
      command('/api/host', { name: playerName() });
    });
    el['btn-join'].addEventListener('click', function () {
      closeModal();
      command('/api/join', { code: el['join-code'].value.trim(), name: playerName() });
    });
    el['btn-join-direct'].addEventListener('click', function () {
      closeModal();
      command('/api/join-direct', {
        code: el['join-code'].value.trim(),
        host: el['join-host'].value.trim(),
        name: playerName()
      });
    });
    el['join-code'].addEventListener('input', function (event) {
      event.target.value = event.target.value.replace(/[^0-9]/g, '').slice(0, 4);
    });

    Array.prototype.forEach.call(document.querySelectorAll('.side-option'), function (option) {
      option.addEventListener('click', function () {
        chosenColour = option.dataset.colour;
        Array.prototype.forEach.call(document.querySelectorAll('.side-option'), function (other) {
          other.classList.toggle('is-active', other === option);
        });
      });
    });

    el['btn-menu'].addEventListener('click', function () {
      closeModal();
      command('/api/leave', {});
    });
    el['btn-resign'].addEventListener('click', function () { command('/api/resign', {}); });
    el['btn-rematch'].addEventListener('click', function () {
      closeModal();
      command('/api/rematch', {});
    });
    el['btn-modal-rematch'].addEventListener('click', function () {
      closeModal();
      command('/api/rematch', {});
    });
    el['btn-modal-dismiss'].addEventListener('click', function () {
      closeModal();
      command('/api/leave', {});
    });
  }

  cache();
  readTimings();
  adoptStyleSize();
  /*
     Settings come before the theme and the first paint on purpose. applySettings
     writes the animation lengths and reads them straight back, and hiding the
     coordinates is a class on the board, so a board drawn before they ran would
     start at the wrong speed and then jump.
  */
  loadSettings();
  buildThemes();
  buildSettingsThemes();
  applySettings();
  wire();
  wireSettings();

  fetch('/api/levels')
    .then(function (r) { return r.json(); })
    .then(function (list) {
      levels = list || [];
      if (levels.length) {
        chosenLevel = levels[Math.min(1, levels.length - 1)].id;
      }
      buildLevels();
    })
    .catch(function () {
      el['level-list'].textContent = 'The difficulty list could not be loaded.';
    });

  el['player-name'].value = window.localStorage.getItem('chessgame.name') || '';
  getState(false).then(function () {
    if (layout()) {
      reflow();
    }
    loop();
  });
}());
