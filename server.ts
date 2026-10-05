import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { Chess } from 'chess.js';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Session identification middleware
app.use((req, res, next) => {
  let sessionId = (req.headers['x-session-id'] as string) || (req.query.sessionId as string) || req.cookies?.sessionId;
  if (!sessionId || sessionId === 'undefined' || sessionId === 'null') {
    sessionId = crypto.randomUUID();
    res.cookie('sessionId', sessionId, { httpOnly: true, sameSite: 'none', secure: true, maxAge: 86400000 });
  }
  req.cookies.sessionId = sessionId;
  next();
});

// Levels definition
const LEVELS = [
  {
    id: 'simple',
    label: 'Beginner (800)',
    blurb: 'Makes casual moves. Fast & easy.',
    depth: 1,
    thinkingMillis: 50,
    minimumThinkMillis: 60
  },
  {
    id: 'medium',
    label: 'Intermediate (1400)',
    blurb: 'Plays solid tactical chess quickly.',
    depth: 2,
    thinkingMillis: 90,
    minimumThinkMillis: 100
  },
  {
    id: 'hard',
    label: 'Master (2000)',
    blurb: 'Sharp tactical engine search.',
    depth: 3,
    thinkingMillis: 140,
    minimumThinkMillis: 150
  }
];

// Square helpers: 0 = a8, 63 = h1
function indexToSquare(idx: number): string {
  const file = String.fromCharCode(97 + (idx & 7));
  const rank = 8 - (idx >> 3);
  return `${file}${rank}`;
}

function squareToIndex(sq: string): number {
  if (!sq || sq.length < 2) return -1;
  const file = sq.charCodeAt(0) - 97;
  const rank = parseInt(sq[1], 10);
  const row = 8 - rank;
  return row * 8 + file;
}

const PIECE_NAMES: Record<string, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king'
};

function getSquares(chess: Chess) {
  const board = chess.board();
  const squares = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const idx = r * 8 + c;
      const file = String.fromCharCode(97 + c);
      const rank = 8 - r;
      const piece = board[r][c];
      squares.push({
        index: idx,
        name: `${file}${rank}`,
        dark: (c + r) % 2 !== 0,
        file: file,
        rank: rank,
        piece: piece ? PIECE_NAMES[piece.type] : null,
        side: piece ? (piece.color === 'w' ? 'white' : 'black') : null
      });
    }
  }
  return squares;
}

function findKingSquare(chess: Chess, color: 'w' | 'b'): number {
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && piece.type === 'k' && piece.color === color) {
        return r * 8 + c;
      }
    }
  }
  return -1;
}

function getRelocations(
  fromIdx: number,
  toIdx: number,
  flags: string,
  color: 'w' | 'b'
): Array<{ from: number; to: number }> {
  const relocations = [{ from: fromIdx, to: toIdx }];
  if (flags.includes('k')) {
    if (color === 'w') {
      relocations.push({ from: 63, to: 61 });
    } else {
      relocations.push({ from: 7, to: 5 });
    }
  } else if (flags.includes('q')) {
    if (color === 'w') {
      relocations.push({ from: 56, to: 59 });
    } else {
      relocations.push({ from: 0, to: 3 });
    }
  } else if (flags.includes('e')) {
    const victimIdx = toIdx + (color === 'w' ? 8 : -8);
    relocations.push({ from: victimIdx, to: toIdx });
  }
  return relocations;
}

// -----------------------------------------------------------------------------
// Material & Evaluation Summary
// -----------------------------------------------------------------------------
function getMaterialSummary(chess: Chess) {
  const board = chess.board();
  const counts: Record<'w' | 'b', Record<string, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 }
  };
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p) counts[p.color][p.type]++;
    }
  }
  const STARTING: Record<string, number> = { q: 1, r: 2, b: 2, n: 2, p: 8 };
  const whiteCaptured: string[] = []; // pieces White has captured from Black
  const blackCaptured: string[] = []; // pieces Black has captured from White

  for (const type of ['q', 'r', 'b', 'n', 'p']) {
    const missingBlack = Math.max(0, STARTING[type] - counts.b[type]);
    for (let i = 0; i < missingBlack; i++) whiteCaptured.push(type);
    const missingWhite = Math.max(0, STARTING[type] - counts.w[type]);
    for (let i = 0; i < missingWhite; i++) blackCaptured.push(type);
  }

  const VALS: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  let whiteVal = 0;
  let blackVal = 0;
  for (const t of Object.keys(VALS)) {
    whiteVal += counts.w[t] * VALS[t];
    blackVal += counts.b[t] * VALS[t];
  }
  const diff = whiteVal - blackVal;

  return {
    whiteCaptured,
    blackCaptured,
    advantage: diff !== 0 ? { side: diff > 0 ? 'white' : 'black', score: Math.abs(diff) } : null,
    whiteVal,
    blackVal
  };
}

