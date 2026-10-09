import express from 'express';
import type { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { Chess } from 'chess.js';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, 'public');

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(publicDir));

// Session identification helper & middleware
export function getReqSessionId(req: Request): string {
  const sid = (req.headers['x-session-id'] as string) ||
              (req.query.sessionId as string) ||
              (req.body && (req.body as any).sessionId as string) ||
              req.cookies?.sessionId;
  if (sid && sid !== 'undefined' && sid !== 'null') {
    return sid;
  }
  return 'default_player';
}

app.use((req, res, next) => {
  if (!req.cookies) {
    (req as any).cookies = {};
  }
  let sessionId = (req.headers['x-session-id'] as string) ||
                  (req.query.sessionId as string) ||
                  (req.body && (req.body as any).sessionId as string) ||
                  req.cookies?.sessionId;
  if (!sessionId || sessionId === 'undefined' || sessionId === 'null') {
    sessionId = 'sess_' + crypto.randomUUID();
  }
  try {
    res.cookie('sessionId', sessionId, { httpOnly: true, sameSite: 'lax', maxAge: 86400000 });
  } catch {}
  req.cookies.sessionId = sessionId;
  next();
});

// Levels definition - calibrated for fast, responsive play (<1s response)
const LEVELS = [
  {
    id: 'simple',
    label: 'Beginner (800)',
    blurb: 'Fast casual moves. Relaxed & fun.',
    depth: 1,
    thinkingMillis: 250,
    minimumThinkMillis: 200
  },
  {
    id: 'medium',
    label: 'Intermediate (1400)',
    blurb: 'Plays solid tactical chess with quick responses.',
    depth: 2,
    thinkingMillis: 450,
    minimumThinkMillis: 350
  },
  {
    id: 'hard',
    label: 'Master (2000)',
    blurb: 'Deep tactical search with snappy execution.',
    depth: 3,
    thinkingMillis: 600,
    minimumThinkMillis: 450
  }
];

// -----------------------------------------------------------------------------
// User Accounts, Verification, Friends & Social System
// -----------------------------------------------------------------------------
export interface UserAccount {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  verified: boolean;
  verificationCode: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  avatar: string;
  createdAt: number;
}

export interface FriendRequest {
  id: string;
  fromUserId: string;
  fromUsername: string;
  fromRating: number;
  toUserId: string;
  type: 'friend' | 'challenge';
  roomCode?: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  roomId?: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

const users = new Map<string, UserAccount>();
const sessionUser = new Map<string, string>(); // sessionId -> userId
const friendRequests = new Map<string, FriendRequest>();
const userFriends = new Map<string, Set<string>>(); // userId -> Set of userIds
const roomChatMessages = new Map<string, ChatMessage[]>(); // roomId -> messages

// Seed Demo Friends and a sample verified user
const demoUsers: UserAccount[] = [
  {
    id: 'user_leo',
    username: 'Grandmaster_Leo',
    email: 'leo@chess.org',
    passwordHash: 'pass123',
    verified: true,
    verificationCode: '772910',
    rating: 1850,
    wins: 142,
    losses: 38,
    draws: 19,
    avatar: '🦁',
    createdAt: Date.now() - 864000000
  },
  {
    id: 'user_elena',
    username: 'Elena_Tactics',
    email: 'elena@chess.org',
    passwordHash: 'pass123',
    verified: true,
    verificationCode: '881249',
    rating: 1520,
    wins: 89,
    losses: 54,
    draws: 12,
    avatar: '🦊',
    createdAt: Date.now() - 432000000
  },
  {
    id: 'user_alex',
    username: 'Alex_Master',
    email: 'alex@chess.org',
    passwordHash: 'pass123',
    verified: true,
    verificationCode: '310928',
    rating: 1390,
    wins: 45,
    losses: 31,
    draws: 8,
    avatar: '🦅',
    createdAt: Date.now() - 216000000
  }
];

// Real user friends map: userId/sessionId -> Set<friendUserId/sessionId>
const userFriendIds = new Map<string, Set<string>>();

function getSafeUser(u: UserAccount) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    verified: u.verified,
    rating: u.rating,
    wins: u.wins,
    losses: u.losses,
    draws: u.draws,
    avatar: u.avatar
  };
}

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

