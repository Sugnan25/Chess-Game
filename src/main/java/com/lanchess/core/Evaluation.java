package com.lanchess.core;

/**
 * Static evaluation of a position, in centipawns, from the point of view of
 * the side to move.
 *
 * <p>The terms are deliberately classical and cheap: material, piece placement,
 * pawn structure, bishop pair, mobility and a small tempo bonus. Nothing here
 * allocates, so it is safe to call from deep inside a search.
 */
public final class Evaluation {

    public static final int MATE_SCORE = 100000;
    public static final int INFINITY = 1000000;

    public static final int PAWN = 100;
    public static final int KNIGHT = 320;
    public static final int BISHOP = 335;
    public static final int ROOK = 500;
    public static final int QUEEN = 950;
    public static final int KING = 20000;

    private static final int[] VALUES = {KING, QUEEN, ROOK, BISHOP, KNIGHT, PAWN, 0};

    /** Pawn, knight, bishop, rook, queen, king. Indexed by {@link PieceType#ordinal()}. */
    public static int valueOf(PieceType type) {
        int i = type == null ? -1 : type.ordinal();
        return i < 0 || i >= VALUES.length ? 0 : VALUES[i];
    }

    // Piece-square tables, written from White's point of view with rank 8 first
    // so they read like a board. Black is read back to front.
    private static final int[] PAWN_TABLE = {
        0, 0, 0, 0, 0, 0, 0, 0,
        50, 50, 50, 50, 50, 50, 50, 50,
        10, 10, 20, 30, 30, 20, 10, 10,
        5, 5, 10, 27, 27, 10, 5, 5,
        0, 0, 0, 25, 25, 0, 0, 0,
        5, -5, -10, 0, 0, -10, -5, 5,
        5, 10, 10, -25, -25, 10, 10, 5,
        0, 0, 0, 0, 0, 0, 0, 0
    };

    private static final int[] KNIGHT_TABLE = {
        -50, -40, -30, -30, -30, -30, -40, -50,
        -40, -20, 0, 0, 0, 0, -20, -40,
        -30, 0, 10, 15, 15, 10, 0, -30,
        -30, 5, 15, 20, 20, 15, 5, -30,
        -30, 0, 15, 20, 20, 15, 0, -30,
        -30, 5, 10, 15, 15, 10, 5, -30,
        -40, -20, 0, 5, 5, 0, -20, -40,
        -50, -40, -30, -30, -30, -30, -40, -50
    };

    private static final int[] BISHOP_TABLE = {
        -20, -10, -10, -10, -10, -10, -10, -20,
        -10, 0, 0, 0, 0, 0, 0, -10,
        -10, 0, 5, 10, 10, 5, 0, -10,
        -10, 5, 5, 10, 10, 5, 5, -10,
        -10, 0, 10, 10, 10, 10, 0, -10,
        -10, 10, 10, 10, 10, 10, 10, -10,
        -10, 5, 0, 0, 0, 0, 5, -10,
        -20, -10, -10, -10, -10, -10, -10, -20
    };

    private static final int[] ROOK_TABLE = {
        0, 0, 0, 0, 0, 0, 0, 0,
        5, 10, 10, 10, 10, 10, 10, 5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        0, 0, 0, 5, 5, 0, 0, 0
    };

    private static final int[] QUEEN_TABLE = {
        -20, -10, -10, -5, -5, -10, -10, -20,
        -10, 0, 0, 0, 0, 0, 0, -10,
        -10, 0, 5, 5, 5, 5, 0, -10,
        -5, 0, 5, 5, 5, 5, 0, -5,
        0, 0, 5, 5, 5, 5, 0, -5,
        -10, 5, 5, 5, 5, 5, 0, -10,
        -10, 0, 5, 0, 0, 0, 0, -10,
        -20, -10, -10, -5, -5, -10, -10, -20
    };

    /** Encourages castling and keeping the king off the centre in the opening. */
    private static final int[] KING_MIDDLE_TABLE = {
        20, 30, 10, 0, 0, 10, 30, 20,
        20, 20, 0, 0, 0, 0, 20, 20,
        -10, -20, -20, -20, -20, -20, -20, -10,
        -20, -30, -30, -40, -40, -30, -30, -20,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30
    };

    /** Wants a tucked-away king once the pawns in front of it have gone. */
    private static final int[] KING_END_TABLE = {
        -50, -40, -30, -20, -20, -30, -40, -50,
        -30, -20, -10, 0, 0, -10, -20, -30,
        -30, -10, 20, 30, 30, 20, -10, -30,
        -30, -10, 30, 40, 40, 30, -10, -30,
        -30, -10, 30, 40, 40, 30, -10, -30,
        -30, -10, 20, 30, 30, 20, -10, -30,
        -30, -30, 0, 0, 0, 0, -30, -30,
        -50, -30, -30, -30, -30, -30, -30, -50
    };

    private static final int[][][] TABLES = new int[PieceType.values().length][][];