// -----------------------------------------------------------------------------
// AI Engine with Negamax and Piece-Square Tables
// -----------------------------------------------------------------------------
const PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 320,
  b: 335,
  r: 500,
  q: 950,
  k: 20000
};

const PAWN_TABLE = [
  0, 0, 0, 0, 0, 0, 0, 0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5, 5, 10, 27, 27, 10, 5, 5,
  0, 0, 0, 25, 25, 0, 0, 0,
  5, -5, -10, 0, 0, -10, -5, 5,
  5, 10, 10, -25, -25, 10, 10, 5,
  0, 0, 0, 0, 0, 0, 0, 0
];

const KNIGHT_TABLE = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 0, 0, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50
];

const BISHOP_TABLE = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 10, 10, 10, 10, 0, -10,
  -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 5, 0, 0, 0, 0, 5, -10,
  -20, -10, -10, -10, -10, -10, -10, -20
];

const ROOK_TABLE = [
  0, 0, 0, 0, 0, 0, 0, 0,
  5, 10, 10, 10, 10, 10, 10, 5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  0, 0, 0, 5, 5, 0, 0, 0
];

const QUEEN_TABLE = [
  -20, -10, -10, -5, -5, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 5, 5, 5, 0, -10,
  -5, 0, 5, 5, 5, 5, 0, -5,
  0, 0, 5, 5, 5, 5, 0, -5,
  -10, 5, 5, 5, 5, 5, 0, -10,
  -10, 0, 5, 0, 0, 0, 0, -10,
  -20, -10, -10, -5, -5, -10, -10, -20
];

const TABLES: Record<string, number[]> = {
  p: PAWN_TABLE,
  n: KNIGHT_TABLE,
  b: BISHOP_TABLE,
  r: ROOK_TABLE,
  q: QUEEN_TABLE
};

function evaluateBoard(chess: Chess): number {
  if (chess.isCheckmate()) {
    return -99999;
  }
  if (chess.isDraw() || chess.isStalemate() || chess.isInsufficientMaterial()) {
    return 0;
  }
  let score = 0;
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const val = PIECE_VALUES[piece.type] || 0;
      const table = TABLES[piece.type];
      const tableVal = table ? (piece.color === 'w' ? table[r * 8 + c] : table[(7 - r) * 8 + c]) : 0;
      const pieceScore = val + tableVal;
      if (piece.color === 'w') {
        score += pieceScore;
      } else {
        score -= pieceScore;
      }
    }
  }
  return chess.turn() === 'w' ? score : -score;
}

function negamax(chess: Chess, depth: number, alpha: number, beta: number): number {
  if (depth === 0 || chess.isGameOver()) {
    return evaluateBoard(chess);
  }
  let max = -Infinity;
  const moves = chess.moves({ verbose: true });
  moves.sort((a, b) => (b.captured ? 1 : 0) - (a.captured ? 1 : 0));

  for (const move of moves) {
    chess.move(move);
    const score = -negamax(chess, depth - 1, -beta, -alpha);
    chess.undo();
    if (score > max) max = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return max;
}

function chooseComputerMove(chess: Chess, level: string) {
  const legalMoves = chess.moves({ verbose: true });
  if (legalMoves.length === 0) return null;
  if (legalMoves.length === 1) return legalMoves[0];

  if (level === 'simple') {
    if (Math.random() < 0.35) {
      return legalMoves[Math.floor(Math.random() * legalMoves.length)];
    }
  }

  const depth = level === 'hard' ? 3 : (level === 'medium' ? 2 : 1);
  let bestMove = legalMoves[0];
  let bestScore = -Infinity;

  legalMoves.sort((a, b) => (b.captured ? 1 : 0) - (a.captured ? 1 : 0));

  for (const move of legalMoves) {
    chess.move(move);
    const score = -negamax(chess, depth - 1, -Infinity, Infinity);
    chess.undo();

    const noise = level === 'simple' ? (Math.random() * 50 - 25) : (level === 'medium' ? (Math.random() * 16 - 8) : 0);
    if (score + noise > bestScore) {
      bestScore = score + noise;
      bestMove = move;
    }
  }

  return bestMove;
}

// -----------------------------------------------------------------------------
// In-Memory State Models
// -----------------------------------------------------------------------------
interface PlayerSession {
  sessionId: string;
  playerName: string;
  mode: 'idle' | 'single_player' | 'hosting' | 'joining';
  roomCode: string;
  singlePlayer?: {
    level: string;
    humanSide: 'white' | 'black';
    chess: Chess;
    selected: number;
    lastMove: { from: number; to: number } | null;
    moved: Array<{ from: number; to: number }>;
    thinking: boolean;
    gameOver: boolean;
    gameOverHeadline: string;
    gameOverDetail: string;
    localWon: boolean;
    rematchOffered: boolean;
  };
  error: string;
  pending: string;
}

interface Room {
  code: string;
  hostSessionId: string;
  guestSessionId: string | null;
  hostName: string;
  guestName: string;
  chess: Chess;
  lastMove: { from: number; to: number } | null;
  moved: Array<{ from: number; to: number }>;
  gameOver: boolean;
  gameOverHeadline: string;
  gameOverDetail: string;
  winnerSide: 'white' | 'black' | 'draw' | null;
  rematchOffers: Set<string>;
  selected: Record<string, number>;
  latestReaction?: { emoji: string; text?: string; from: string; id: number };
}

const sessions = new Map<string, PlayerSession>();
const rooms = new Map<string, Room>();
const sseListeners = new Map<string, Set<Response>>();

function registerSse(sessionId: string, res: Response) {
  if (!sseListeners.has(sessionId)) {
    sseListeners.set(sessionId, new Set());
  }
  sseListeners.get(sessionId)!.add(res);

  res.on('close', () => {
    const set = sseListeners.get(sessionId);
    if (set) {
      set.delete(res);
      if (set.size === 0) sseListeners.delete(sessionId);
    }
  });
}

function broadcastUpdate(session: PlayerSession) {
  const sendToSession = (sid: string) => {
    const s = sessions.get(sid);
    if (!s) return;
    const listeners = sseListeners.get(sid);
    if (listeners) {
      const data = JSON.stringify(buildStateJson(s));
      listeners.forEach(res => {
        try {
          res.write(`data: ${data}\n\n`);
        } catch {
          // connection closed
        }
      });
    }
  };

  sendToSession(session.sessionId);

  if (session.roomCode && rooms.has(session.roomCode)) {
    const room = rooms.get(session.roomCode)!;
    if (room.hostSessionId !== session.sessionId) sendToSession(room.hostSessionId);
    if (room.guestSessionId && room.guestSessionId !== session.sessionId) sendToSession(room.guestSessionId);
  }
}

function getSession(sessionId: string): PlayerSession {
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      sessionId,
      playerName: 'Player',
      mode: 'idle',
      roomCode: '',
      error: '',
      pending: ''
    };
    sessions.set(sessionId, session);
  }
  return session;
}