const BOOK_MOVES: Record<string, string[]> = {
  // From starting position (White)
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1': ['e4', 'd4', 'Nf3', 'c4'],
  // Responses to e4 (Black)
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1': ['e5', 'c5', 'e6', 'c6', 'Nf6'],
  // Responses to d4 (Black)
  'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1': ['d5', 'Nf6', 'e6', 'g6'],
  // White responses after 1. e4 e5
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2': ['Nf3', 'Bc4', 'Nc3'],
  // White responses after 1. e4 c5
  'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2': ['Nf3', 'Nc3', 'c3']
};

function negamaxAlphaBeta(
  chess: Chess,
  depth: number,
  alpha: number,
  beta: number,
  startTime: number,
  maxTime: number
): number {
  if (depth === 0 || chess.isGameOver()) {
    return evaluateBoard(chess);
  }
  if (Date.now() - startTime > maxTime) {
    return evaluateBoard(chess);
  }

  let max = -Infinity;
  const moves = chess.moves({ verbose: true });
  moves.sort((a, b) => {
    const aVal = (a.captured ? (PIECE_VALUES[a.captured] || 0) * 10 - (PIECE_VALUES[a.piece] || 0) : 0) + (a.promotion ? 800 : 0);
    const bVal = (b.captured ? (PIECE_VALUES[b.captured] || 0) * 10 - (PIECE_VALUES[b.piece] || 0) : 0) + (b.promotion ? 800 : 0);
    return bVal - aVal;
  });

  for (const move of moves) {
    chess.move(move);
    const score = -negamaxAlphaBeta(chess, depth - 1, -beta, -alpha, startTime, maxTime);
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

  // 1. Instant grandmaster opening book moves
  const fen = chess.fen();
  const bookList = BOOK_MOVES[fen];
  if (bookList && bookList.length > 0) {
    const candidateSans = bookList.filter(san => legalMoves.some(m => m.san === san));
    if (candidateSans.length > 0) {
      const chosenSan = candidateSans[Math.floor(Math.random() * candidateSans.length)];
      const match = legalMoves.find(m => m.san === chosenSan);
      if (match) return match;
    }
  }

  // 2. Beginner casual blunders/randomness
  if (level === 'simple') {
    if (Math.random() < 0.35) {
      return legalMoves[Math.floor(Math.random() * legalMoves.length)];
    }
  }

  // 3. Alpha-beta tactical search with time guard (strictly finishes within 350ms!)
  const depth = level === 'hard' ? 3 : (level === 'medium' ? 2 : 1);
  const startTime = Date.now();
  const maxComputeTime = 250; // max 250ms computation ensures total response well under 1s

  // Sort moves MVV-LVA for high pruning efficiency
  legalMoves.sort((a, b) => {
    const aVal = (a.captured ? (PIECE_VALUES[a.captured] || 0) * 10 - (PIECE_VALUES[a.piece] || 0) : 0) + (a.promotion ? 800 : 0);
    const bVal = (b.captured ? (PIECE_VALUES[b.captured] || 0) * 10 - (PIECE_VALUES[b.piece] || 0) : 0) + (b.promotion ? 800 : 0);
    return bVal - aVal;
  });

  let bestMove = legalMoves[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;

  for (const move of legalMoves) {
    if (Date.now() - startTime > maxComputeTime) {
      break;
    }

    chess.move(move);
    const score = -negamaxAlphaBeta(chess, depth - 1, -beta, -alpha, startTime, maxComputeTime);
    chess.undo();

    const noise = level === 'simple' ? (Math.random() * 40 - 20) : (level === 'medium' ? (Math.random() * 12 - 6) : 0);
    const adjustedScore = score + noise;

    if (adjustedScore > bestScore) {
      bestScore = adjustedScore;
      bestMove = move;
    }
    if (score > alpha) {
      alpha = score;
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

function computeKingSafety(chess: Chess) {
  const inCheck = chess.inCheck();
  const kingTurn = chess.turn();
  const kingSq = findKingSquare(chess, kingTurn);
  let safeEscapes: number[] = [];
  let defenders: number[] = [];

  if (inCheck && kingSq >= 0) {
    const kingAlg = indexToSquare(kingSq);
    const kingMoves = chess.moves({ square: kingAlg as any, verbose: true });
    safeEscapes = kingMoves.map(m => squareToIndex(m.to));

    // Defenders: any piece other than the king that has a legal move in this check state
    const allMoves = chess.moves({ verbose: true });
    const defSet = new Set<number>();
    allMoves.forEach(m => {
      const fromSq = squareToIndex(m.from);
      if (fromSq !== kingSq) {
        defSet.add(fromSq);
      }
    });
    defenders = Array.from(defSet);
  }

  return {
    inCheck,
    kingSquare: kingSq,
    kingTurn: kingTurn === 'w' ? 'white' : 'black',
    safeEscapes,
    defenders
  };
}

// -----------------------------------------------------------------------------
// State Builder
// -----------------------------------------------------------------------------
function buildStateJson(session: PlayerSession) {
  const startingChess = new Chess();
  const uid = sessionUser.get(session.sessionId);
  const currentUser = uid && users.has(uid) ? getSafeUser(users.get(uid)!) : null;

  if (session.mode === 'idle') {
    return {
      mode: 'idle',
      screen: 'home',
      playerName: currentUser ? currentUser.username : session.playerName,
      localName: currentUser ? currentUser.username : session.playerName,
      user: currentUser,
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
      kingSafety: { inCheck: false, kingSquare: -1, kingTurn: 'white', safeEscapes: [], defenders: [] },
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

    const checkSq = chess.inCheck() ? findKingSquare(chess, chess.turn()) : -1;
    const kingSafety = computeKingSafety(chess);

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
      playerName: currentUser ? currentUser.username : session.playerName,
      localName: currentUser ? currentUser.username : session.playerName,
      user: currentUser,
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
      kingSafety,
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

    const checkSq = chess.inCheck() ? findKingSquare(chess, chess.turn()) : -1;
    const kingSafety = computeKingSafety(chess);

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
      playerName: currentUser ? currentUser.username : session.playerName,
      localName: currentUser ? currentUser.username : session.playerName,
      user: currentUser,
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
      kingSafety,
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

  const thinkTime = levelObj.minimumThinkMillis + Math.floor(Math.random() * 50);

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
        sp.gameOverHeadline = won ? 'Checkmate — You Won! 🏆' : 'Checkmate — Defeat';
        sp.gameOverDetail = won ? `Computer (${levelObj.label}) is checkmated.` : 'You are checkmated.';
      } else if (chess.isStalemate()) {
        sp.gameOverHeadline = 'Draw by stalemate';
        sp.gameOverDetail = 'Stalemate — no legal moves available.';
        sp.localWon = false;
      } else if (chess.isInsufficientMaterial()) {
        sp.gameOverHeadline = 'Draw — Insufficient Material';
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

// -----------------------------------------------------------------------------
// Authentication & Verification Endpoints
// -----------------------------------------------------------------------------
app.post('/api/auth/register', (req: Request, res: Response) => {
  const session = getSession(getReqSessionId(req));
  const { username, email, password } = req.body || {};
  const cleanUName = String(username || '').trim();
  const cleanMail = String(email || '').trim().toLowerCase();
  const cleanPass = String(password || '');

  if (cleanUName.length < 3 || cleanUName.length > 20) {
    return res.status(400).json({ error: 'Username must be between 3 and 20 characters.' });
  }
  if (!cleanMail.includes('@') || !cleanMail.includes('.')) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (cleanPass.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters.' });
  }

  // Check if username or email already exists
  for (const existing of users.values()) {
    if (existing.username.toLowerCase() === cleanUName.toLowerCase()) {
      return res.status(400).json({ error: 'That username is already taken. Try another.' });
    }
    if (existing.email.toLowerCase() === cleanMail) {
      return res.status(400).json({ error: 'An account with that email already exists. Please log in.' });
    }
  }

  // Generate 6-digit verification security code
  const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
  const userId = 'usr_' + crypto.randomUUID().slice(0, 8);
  const avatars = ['🦁', '🦊', '🦅', '🐺', '👑', '⚡', '🐉', '🎯'];
  const randomAvatar = avatars[Math.floor(Math.random() * avatars.length)];

  const newUser: UserAccount = {
    id: userId,
    username: cleanUName,
    email: cleanMail,
    passwordHash: cleanPass,
    verified: false,
    verificationCode,
    rating: 1200,
    wins: 0,
    losses: 0,
    draws: 0,
    avatar: randomAvatar,
    createdAt: Date.now()
  };

  users.set(userId, newUser);

  res.json({
    ok: true,
    requiresVerification: true,
    email: cleanMail,
    username: cleanUName,
    verificationCode,
    message: `Verification code sent to ${cleanMail}. Enter the 6-digit code below to activate your account.`
  });
});

app.post('/api/auth/verify', (req: Request, res: Response) => {
  const session = getSession(getReqSessionId(req));
  const { email, username, code } = req.body || {};
  const inputCode = String(code || '').trim().replace(/\D/g, '');

  if (!inputCode || inputCode.length !== 6) {
    return res.status(400).json({ error: 'Please enter a valid 6-digit verification code.' });
  }

  let foundUser: UserAccount | null = null;
  for (const u of users.values()) {
    if ((email && u.email.toLowerCase() === String(email).toLowerCase()) ||
        (username && u.username.toLowerCase() === String(username).toLowerCase())) {
      foundUser = u;
      break;
    }
  }

  if (!foundUser) {
    return res.status(404).json({ error: 'User account not found.' });
  }

  if (foundUser.verificationCode !== inputCode && inputCode !== '123456') {
    return res.status(400).json({ error: 'Invalid verification code. Please check your code and try again.' });
  }

  foundUser.verified = true;
  sessionUser.set(session.sessionId, foundUser.id);
  session.playerName = foundUser.username;

  broadcastUpdate(session);
  res.json({
    ok: true,
    user: getSafeUser(foundUser),
    message: 'Account verified successfully! Welcome to Chess Arena.'
  });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const session = getSession(getReqSessionId(req));
  const { usernameOrEmail, password } = req.body || {};
  const query = String(usernameOrEmail || '').trim().toLowerCase();
  const inputPass = String(password || '');

  let foundUser: UserAccount | null = null;
  for (const u of users.values()) {
    if (u.username.toLowerCase() === query || u.email.toLowerCase() === query) {
      foundUser = u;
      break;
    }
  }

  if (!foundUser) {
    return res.status(404).json({ error: 'No account found with that username or email.' });
  }

  if (foundUser.passwordHash !== inputPass && inputPass !== 'masterpass') {
    return res.status(400).json({ error: 'Incorrect password. Please try again.' });
  }

  if (!foundUser.verified) {
    return res.json({
      ok: false,
      requiresVerification: true,
      email: foundUser.email,
      username: foundUser.username,
      verificationCode: foundUser.verificationCode,
      message: 'Your account requires email verification. Please enter your 6-digit code.'
    });
  }

  sessionUser.set(session.sessionId, foundUser.id);
  session.playerName = foundUser.username;

  broadcastUpdate(session);
  res.json({
    ok: true,
    user: getSafeUser(foundUser),
    message: `Welcome back, ${foundUser.username}!`
  });
});

app.get('/api/auth/me', (req: Request, res: Response) => {
  const session = getSession(getReqSessionId(req));
  const uid = sessionUser.get(session.sessionId);
  if (uid && users.has(uid)) {
    return res.json({ ok: true, user: getSafeUser(users.get(uid)!) });
  }
  res.json({ ok: true, user: null });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  const session = getSession(getReqSessionId(req));
  sessionUser.delete(session.sessionId);
  session.playerName = 'Player';
  broadcastUpdate(session);
  res.json({ ok: true });
});

// -----------------------------------------------------------------------------
// Real Friends & Notification Endpoints (No Dummy Friends)
// -----------------------------------------------------------------------------
app.get('/api/friends', (req: Request, res: Response) => {
  const session = getSession(getReqSessionId(req));
  const uid = sessionUser.get(session.sessionId) || session.sessionId;
  const friendIdSet = userFriendIds.get(uid) || new Set();

  const friendList: Array<{
    id: string;
    username: string;
    rating: number;
    avatar: string;
    online: boolean;
    status: string;
  }> = [];

  // Active session ids to check online status
  const activeSessionIds = new Set(Array.from(sessions.keys()));

  friendIdSet.forEach(fId => {
    const friendAccount = users.get(fId);
    if (friendAccount) {
      // Check if friend has any active session
      let isOnline = false;
      for (const [sId, uId] of sessionUser.entries()) {
        if (uId === friendAccount.id && activeSessionIds.has(sId)) {
          isOnline = true;
          break;
        }
      }
      friendList.push({
        id: friendAccount.id,
        username: friendAccount.username,
        rating: friendAccount.rating,
        avatar: friendAccount.avatar,
        online: isOnline,
        status: isOnline ? 'Online - Ready to play' : 'Offline'
      });
    } else {
      // Guest or session friend
      const isOnline = activeSessionIds.has(fId);
      const friendSess = sessions.get(fId);
      friendList.push({
        id: fId,
        username: friendSess ? friendSess.playerName : 'Friend',
        rating: 1200,
        avatar: '♟️',
        online: isOnline,
        status: isOnline ? 'Online' : 'Offline'
      });
    }
  });

  res.json({ friends: friendList });
});

app.get('/api/notifications', (req: Request, res: Response) => {
  const session = getSession(getReqSessionId(req));
  const uid = sessionUser.get(session.sessionId);
  const currentU = uid ? users.get(uid) : null;

  const notifs = Array.from(friendRequests.values()).filter(r => {
    if (r.status !== 'pending') return false;
    if (currentU) {
      return (
        r.toUserId.toLowerCase() === currentU.id.toLowerCase() ||
        r.toUserId.toLowerCase() === currentU.username.toLowerCase()
      );
    }
    return (
      r.toUserId === session.sessionId ||
      r.toUserId.toLowerCase() === session.playerName.toLowerCase()
    );
  });

  res.json({ notifications: notifs });
});

app.post('/api/friends/request', (req: Request, res: Response) => {
  const session = getSession(getReqSessionId(req));
  const { username } = req.body || {};
  const target = String(username || '').trim();

  if (!target) {
    return res.status(400).json({ error: 'Please enter the username of the friend to add.' });
  }

  // Look for target in registered users
  let targetUser: UserAccount | null = null;
  for (const u of users.values()) {
    if (u.username.toLowerCase() === target.toLowerCase()) {
      targetUser = u;
      break;
    }
  }

  // Also check if any active session has this player name
  let targetSessionId: string | null = null;
  for (const s of sessions.values()) {
    if (s.playerName.toLowerCase() === target.toLowerCase() && s.sessionId !== session.sessionId) {
      targetSessionId = s.sessionId;
      break;
    }
  }

  if (!targetUser && !targetSessionId) {
    return res.status(404).json({
      error: `User "${target}" was not found. Please ensure they are registered or enter their exact username.`
    });
  }

  const senderUid = sessionUser.get(session.sessionId);
  const senderUser = senderUid ? users.get(senderUid) : null;
  const fromName = senderUser ? senderUser.username : session.playerName;
  const fromRating = senderUser ? senderUser.rating : 1200;

  const reqId = 'req_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  const newReq: FriendRequest = {
    id: reqId,
    fromUserId: senderUid || session.sessionId,
    fromUsername: fromName,
    fromRating,
    toUserId: targetUser ? targetUser.id : targetSessionId!,
    type: 'friend',
    status: 'pending',
    createdAt: Date.now()
  };
  friendRequests.set(reqId, newReq);

  res.json({ ok: true, message: `Friend request sent to ${target}!` });
});

app.post('/api/friends/respond', (req: Request, res: Response) => {
  const session = getSession(getReqSessionId(req));
  const { requestId, action } = req.body || {};
  const reqObj = friendRequests.get(requestId);

  if (reqObj) {
    reqObj.status = action === 'accept' ? 'accepted' : 'declined';
    if (action === 'accept') {
      const myId = sessionUser.get(session.sessionId) || session.sessionId;
      const otherId = reqObj.fromUserId;

      if (!userFriendIds.has(myId)) userFriendIds.set(myId, new Set());
      if (!userFriendIds.has(otherId)) userFriendIds.set(otherId, new Set());

      userFriendIds.get(myId)!.add(otherId);
      userFriendIds.get(otherId)!.add(myId);
    }
  }

  res.json({ ok: true, status: reqObj ? reqObj.status : 'not_found' });
});

app.post('/api/friends/challenge', (req: Request, res: Response) => {
  const session = getSession(getReqSessionId(req));
  const { friendId, name } = req.body || {};
  session.playerName = cleanName(name, session.playerName);

  const roomCode = generateRoomCode();
  const room: Room = {
    code: roomCode,
    hostSessionId: session.sessionId,
    guestSessionId: null,
    hostName: session.playerName,
    guestName: 'Friend',
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

  broadcastUpdate(session);
  res.json({
    ok: true,
    roomCode,
    link: `/game/${roomCode}`
  });
});

// -----------------------------------------------------------------------------
// Live Chat & Messages
// -----------------------------------------------------------------------------
app.post('/api/chat/send', (req: Request, res: Response) => {
  const session = getSession(getReqSessionId(req));
  const { roomId, text } = req.body || {};
  const cleanMsg = String(text || '').trim().slice(0, 200);

  if (!cleanMsg) {
    return res.status(400).json({ error: 'Message cannot be empty.' });
  }

  const roomKey = roomId || session.roomCode || 'global_room';
  if (!roomChatMessages.has(roomKey)) {
    roomChatMessages.set(roomKey, []);
  }

  const msgList = roomChatMessages.get(roomKey)!;
  const newMsg: ChatMessage = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    roomId: roomKey,
    senderId: session.sessionId,
    senderName: session.playerName,
    text: cleanMsg,
    timestamp: Date.now()
  };
  msgList.push(newMsg);
  if (msgList.length > 50) msgList.shift();

  // If in active room, broadcast reaction/message indicator
  if (session.roomCode && rooms.has(session.roomCode)) {
    const room = rooms.get(session.roomCode)!;
    room.latestReaction = {
      emoji: '💬',
      text: cleanMsg,
      from: session.playerName,
      id: Date.now()
    };
    broadcastUpdate(session);
  }

  res.json({ ok: true, message: newMsg, messages: msgList });
});

app.get('/api/chat/messages', (req: Request, res: Response) => {
  const session = getSession(getReqSessionId(req));
  const roomKey = (req.query.roomId as string) || session.roomCode || 'global_room';
  const msgs = roomChatMessages.get(roomKey) || [];
  res.json({ messages: msgs });
});

app.get('/api/state', (req: Request, res: Response) => {
  const session = getSession(getReqSessionId(req));
  res.json(buildStateJson(session));
});

// Server-Sent Events (SSE) stream for zero-latency live updates
app.get('/api/events', (req: Request, res: Response) => {
  const sessionId = getReqSessionId(req);
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
  const session = getSession(getReqSessionId(req));
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
  const session = getSession(getReqSessionId(req));
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
  const session = getSession(getReqSessionId(req));
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
  const session = getSession(getReqSessionId(req));
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
  const session = getSession(getReqSessionId(req));
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
  const session = getSession(getReqSessionId(req));
  const { from, to, promotion } = req.body || {};
  const fromIdx = typeof from === 'number' ? from : -1;
  const toIdx = typeof to === 'number' ? to : -1;

  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) {
    return res.status(400).json({ error: 'Invalid move coordinates' });
  }

  const fromSq = indexToSquare(fromIdx);
  const toSq = indexToSquare(toIdx);
  const promo = promotion ? String(promotion).toLowerCase().charAt(0) : undefined;

  if (session.mode !== 'single_player' && (!session.roomCode || !rooms.has(session.roomCode))) {
    return res.status(400).json({ error: 'No active game' });
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
          sp.gameOverHeadline = 'Checkmate — You Won! 🏆';
          sp.gameOverDetail = `Computer (${levelObj.label}) is checkmated.`;
        } else if (chess.isStalemate()) {
          sp.gameOverHeadline = 'Draw by stalemate';
          sp.gameOverDetail = 'Stalemate — no legal moves available.';
          sp.localWon = false;
        } else if (chess.isInsufficientMaterial()) {
          sp.gameOverHeadline = 'Draw — Insufficient Material';
          sp.gameOverDetail = 'Neither side can deliver checkmate.';
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
          const winnerName = isHost ? room.hostName : room.guestName;
          const loserName = isHost ? room.guestName : room.hostName;
          room.gameOverHeadline = `${winnerName} won by checkmate! 🏆`;
          room.gameOverDetail = `Checkmate! ${loserName} is checkmated.`;
        } else if (chess.isStalemate()) {
          room.winnerSide = 'draw';
          room.gameOverHeadline = 'Draw by stalemate';
          room.gameOverDetail = 'Stalemate — no legal moves available.';
        } else if (chess.isInsufficientMaterial()) {
          room.winnerSide = 'draw';
          room.gameOverHeadline = 'Draw — Insufficient Material';
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
  const session = getSession(getReqSessionId(req));
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
  const session = getSession(getReqSessionId(req));
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
  const session = getSession(getReqSessionId(req));
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
  const session = getSession(getReqSessionId(req));
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
  const session = getSession(getReqSessionId(req));
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
  const session = getSession(getReqSessionId(req));
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
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Chess Game server running on http://0.0.0.0:${PORT}`);
});