    static {
        TABLES[PieceType.PAWN.ordinal()] = new int[][]{PAWN_TABLE};
        TABLES[PieceType.KNIGHT.ordinal()] = new int[][]{KNIGHT_TABLE};
        TABLES[PieceType.BISHOP.ordinal()] = new int[][]{BISHOP_TABLE};
        TABLES[PieceType.ROOK.ordinal()] = new int[][]{ROOK_TABLE};
        TABLES[PieceType.QUEEN.ordinal()] = new int[][]{QUEEN_TABLE};
        TABLES[PieceType.KING.ordinal()] = new int[][]{KING_MIDDLE_TABLE, KING_END_TABLE};
    }

    private static final int BISHOP_PAIR = 30;
    private static final int ISOLATED_PAWN = 15;
    private static final int DOUBLED_PAWN = 12;
    private static final int[] PASSED_PAWN_BONUS = {0, 8, 16, 32, 60, 100, 160, 0};
    private static final int TEMPO = 12;

    private Evaluation() {
    }

    /**
     * Scores the position from the side to move's perspective. A positive score
     * means the side to move is better off.
     */
    public static int evaluate(ChessGame game) {
        Board board = game.mutableBoard();
        int white = 0;
        int black = 0;
        int whitePawnsOnFiles = 0;
        int blackPawnsOnFiles = 0;
        int whiteBishops = 0;
        int blackBishops = 0;
        int totalPawns = 0;

        for (int sq = 0; sq < 64; sq++) {
            Piece p = board.get(sq);
            if (p != null && p.type() == PieceType.PAWN) {
                totalPawns++;
            }
        }
        boolean endgame = totalPawns <= 4;

        for (int sq = 0; sq < 64; sq++) {
            Piece p = board.get(sq);
            if (p == null) {
                continue;
            }
            int file = Square.fileOf(sq);
            int total = valueOf(p.type()) + tableValue(p, sq, endgame);

            if (p.type() == PieceType.PAWN) {
                if (p.side() == Side.WHITE) {
                    whitePawnsOnFiles |= 1 << file;
                } else {
                    blackPawnsOnFiles |= 1 << file;
                }
            } else if (p.type() == PieceType.BISHOP) {
                if (p.side() == Side.WHITE) {
                    whiteBishops++;
                } else {
                    blackBishops++;
                }
            }

            if (p.side() == Side.WHITE) {
                white += total;
            } else {
                black += total;
            }
        }

        // Pawn structure, charged to the side that owns the pawns.
        white += pawnStructure(board, Side.WHITE, whitePawnsOnFiles);
        black += pawnStructure(board, Side.BLACK, blackPawnsOnFiles);

        if (whiteBishops >= 2) {
            white += BISHOP_PAIR;
        }
        if (blackBishops >= 2) {
            black += BISHOP_PAIR;
        }

        int score = white - black;
        return game.sideToMove() == Side.WHITE ? score + TEMPO : -score + TEMPO;
    }

    private static int tableValue(Piece piece, int square, boolean endgame) {
        int[][] options = TABLES[piece.type().ordinal()];
        int index = options.length == 1 ? 0 : (endgame ? 1 : 0);
        return options[index][piece.side() == Side.WHITE ? square : flip(square)];
    }

    private static int flip(int square) {
        return Square.of(Square.fileOf(square), 7 - Square.rankRowOf(square));
    }

    private static int pawnStructure(Board board, Side side, int pawnFiles) {
        int penalty = 0;
        for (int file = 0; file < 8; file++) {
            if ((pawnFiles & (1 << file)) == 0) {
                continue;
            }
            int onThisFile = 0;
            for (int row = 0; row < 8; row++) {
                Piece p = board.get(Square.of(file, row));
                if (p != null && p.type() == PieceType.PAWN && p.side() == side) {
                    onThisFile++;
                }
            }
            if (onThisFile > 1) {
                penalty += DOUBLED_PAWN * (onThisFile - 1);
            }
            boolean leftBlocked = file == 0 || (pawnFiles & (1 << (file - 1))) == 0;
            boolean rightBlocked = file == 7 || (pawnFiles & (1 << (file + 1))) == 0;
            if (leftBlocked && rightBlocked) {
                penalty += ISOLATED_PAWN;
            }
        }
        return penalty;
    }

    /**
     * Bonus for pawns with no enemy pawn ahead on their file or on the
     * neighbouring files, so pushing them becomes the engine's plan.
     */
    public static int passedPawnBonus(ChessGame game, int square, Side side) {
        Piece p = game.pieceAt(square);
        if (p == null || p.type() != PieceType.PAWN) {
            return 0;
        }
        int file = Square.fileOf(square);
        int row = Square.rankRowOf(square);
        int dir = side == Side.WHITE ? -1 : 1;
        for (int r = row + dir; r >= 0 && r < 8; r += dir) {
            for (int f = Math.max(0, file - 1); f <= Math.min(7, file + 1); f++) {
                Piece other = game.pieceAt(Square.of(f, r));
                if (other != null && other.type() == PieceType.PAWN && other.side() != side) {
                    return 0;
                }
            }
        }
        int advanced = side == Side.WHITE ? 6 - row : row - 1;
        return PASSED_PAWN_BONUS[Math.max(0, Math.min(7, advanced))];
    }
}