function generateRoomCode(): string {
  let code = '';
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.has(code));
  return code;
}

function cleanName(name?: string, fallback = 'Player'): string {
  if (!name) return fallback;
  const trimmed = name.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 20);
}

// -----------------------------------------------------------------------------
// State Builder
// -----------------------------------------------------------------------------
function buildStateJson(session: PlayerSession) {
  const startingChess = new Chess();

  if (session.mode === 'idle') {
    return {
      mode: 'idle',
      screen: 'home',
      playerName: session.playerName,
      localName: session.playerName,
      connected: false,
      roomCode: '',
      localAddress: '',
      pending: session.pending,
      error: session.error,
      status: '',
      finished: false,
      localSide: 'white',
      remoteName: 'Opponent',
      singlePlayer: false,
      thinking: false,
      yourTurn: false,
      gameOver: false,
      gameOverHeadline: '',
      gameOverDetail: '',
      localWon: false,
      rematchOffered: false,
      checkSquare: -1,
      selected: -1,
      fen: startingChess.fen(),
      squares: getSquares(startingChess),
      legalTargets: [],
      lastMove: null,
      moved: [],
      history: [],
      material: getMaterialSummary(startingChess),
      evalScore: 0
    };
  }

  if (session.mode === 'single_player' && session.singlePlayer) {
    const sp = session.singlePlayer;
    const chess = sp.chess;
    const isHumanTurn = (chess.turn() === 'w' && sp.humanSide === 'white') || (chess.turn() === 'b' && sp.humanSide === 'black');
    const levelObj = LEVELS.find(l => l.id === sp.level) || LEVELS[1];
    const remoteName = `Computer (${levelObj.label})`;

    let legalTargets: number[] = [];
    if (sp.selected >= 0 && isHumanTurn && !sp.gameOver) {
      const sq = indexToSquare(sp.selected);
      const moves = chess.moves({ square: sq as any, verbose: true });
      const targetSet = new Set<number>();
      for (const m of moves) {
        targetSet.add(squareToIndex(m.to));
      }
      legalTargets = Array.from(targetSet);
    }

    const checkSq = (chess.inCheck() && !chess.isGameOver())
      ? findKingSquare(chess, chess.turn())
      : -1;

    let status = '';
    if (sp.gameOver) {
      status = sp.gameOverDetail;
    } else if (isHumanTurn) {
      status = `Your move  -  you play ${sp.humanSide}`;
    } else {
      status = `Waiting for ${remoteName} to move`;
    }

    const mat = getMaterialSummary(chess);
    const rawEval = evaluateBoard(chess);
    const evalScore = chess.turn() === 'w' ? rawEval / 100 : -rawEval / 100;

    return {
      mode: 'single_player',
      screen: 'game',
      playerName: session.playerName,
      localName: session.playerName,
      connected: true,
      roomCode: '',
      localAddress: '',
      pending: session.pending,
      error: session.error,
      status,
      finished: sp.gameOver,
      localSide: sp.humanSide,
      remoteName,
      singlePlayer: true,
      thinking: sp.thinking,
      yourTurn: isHumanTurn && !sp.gameOver,
      gameOver: sp.gameOver,
      gameOverHeadline: sp.gameOverHeadline,
      gameOverDetail: sp.gameOverDetail,
      localWon: sp.localWon,
      rematchOffered: sp.rematchOffered,
      checkSquare: checkSq,
      selected: sp.selected,
      fen: chess.fen(),
      squares: getSquares(chess),
      legalTargets,
      lastMove: sp.lastMove,
      moved: sp.moved,
      history: chess.history(),
      material: mat,
      evalScore: parseFloat(evalScore.toFixed(1))
    };
  }

  // Room mode (hosting or joining)
  if (session.roomCode && rooms.has(session.roomCode)) {
    const room = rooms.get(session.roomCode)!;
    const isHost = room.hostSessionId === session.sessionId;
    const localSide: 'white' | 'black' = isHost ? 'white' : 'black';
    const remoteName = isHost
      ? (room.guestSessionId ? room.guestName : 'Waiting for friend...')
      : room.hostName;
    const connected = Boolean(room.guestSessionId);

    const chess = room.chess;
    const isLocalTurn = connected && !room.gameOver && (
      (chess.turn() === 'w' && localSide === 'white') ||
      (chess.turn() === 'b' && localSide === 'black')
    );

    const sel = room.selected[session.sessionId] ?? -1;
    let legalTargets: number[] = [];
    if (sel >= 0 && isLocalTurn) {
      const sq = indexToSquare(sel);
      const moves = chess.moves({ square: sq as any, verbose: true });
      const targetSet = new Set<number>();
      for (const m of moves) {
        targetSet.add(squareToIndex(m.to));
      }
      legalTargets = Array.from(targetSet);
    }

    const checkSq = (chess.inCheck() && !chess.isGameOver())
      ? findKingSquare(chess, chess.turn())
      : -1;

    let status = '';
    if (!connected) {
      status = `Room #${room.code} opened. Share link or code with a friend!`;
    } else if (room.gameOver) {
      status = room.gameOverDetail;
    } else if (isLocalTurn) {
      status = `Your move  -  you play ${localSide}`;
    } else {
      status = `Waiting for ${remoteName} to move`;
    }

    const localWon = room.winnerSide === localSide;
    const otherSessionId = isHost ? room.guestSessionId : room.hostSessionId;
    const rematchOffered = otherSessionId ? room.rematchOffers.has(otherSessionId) : false;

    const mat = getMaterialSummary(chess);
    const rawEval = evaluateBoard(chess);
    const evalScore = chess.turn() === 'w' ? rawEval / 100 : -rawEval / 100;

    return {
      mode: session.mode,
      screen: 'game',
      playerName: session.playerName,
      localName: session.playerName,
      connected,
      roomCode: room.code,
      localAddress: 'Online Room',
      pending: session.pending,
      error: session.error,
      status,
      finished: room.gameOver,
      localSide,
      remoteName,
      singlePlayer: false,
      thinking: false,
      yourTurn: isLocalTurn,
      gameOver: room.gameOver,
      gameOverHeadline: room.gameOverHeadline,
      gameOverDetail: room.gameOverDetail,
      localWon,
      rematchOffered,
      checkSquare: checkSq,
      selected: sel,
      fen: chess.fen(),
      squares: getSquares(chess),
      legalTargets,
      lastMove: room.lastMove,
      moved: room.moved,
      history: chess.history(),
      material: mat,
      evalScore: parseFloat(evalScore.toFixed(1)),
      reaction: room.latestReaction
    };
  }

  return {
    mode: 'idle',
    screen: 'home',
    playerName: session.playerName,
    localName: session.playerName,
    connected: false,
    roomCode: '',
    localAddress: '',
    pending: session.pending,
    error: session.error,
    status: '',
    finished: false,
    localSide: 'white',
    remoteName: 'Opponent',
    singlePlayer: false,
    thinking: false,
    yourTurn: false,
    gameOver: false,
    gameOverHeadline: '',
    gameOverDetail: '',
    localWon: false,
    rematchOffered: false,
    checkSquare: -1,
    selected: -1,
    fen: startingChess.fen(),
    squares: getSquares(startingChess),
    legalTargets: [],
    lastMove: null,
    moved: [],
    history: [],
    material: getMaterialSummary(startingChess),
    evalScore: 0
  };
}

// -----------------------------------------------------------------------------
// Computer Thinking Execution
// -----------------------------------------------------------------------------
function triggerComputerMove(session: PlayerSession) {
  if (!session.singlePlayer) return;
  const sp = session.singlePlayer;
  const chess = sp.chess;
  const levelObj = LEVELS.find(l => l.id === sp.level) || LEVELS[1];

  const computerTurn = (chess.turn() === 'w' && sp.humanSide === 'black') || (chess.turn() === 'b' && sp.humanSide === 'white');
  if (!computerTurn || sp.gameOver) return;

  sp.thinking = true;
  broadcastUpdate(session);

  const thinkTime = levelObj.minimumThinkMillis + Math.floor(Math.random() * 40);

  setTimeout(() => {
    if (!session.singlePlayer || session.singlePlayer !== sp || sp.gameOver) return;
    try {
      const bestMove = chooseComputerMove(chess, sp.level);
      if (bestMove) {
        const fromIdx = squareToIndex(bestMove.from);
        const toIdx = squareToIndex(bestMove.to);
        const result = chess.move(bestMove);
        if (result) {
          sp.lastMove = { from: fromIdx, to: toIdx };
          sp.moved = getRelocations(fromIdx, toIdx, result.flags, result.color);
        }
      }
    } catch (err) {
      console.error('Computer move error:', err);
    }
    sp.thinking = false;

    if (chess.isGameOver()) {
      sp.gameOver = true;
      if (chess.isCheckmate()) {
        const won = (chess.turn() === 'w' && sp.humanSide === 'black') || (chess.turn() === 'b' && sp.humanSide === 'white');
        sp.localWon = won;
        sp.gameOverHeadline = won ? 'Checkmate - you won' : 'Checkmate - you lost';
        sp.gameOverDetail = won ? `Computer (${levelObj.label}) is checkmated.` : 'You are checkmated.';
      } else if (chess.isStalemate()) {
        sp.gameOverHeadline = 'Draw by stalemate';
        sp.gameOverDetail = 'Stalemate - no legal moves available.';
        sp.localWon = false;
      } else if (chess.isInsufficientMaterial()) {
        sp.gameOverHeadline = 'Draw - not enough material';
        sp.gameOverDetail = 'Neither side can deliver checkmate.';
        sp.localWon = false;
      } else {
        sp.gameOverHeadline = 'Draw';
        sp.gameOverDetail = 'Game drawn by repetition or 50-move rule.';
        sp.localWon = false;
      }
    }

    broadcastUpdate(session);
  }, thinkTime);
}

// -----------------------------------------------------------------------------
// API Routes
// -----------------------------------------------------------------------------
app.get('/api/levels', (_req: Request, res: Response) => {
  res.json(LEVELS);
});

app.get('/api/state', (req: Request, res: Response) => {
  const session = getSession(req.cookies.sessionId);
  res.json(buildStateJson(session));
});

// Server-Sent Events (SSE) stream for zero-latency live updates
app.get('/api/events', (req: Request, res: Response) => {
  const sessionId = req.cookies.sessionId;
  const session = getSession(sessionId);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  registerSse(sessionId, res);

  // Send initial snapshot
  const initial = JSON.stringify(buildStateJson(session));
  res.write(`data: ${initial}\n\n`);
});

app.post('/api/single-player', (req: Request, res: Response) => {
  const session = getSession(req.cookies.sessionId);
  const { level, colour, name } = req.body || {};
  session.playerName = cleanName(name, session.playerName);
  session.mode = 'single_player';
  session.roomCode = '';
  session.error = '';
  session.pending = '';

  const humanSide: 'white' | 'black' = String(colour).toLowerCase() === 'black' ? 'black' : 'white';
  const chosenLevel = LEVELS.some(l => l.id === level) ? level : 'medium';
  const chess = new Chess();

  session.singlePlayer = {
    level: chosenLevel,
    humanSide,
    chess,
    selected: -1,
    lastMove: null,
    moved: [],
    thinking: false,
    gameOver: false,
    gameOverHeadline: '',
    gameOverDetail: '',
    localWon: false,
    rematchOffered: false
  };

  if (humanSide === 'black') {
    triggerComputerMove(session);
  }

  const state = buildStateJson(session);
  broadcastUpdate(session);
  res.json(state);
});

app.post('/api/host', (req: Request, res: Response) => {
  const session = getSession(req.cookies.sessionId);
  const { name } = req.body || {};
  session.playerName = cleanName(name, session.playerName);

  const roomCode = generateRoomCode();
  const room: Room = {
    code: roomCode,
    hostSessionId: session.sessionId,
    guestSessionId: null,
    hostName: session.playerName,
    guestName: 'Opponent',
    chess: new Chess(),
    lastMove: null,
    moved: [],
    gameOver: false,
    gameOverHeadline: '',
    gameOverDetail: '',
    winnerSide: null,
    rematchOffers: new Set(),
    selected: {}
  };

  rooms.set(roomCode, room);
  session.mode = 'hosting';
  session.roomCode = roomCode;
  session.singlePlayer = undefined;
  session.error = '';
  session.pending = '';

  const state = buildStateJson(session);
  broadcastUpdate(session);
  res.json(state);
});

app.post('/api/join', (req: Request, res: Response) => {
  const session = getSession(req.cookies.sessionId);
  const { code, name } = req.body || {};
  session.playerName = cleanName(name, session.playerName);

  const trimmedCode = String(code || '').trim();
  if (!/^\d{4}$/.test(trimmedCode)) {
    session.error = 'That room code is not four digits.';
    return res.json(buildStateJson(session));
  }

  const room = rooms.get(trimmedCode);
  if (!room) {
    session.error = `No room ${trimmedCode} found. Check the code.`;
    return res.json(buildStateJson(session));
  }

  if (room.guestSessionId && room.guestSessionId !== session.sessionId) {
    session.error = 'That room already has two players.';
    return res.json(buildStateJson(session));
  }

  room.guestSessionId = session.sessionId;
  room.guestName = session.playerName;
  session.mode = 'joining';
  session.roomCode = trimmedCode;
  session.singlePlayer = undefined;
  session.error = '';
  session.pending = '';

  const state = buildStateJson(session);
  broadcastUpdate(session);
  res.json(state);
});

app.post('/api/join-direct', (req: Request, res: Response) => {
  const session = getSession(req.cookies.sessionId);
  const { code, host, name } = req.body || {};
  session.playerName = cleanName(name, session.playerName);

  const targetCode = String(code || host || '').trim().replace(/\D/g, '').slice(0, 4);
  if (!/^\d{4}$/.test(targetCode)) {
    session.error = 'That room code is not four digits.';
    return res.json(buildStateJson(session));
  }

  const room = rooms.get(targetCode);
  if (!room) {
    session.error = `No room ${targetCode} found. Check the code.`;
    return res.json(buildStateJson(session));
  }

  room.guestSessionId = session.sessionId;
  room.guestName = session.playerName;
  session.mode = 'joining';
  session.roomCode = targetCode;
  session.singlePlayer = undefined;
  session.error = '';
  session.pending = '';

  const state = buildStateJson(session);
  broadcastUpdate(session);
  res.json(state);
});

app.post('/api/select', (req: Request, res: Response) => {
  const session = getSession(req.cookies.sessionId);
  const { square } = req.body || {};
  const sqIdx = typeof square === 'number' ? square : -1;

  if (session.mode === 'single_player' && session.singlePlayer) {
    const sp = session.singlePlayer;
    if (sqIdx < 0 || sqIdx === sp.selected) {
      sp.selected = -1;
    } else {
      const piece = sp.chess.board()[sqIdx >> 3]?.[sqIdx & 7];
      const playerColor = sp.humanSide === 'white' ? 'w' : 'b';
      if (piece && piece.color === playerColor) {
        sp.selected = sqIdx;
      } else {
        sp.selected = -1;
      }
    }
  } else if (session.roomCode && rooms.has(session.roomCode)) {
    const room = rooms.get(session.roomCode)!;
    const isHost = room.hostSessionId === session.sessionId;
    const localColor = isHost ? 'w' : 'b';
    const current = room.selected[session.sessionId] ?? -1;

    if (sqIdx < 0 || sqIdx === current) {
      room.selected[session.sessionId] = -1;
    } else {
      const piece = room.chess.board()[sqIdx >> 3]?.[sqIdx & 7];
      if (piece && piece.color === localColor) {
        room.selected[session.sessionId] = sqIdx;
      } else {
        room.selected[session.sessionId] = -1;
      }
    }
  }

  res.json(buildStateJson(session));
});

app.post('/api/move', (req: Request, res: Response) => {
  const session = getSession(req.cookies.sessionId);
  const { from, to, promotion } = req.body || {};
  const fromIdx = typeof from === 'number' ? from : -1;
  const toIdx = typeof to === 'number' ? to : -1;

  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) {
    return res.status(400).json({ error: 'Invalid move coordinates' });
  }

  const fromSq = indexToSquare(fromIdx);
  const toSq = indexToSquare(toIdx);
  const promo = promotion ? String(promotion).toLowerCase().charAt(0) : undefined;

  // Auto-initialize if session was idle
  if (session.mode !== 'single_player' && (!session.roomCode || !rooms.has(session.roomCode))) {
    session.mode = 'single_player';
    const chess = new Chess();
    session.singlePlayer = {
      level: 'medium',
      humanSide: 'white',
      chess,
      selected: -1,
      lastMove: null,
      moved: [],
      thinking: false,
      gameOver: false,
      gameOverHeadline: '',
      gameOverDetail: '',
      localWon: false,
      rematchOffered: false
    };
  }

  if (session.mode === 'single_player' && session.singlePlayer) {
    const sp = session.singlePlayer;
    const chess = sp.chess;
    const isHumanTurn = (chess.turn() === 'w' && sp.humanSide === 'white') || (chess.turn() === 'b' && sp.humanSide === 'black');

    if (!isHumanTurn || sp.gameOver || sp.thinking) {
      return res.status(400).json({ error: 'Not your turn' });
    }

    try {
      const result = chess.move({
        from: fromSq as any,
        to: toSq as any,
        promotion: promo as any
      });
      if (!result) {
        return res.status(400).json({ error: 'Illegal move' });
      }

      sp.selected = -1;
      sp.lastMove = { from: fromIdx, to: toIdx };
      sp.moved = getRelocations(fromIdx, toIdx, result.flags, result.color);

      if (chess.isGameOver()) {
        sp.gameOver = true;
        const levelObj = LEVELS.find(l => l.id === sp.level) || LEVELS[1];
        if (chess.isCheckmate()) {
          sp.localWon = true;
          sp.gameOverHeadline = 'Checkmate - you won!';
          sp.gameOverDetail = `Computer (${levelObj.label}) is checkmated.`;
        } else if (chess.isStalemate()) {
          sp.gameOverHeadline = 'Draw by stalemate';
          sp.gameOverDetail = 'Stalemate - no legal moves available.';
          sp.localWon = false;
        } else if (chess.isInsufficientMaterial()) {
          sp.gameOverHeadline = 'Draw - not enough material';
          sp.gameOverDetail = 'Neither side has sufficient mating material.';
          sp.localWon = false;
        } else {
          sp.gameOverHeadline = 'Draw';
          sp.gameOverDetail = 'Game drawn by repetition or 50-move rule.';
          sp.localWon = false;
        }
      } else {
        triggerComputerMove(session);
      }
    } catch (err: any) {
      return res.status(400).json({ error: err.message || 'Illegal move' });
    }

    const state = buildStateJson(session);
    broadcastUpdate(session);
    return res.json(state);
  }

  // Room mode
  if (session.roomCode && rooms.has(session.roomCode)) {
    const room = rooms.get(session.roomCode)!;
    const isHost = room.hostSessionId === session.sessionId;
    const isGuest = room.guestSessionId === session.sessionId;
    if (!isHost && !isGuest) {
      return res.status(400).json({ error: 'Not in room' });
    }

    const localColor = isHost ? 'w' : 'b';
    const chess = room.chess;

    if (chess.turn() !== localColor || room.gameOver || !room.guestSessionId) {
      return res.status(400).json({ error: 'Not your turn' });
    }

    try {
      const result = chess.move({
        from: fromSq as any,
        to: toSq as any,
        promotion: promo as any
      });
      if (!result) {
        return res.status(400).json({ error: 'Illegal move' });
      }

      room.selected[session.sessionId] = -1;
      room.lastMove = { from: fromIdx, to: toIdx };
      room.moved = getRelocations(fromIdx, toIdx, result.flags, result.color);

      if (chess.isGameOver()) {
        room.gameOver = true;
        if (chess.isCheckmate()) {
          room.winnerSide = localColor === 'w' ? 'white' : 'black';
          room.gameOverHeadline = `${isHost ? room.hostName : room.guestName} won by checkmate!`;
          room.gameOverDetail = `Checkmate! ${isHost ? room.guestName : room.hostName} is checkmated.`;
        } else if (chess.isStalemate()) {
          room.winnerSide = 'draw';
          room.gameOverHeadline = 'Draw by stalemate';
          room.gameOverDetail = 'Stalemate - no legal moves available.';
        } else if (chess.isInsufficientMaterial()) {
          room.winnerSide = 'draw';
          room.gameOverHeadline = 'Draw - not enough material';
          room.gameOverDetail = 'Neither side can deliver checkmate.';
        } else {
          room.winnerSide = 'draw';
          room.gameOverHeadline = 'Draw';
          room.gameOverDetail = 'Game drawn by repetition or 50-move rule.';
        }
      }
    } catch (err: any) {
      return res.status(400).json({ error: err.message || 'Illegal move' });
    }

    broadcastUpdate(session);
    return res.json(buildStateJson(session));
  }

  res.status(400).json({ error: 'No active game' });
});

app.post('/api/undo', (req: Request, res: Response) => {
  const session = getSession(req.cookies.sessionId);
  if (session.mode === 'single_player' && session.singlePlayer && !session.singlePlayer.gameOver) {
    const sp = session.singlePlayer;
    const isHumanTurn = (sp.chess.turn() === 'w' && sp.humanSide === 'white') || (sp.chess.turn() === 'b' && sp.humanSide === 'black');
    if (isHumanTurn) {
      sp.chess.undo(); // undo bot move
      sp.chess.undo(); // undo human move
    } else {
      sp.chess.undo();
    }
    const history = sp.chess.history({ verbose: true });
    if (history.length > 0) {
      const last = history[history.length - 1];
      sp.lastMove = { from: squareToIndex(last.from), to: squareToIndex(last.to) };
    } else {
      sp.lastMove = null;
    }
    sp.moved = [];
    sp.thinking = false;
    broadcastUpdate(session);
  }
  res.json(buildStateJson(session));
});

app.get('/api/hint', (req: Request, res: Response) => {
  const session = getSession(req.cookies.sessionId);
  let chess: Chess | null = null;
  if (session.mode === 'single_player' && session.singlePlayer) {
    chess = session.singlePlayer.chess;
  } else if (session.roomCode && rooms.has(session.roomCode)) {
    chess = rooms.get(session.roomCode)!.chess;
  }
  if (!chess || chess.isGameOver()) {
    return res.json({ hint: null });
  }
  const best = chooseComputerMove(chess, 'hard');
  if (best) {
    return res.json({
      hint: {
        from: best.from,
        to: best.to,
        fromIdx: squareToIndex(best.from),
        toIdx: squareToIndex(best.to),
        san: best.san
      }
    });
  }
  res.json({ hint: null });
});

app.post('/api/reaction', (req: Request, res: Response) => {
  const session = getSession(req.cookies.sessionId);
  const { emoji, text } = req.body || {};
  if (session.roomCode && rooms.has(session.roomCode)) {
    const room = rooms.get(session.roomCode)!;
    room.latestReaction = {
      emoji: String(emoji || '♟️'),
      text: text ? String(text) : undefined,
      from: session.playerName,
      id: Date.now()
    };
    broadcastUpdate(session);
  }
  res.json({ ok: true });
});

app.post('/api/resign', (req: Request, res: Response) => {
  const session = getSession(req.cookies.sessionId);
  if (session.mode === 'single_player' && session.singlePlayer) {
    const sp = session.singlePlayer;
    sp.gameOver = true;
    sp.localWon = false;
    sp.gameOverHeadline = 'You resigned';
    sp.gameOverDetail = sp.humanSide === 'white' ? 'Black wins.' : 'White wins.';
  } else if (session.roomCode && rooms.has(session.roomCode)) {
    const room = rooms.get(session.roomCode)!;
    const isHost = room.hostSessionId === session.sessionId;
    room.gameOver = true;
    room.winnerSide = isHost ? 'black' : 'white';
    room.gameOverHeadline = `${isHost ? room.hostName : room.guestName} resigned`;
    room.gameOverDetail = `${isHost ? room.guestName : room.hostName} wins by resignation.`;
  }
  broadcastUpdate(session);
  res.json(buildStateJson(session));
});

app.post('/api/rematch', (req: Request, res: Response) => {
  const session = getSession(req.cookies.sessionId);
  if (session.mode === 'single_player' && session.singlePlayer) {
    const sp = session.singlePlayer;
    const newSide = sp.humanSide === 'white' ? 'black' : 'white';
    const chess = new Chess();
    session.singlePlayer = {
      level: sp.level,
      humanSide: newSide,
      chess,
      selected: -1,
      lastMove: null,
      moved: [],
      thinking: false,
      gameOver: false,
      gameOverHeadline: '',
      gameOverDetail: '',
      localWon: false,
      rematchOffered: false
    };
    if (newSide === 'black') {
      triggerComputerMove(session);
    }
  } else if (session.roomCode && rooms.has(session.roomCode)) {
    const room = rooms.get(session.roomCode)!;
    room.rematchOffers.add(session.sessionId);

    if (room.guestSessionId && room.rematchOffers.has(room.hostSessionId) && room.rematchOffers.has(room.guestSessionId)) {
      const oldHost = room.hostSessionId;
      const oldGuest = room.guestSessionId;
      const oldHostName = room.hostName;
      const oldGuestName = room.guestName;
      room.hostSessionId = oldGuest;
      room.guestSessionId = oldHost;
      room.hostName = oldGuestName;
      room.guestName = oldHostName;

      room.chess = new Chess();
      room.lastMove = null;
      room.moved = [];
      room.gameOver = false;
      room.gameOverHeadline = '';
      room.gameOverDetail = '';
      room.winnerSide = null;
      room.rematchOffers.clear();
      room.selected = {};
    }
  }
  broadcastUpdate(session);
  res.json(buildStateJson(session));
});

app.post('/api/leave', (req: Request, res: Response) => {
  const session = getSession(req.cookies.sessionId);
  if (session.roomCode && rooms.has(session.roomCode)) {
    const room = rooms.get(session.roomCode)!;
    if (room.hostSessionId === session.sessionId) {
      if (room.guestSessionId) {
        room.gameOver = true;
        room.gameOverHeadline = 'Host left the room';
        room.gameOverDetail = 'The host left the game.';
      } else {
        rooms.delete(session.roomCode);
      }
    } else if (room.guestSessionId === session.sessionId) {
      room.guestSessionId = null;
      room.gameOver = true;
      room.gameOverHeadline = 'Opponent left';
      room.gameOverDetail = 'Your opponent disconnected.';
    }
  }

  session.mode = 'idle';
  session.roomCode = '';
  session.singlePlayer = undefined;
  session.error = '';
  session.pending = '';

  broadcastUpdate(session);
  res.json(buildStateJson(session));
});

// Fallback to index.html for any SPA routes
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Chess Game server running on http://0.0.0.0:${PORT}`);
});
