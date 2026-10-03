package com.lanchess.core;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The chess rules engine.
 *
 * <p>Implements legal move generation, check, checkmate, stalemate, castling,
 * en passant and promotion. It is plain Java with no UI or networking imports so
 * the same code can be reused on Android.
 *
 * <p>Square indices run from 0 = a8 to 63 = h1, matching {@link Square}.
 */
public final class ChessGame {

    /** A rule the engine may or may not enforce yet. */
    public enum Rule {
        CASTLING,
        EN_PASSANT,
        PROMOTION,
        CHECK,
        STALEMATE,
        FIFTY_MOVE_RULE,
        THREEFOLD_REPETITION;

        public boolean isImplemented() {
            switch (this) {
                case CASTLING:
                case EN_PASSANT:
                case PROMOTION:
                case CHECK:
                case STALEMATE:
                    return true;
                default:
                    return false;
            }
        }
    }

    /** Why a game has finished, or {@link #ONGOING} while it is still being played. */
    public enum GameResult {
        ONGOING,
        KING_CAPTURED,
        CHECKMATE,
        STALEMATE,
        INSUFFICIENT_MATERIAL;

        public boolean isOver() {
            return this != ONGOING;
        }
    }

    public static final int CASTLE_WK = 1;
    public static final int CASTLE_WQ = 2;
    public static final int CASTLE_BK = 4;
    public static final int CASTLE_BQ = 8;
    public static final int CASTLE_ALL = CASTLE_WK | CASTLE_WQ | CASTLE_BK | CASTLE_BQ;

    private static final int A8 = 0;
    private static final int E8 = 4;
    private static final int H8 = 7;
    private static final int A1 = 56;
    private static final int E1 = 60;
    private static final int H1 = 63;

    private static final int[][] KNIGHT_DELTAS = {
        {-2, -1}, {-2, 1}, {-1, -2}, {-1, 2}, {1, -2}, {1, 2}, {2, -1}, {2, 1}
    };
    private static final int[][] KING_DELTAS = {
        {-1, -1}, {-1, 0}, {-1, 1}, {0, -1}, {0, 1}, {1, -1}, {1, 0}, {1, 1}
    };
    private static final int[][] ORTHOGONAL_DIRS = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
    private static final int[][] DIAGONAL_DIRS = {{1, 1}, {1, -1}, {-1, 1}, {-1, -1}};
    private static final int[][] ALL_DIRS = {
        {1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1}
    };

    private final Board board;
    private Side sideToMove;
    private int castlingRights;
    private int enPassantSquare;

    public ChessGame() {
        this(Board.starting());
    }

    public ChessGame(Board board) {
        this.board = new Board(board);
        this.sideToMove = Side.WHITE;
        this.castlingRights = CASTLE_ALL;
        this.enPassantSquare = -1;
    }

    public Board board() {
        return new Board(this.board);
    }

    public Piece pieceAt(int index) {
        return this.board.get(index);
    }

    public boolean isEmpty(int index) {
        return this.board.isEmpty(index);
    }

    Board mutableBoard() {
        return this.board;
    }

    public Side sideToMove() {
        return this.sideToMove;
    }

    public void setSideToMove(Side side) {
        this.sideToMove = side == null ? Side.WHITE : side;
    }

    public int castlingRights() {
        return this.castlingRights;
    }

    /** The square a pawn may be captured on by en passant, or -1 if none. */
    public int enPassantSquare() {
        return this.enPassantSquare;
    }

    public boolean canCastle(Side side, boolean kingside) {
        return (this.castlingRights & (side == Side.WHITE
                ? (kingside ? CASTLE_WK : CASTLE_WQ)
                : (kingside ? CASTLE_BK : CASTLE_BQ))) != 0;
    }

    public static boolean isRuleImplemented(Rule rule) {
        return rule != null && rule.isImplemented();
    }

    // ------------------------------------------------------------------
    // Serialisation
    // ------------------------------------------------------------------

    /** Position, side to move, castling rights and the en passant target. */
    public String toStateString() {
        return this.board.toFenPiecePlacement()
                + " " + (this.sideToMove == Side.WHITE ? "w" : "b")
                + " " + this.castlingField()
                + " " + this.enPassantField();
    }

    public static ChessGame fromStateString(String state) {
        if (state == null) {
            throw new IllegalArgumentException("Empty game state");
        }
        String[] parts = state.trim().split("\\s+");
        ChessGame game = new ChessGame(Board.fromFenPiecePlacement(parts[0]));
        if (parts.length > 1 && !parts[1].isEmpty()) {
            game.setSideToMove("b".equalsIgnoreCase(parts[1]) ? Side.BLACK : Side.WHITE);
        }
        if (parts.length > 2) {
            // An explicit field is authoritative: "-" means no rights at all.
            // Only a two-field state string keeps the optimistic default.
            game.castlingRights = parts[2].isEmpty() || "-".equals(parts[2]) ? 0 : parseCastling(parts[2]);
        }
        if (parts.length > 3 && !parts[3].isEmpty() && !"-".equals(parts[3])) {
            try {
                game.enPassantSquare = Square.fromName(parts[3]);
            } catch (IllegalArgumentException ignored) {
                game.enPassantSquare = -1;
            }
        }
        return game;
    }

    private String castlingField() {
        if (this.castlingRights == 0) {
            return "-";
        }
        StringBuilder sb = new StringBuilder(4);
        if ((this.castlingRights & CASTLE_WK) != 0) {
            sb.append('K');
        }
        if ((this.castlingRights & CASTLE_WQ) != 0) {
            sb.append('Q');
        }
        if ((this.castlingRights & CASTLE_BK) != 0) {
            sb.append('k');
        }
        if ((this.castlingRights & CASTLE_BQ) != 0) {
            sb.append('q');
        }
        return sb.toString();
    }

    private String enPassantField() {
        return this.enPassantSquare < 0 ? "-" : Square.nameOf(this.enPassantSquare);
    }

    private static int parseCastling(String field) {
        int rights = 0;
        for (int i = 0; i < field.length(); i++) {
            switch (field.charAt(i)) {
                case 'K': rights |= CASTLE_WK; break;
                case 'Q': rights |= CASTLE_WQ; break;
                case 'k': rights |= CASTLE_BK; break;
                case 'q': rights |= CASTLE_BQ; break;
                default: break;
            }
        }
        return rights;
    }

    // ------------------------------------------------------------------
    // Attack detection
    // ------------------------------------------------------------------

    public int findKing(Side side) {
        for (int i = 0; i < 64; i++) {
            Piece p = this.board.get(i);
            if (p != null && p.type() == PieceType.KING && p.side() == side) {
                return i;
            }
        }
        return -1;
    }

    /** True when {@code by} attacks {@code square}. */
    public boolean isAttacked(int square, Side by) {
        if (!Square.isValid(square)) {
            return false;
        }
        int file = Square.fileOf(square);
        int row = Square.rankRowOf(square);

        // Pawns attack toward lower rows for white, higher rows for black.
        int backRow = row - (by == Side.WHITE ? -1 : 1);
        if (backRow >= 0 && backRow <= 7) {
            for (int df = -1; df <= 1; df += 2) {
                int f = file + df;
                if (f < 0 || f > 7) {
                    continue;
                }
                Piece p = this.board.get(Square.of(f, backRow));
                if (p != null && p.side() == by && p.type() == PieceType.PAWN) {
                    return true;
                }
            }
        }

        if (this.isAttackedByStepper(square, by, KNIGHT_DELTAS, PieceType.KNIGHT)) {
            return true;
        }
        if (this.isAttackedByStepper(square, by, KING_DELTAS, PieceType.KING)) {
            return true;
        }
        return this.isAttackedBySlider(square, by, ORTHOGONAL_DIRS, PieceType.ROOK, PieceType.QUEEN)
                || this.isAttackedBySlider(square, by, DIAGONAL_DIRS, PieceType.BISHOP, PieceType.QUEEN);
    }

    private boolean isAttackedByStepper(int square, Side by, int[][] deltas, PieceType type) {
        int file = Square.fileOf(square);
        int row = Square.rankRowOf(square);
        for (int[] d : deltas) {
            int f = file + d[0];
            int r = row + d[1];
            if (f < 0 || f > 7 || r < 0 || r > 7) {
                continue;
            }
            Piece p = this.board.get(Square.of(f, r));
            if (p != null && p.side() == by && p.type() == type) {
                return true;
            }
        }
        return false;
    }

    private boolean isAttackedBySlider(int square, Side by, int[][] dirs, PieceType straight, PieceType diagonal) {
        int file = Square.fileOf(square);
        int row = Square.rankRowOf(square);
        for (int[] dir : dirs) {
            int f = file + dir[0];
            int r = row + dir[1];
            while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
                Piece p = this.board.get(Square.of(f, r));
                if (p != null) {
                    if (p.side() == by && (p.type() == straight || p.type() == diagonal)) {
                        return true;
                    }
                    break;
                }
                f += dir[0];
                r += dir[1];
            }
        }
        return false;
    }

    public boolean isInCheck(Side side) {
        int king = this.findKing(side);
        return king >= 0 && this.isAttacked(king, side.opposite());
    }

    public boolean isInCheck() {
        return this.isInCheck(this.sideToMove);
    }

    // ------------------------------------------------------------------
    // Move generation
    // ------------------------------------------------------------------

    private boolean isEnemy(int index) {
        Piece p = this.board.get(index);
        return p != null && p.side() != this.sideToMove;
    }

    private boolean isEmptyOrEnemy(int index) {
        Piece p = this.board.get(index);
        return p == null || p.side() != this.sideToMove;
    }

    private void addStepMoves(int from, List<Integer> out, int[][] deltas) {
        int file = Square.fileOf(from);
        int row = Square.rankRowOf(from);
        for (int[] d : deltas) {
            int f = file + d[0];
            int r = row + d[1];
            if (f < 0 || f > 7 || r < 0 || r > 7) {
                continue;
            }
            int to = Square.of(f, r);
            if (this.isEmptyOrEnemy(to)) {
                out.add(to);
            }
        }
    }

    private void addSlidingMoves(int from, List<Integer> out, int[][] dirs) {
        int file = Square.fileOf(from);
        int row = Square.rankRowOf(from);
        for (int[] dir : dirs) {
            int f = file + dir[0];
            int r = row + dir[1];
            while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
                int to = Square.of(f, r);
                if (this.board.isEmpty(to)) {
                    out.add(to);
                } else {
                    if (this.isEnemy(to)) {
                        out.add(to);
                    }
                    break;
                }
                f += dir[0];
                r += dir[1];
            }
        }
    }

    private void addPawnMoves(Piece piece, int from, List<Integer> out) {
        Side side = piece.side();
        int dir = side == Side.WHITE ? -1 : 1;
        int file = Square.fileOf(from);
        int row = Square.rankRowOf(from);
        int startRow = side == Side.WHITE ? 6 : 1;

        int oneRow = row + dir;
        if (oneRow >= 0 && oneRow <= 7) {
            int one = Square.of(file, oneRow);
            if (this.board.isEmpty(one)) {
                out.add(one);
                int twoRow = row + 2 * dir;
                if (row == startRow && twoRow >= 0 && twoRow <= 7 && this.board.isEmpty(Square.of(file, twoRow))) {
                    out.add(Square.of(file, twoRow));
                }
            }
        }
        if (oneRow < 0 || oneRow > 7) {
            return;
        }
        for (int df = -1; df <= 1; df += 2) {
            int f = file + df;
            if (f < 0 || f > 7) {
                continue;
            }
            int to = Square.of(f, oneRow);
            if (this.isEnemy(to) || (to == this.enPassantSquare && this.board.isEmpty(to))) {
                out.add(to);
            }
        }
    }

    /** Legal destinations for the piece on {@code from}, ignoring pins and check. */
    public List<Integer> pseudoLegalTargets(int from) {
        Piece piece = this.board.get(from);
        if (piece == null || piece.side() != this.sideToMove) {
            return Collections.emptyList();
        }
        List<Integer> out = new ArrayList<>();
        switch (piece.type()) {
            case PAWN:
                this.addPawnMoves(piece, from, out);
                break;
            case KNIGHT:
                this.addStepMoves(from, out, KNIGHT_DELTAS);
                break;
            case KING:
                this.addStepMoves(from, out, KING_DELTAS);
                this.addCastlingMoves(from, out);
                break;
            case ROOK:
                this.addSlidingMoves(from, out, ORTHOGONAL_DIRS);
                break;
            case BISHOP:
                this.addSlidingMoves(from, out, DIAGONAL_DIRS);
                break;
            case QUEEN:
                this.addSlidingMoves(from, out, ALL_DIRS);
                break;
            default:
                break;
        }
        return out;
    }

    /** Legal destinations for the piece on {@code from}, excluding moves that expose the king. */
    public List<Integer> legalTargets(int from) {
        Piece piece = this.board.get(from);
        if (piece == null || piece.side() != this.sideToMove) {
            return Collections.emptyList();
        }
        List<Integer> pseudo = this.pseudoLegalTargets(from);
        if (pseudo.isEmpty()) {
            return pseudo;
        }
        List<Integer> out = new ArrayList<>();
        for (int to : pseudo) {
            List<Move> candidates = new ArrayList<>(4);
            this.expandPromotion(piece, from, to, candidates);
            for (Move move : candidates) {
                if (this.isLegal(move)) {
                    out.add(to);
                    break;
                }
            }
        }
        return out;
    }

    public List<Move> pseudoLegalMoves() {
        List<Move> out = new ArrayList<>();
        for (int from : this.board.squaresOf(this.sideToMove)) {
            Piece piece = this.board.get(from);
            for (int to : this.pseudoLegalTargets(from)) {
                this.expandPromotion(piece, from, to, out);
            }
        }
        return out;
    }

    public List<Move> legalMoves() {
        List<Move> out = new ArrayList<>();
        for (int from : this.board.squaresOf(this.sideToMove)) {
            Piece piece = this.board.get(from);
            for (int to : this.pseudoLegalTargets(from)) {
                List<Move> candidates = new ArrayList<>(4);
                this.expandPromotion(piece, from, to, candidates);
                for (Move move : candidates) {
                    if (this.isLegal(move)) {
                        out.add(move);
                    }
                }
            }
        }
        return out;
    }

    /**
     * The squares the piece on the given square may legally reach, each listed
     * once even when a promoting pawn reaches it four ways. A board interface
     * needs this to draw its hints without inventing its own rules.
     *
     * @return the destination squares, or an empty array for a square that is
     *         empty, not the side to move, or pinned in place
     */
    public int[] legalTargetsFrom(int from) {
        Piece piece = this.board.get(from);
        if (piece == null || piece.side() != this.sideToMove) {
            return new int[0];
        }
        List<Integer> pseudo = this.pseudoLegalTargets(from);
        int[] targets = new int[pseudo.size()];
        int count = 0;
        for (Integer square : pseudo) {
            int to = square.intValue();
            List<Move> candidates = new ArrayList<>(4);
            this.expandPromotion(piece, from, to, candidates);
            for (Move move : candidates) {
                if (this.isLegal(move)) {
                    targets[count++] = to;
                    break;
                }
            }
        }
        if (count == targets.length) {
            return targets;
        }
        int[] trimmed = new int[count];
        System.arraycopy(targets, 0, trimmed, 0, count);
        return trimmed;
    }

    /** A pawn reaching the last rank may become any of the four heavy pieces. */
    private void expandPromotion(Piece piece, int from, int to, List<Move> out) {
        if (piece != null && piece.type() == PieceType.PAWN && isPromotionRank(piece.side(), to)) {
            out.add(new Move(from, to, PieceType.QUEEN));
            out.add(new Move(from, to, PieceType.ROOK));
            out.add(new Move(from, to, PieceType.BISHOP));
            out.add(new Move(from, to, PieceType.KNIGHT));
        } else {
            out.add(new Move(from, to));
        }
    }

    private static boolean isPromotionRank(Side side, int square) {
        return side == Side.WHITE ? Square.rankRowOf(square) == 0 : Square.rankRowOf(square) == 7;
    }

    private static boolean isPromotable(PieceType type) {
        return type == PieceType.QUEEN || type == PieceType.ROOK
                || type == PieceType.BISHOP || type == PieceType.KNIGHT;
    }

    public boolean isLegal(Move move) {
        if (move == null) {
            return false;
        }
        Piece piece = this.board.get(move.from());
        if (piece == null || piece.side() != this.sideToMove) {
            return false;
        }
        if (looksLikeCastling(move)) {
            return this.isLegalCastling(move);
        }
        boolean targetOk = this.pseudoLegalTargets(move.from()).contains(move.to());
        if (!targetOk) {
            return false;
        }
        if (piece.type() == PieceType.PAWN && isPromotionRank(piece.side(), move.to())) {
            // Only a pawn reaching the far rank has to promote, and only to a
            // real piece. A bare pawn walking onto rank 1 or 8 is never legal,
            // while a rook or knight landing there is an ordinary move.
            if (move.promotion() == null || !isPromotable(move.promotion())) {
                return false;
            }
        } else if (move.promotion() != null) {
            return false;
        }
        Undo undo = this.makeUnchecked(move);
        boolean leavesKingSafe = !this.isInCheck(piece.side());
        this.unmake(undo);
        return leavesKingSafe;
    }

    public static boolean isCastlingForm(Move move) {
        return Math.abs(Square.fileOf(move.to()) - Square.fileOf(move.from())) == 2
                && Square.rankRowOf(move.to()) == Square.rankRowOf(move.from());
    }

    // ------------------------------------------------------------------
    // Castling
    // ------------------------------------------------------------------

    private void addCastlingMoves(int from, List<Integer> out) {
        if (from != E1 && from != E8) {
            return;
        }
        if (this.isInCheck()) {
            return;
        }
        Side side = this.sideToMove;
        if (this.isCastlingPathClear(side, true)) {
            out.add(castleDestination(side, true));
        }
        if (this.isCastlingPathClear(side, false)) {
            out.add(castleDestination(side, false));
        }
    }

    private static int kingHome(Side side) {
        return side == Side.WHITE ? E1 : E8;
    }

    private static int castleDestination(Side side, boolean kingside) {
        int row = Square.rankRowOf(kingHome(side));
        return Square.of(kingside ? 6 : 2, row);
    }

    private static int rookHome(Side side, boolean kingside) {
        int row = Square.rankRowOf(kingHome(side));
        return Square.of(kingside ? 7 : 0, row);
    }

    private static int rookTarget(Side side, boolean kingside) {
        int row = Square.rankRowOf(kingHome(side));
        return Square.of(kingside ? 5 : 3, row);
    }

    /** Rights held, rook still home, no pieces in the way, king never under attack. */
    private boolean isCastlingPathClear(Side side, boolean kingside) {
        if (!this.canCastle(side, kingside)) {
            return false;
        }
        Piece rook = this.board.get(rookHome(side, kingside));
        if (rook == null || rook.type() != PieceType.ROOK || rook.side() != side) {
            return false;
        }
        int row = Square.rankRowOf(kingHome(side));
        Piece king = this.board.get(kingHome(side));
        if (king == null || king.type() != PieceType.KING || king.side() != side) {
            return false;
        }
        // Kingside: f and g must be clear. Queenside: b, c and d must be clear.
        // The king's own square and the rook's square are not part of the path.
        int firstFile = kingside ? 5 : 1;
        int lastFile = kingside ? 6 : 3;
        for (int f = firstFile; f <= lastFile; f++) {
            if (this.board.get(Square.of(f, row)) != null) {
                return false;
            }
        }
        // The king may not start, pass through, or land on an attacked square.
        return !this.isAttacked(kingHome(side), side.opposite())
                && !this.isAttacked(Square.of(kingside ? 5 : 3, row), side.opposite())
                && !this.isAttacked(castleDestination(side, kingside), side.opposite());
    }

    /**
     * True when this move is shaped like castling <em>and</em> a king is moving.
     * A rook travelling two files (b1 to d1) also matches the shape, so the
     * piece type has to be checked too.
     */
    private boolean looksLikeCastling(Move move) {
        Piece piece = this.board.get(move.from());
        return piece != null && piece.type() == PieceType.KING && isCastlingForm(move);
    }

    private boolean isLegalCastling(Move move) {
        Piece king = this.board.get(move.from());
        if (king == null || king.type() != PieceType.KING) {
            return false;
        }
        if (move.from() != kingHome(king.side())) {
            return false;
        }
        boolean kingside = isKingsideForm(move);
        if (move.to() != castleDestination(king.side(), kingside)) {
            return false;
        }
        return this.isCastlingPathClear(king.side(), kingside);
    }

    private static boolean isKingsideForm(Move move) {
        return Square.fileOf(move.to()) > Square.fileOf(move.from());
    }

    // ------------------------------------------------------------------
    // Applying moves
    // ------------------------------------------------------------------

    public MoveResult apply(Move move) {
        if (!this.isLegal(move)) {
            throw new IllegalArgumentException("Illegal move: " + (move == null ? "null" : move.toAlgebraic()));
        }
        Undo undo = this.makeUnchecked(move);
        GameResult outcome = this.resultAfterMove(undo);
        return new MoveResult(undo.move, undo.captured, undo.capturedSquare, outcome);
    }

    /**
     * Applies a move that the caller already knows is legal, skipping the
     * legality re-check. Used by the search, which generates legal moves itself.
     */
    MoveResult applyFast(Move move) {
        Undo undo = this.makeUnchecked(move);
        return new MoveResult(undo.move, undo.captured, undo.capturedSquare, GameResult.ONGOING);
    }

    // ------------------------------------------------------------------
    // Push and pop, for the search
    // ------------------------------------------------------------------

    /**
     * Plays a move that the caller has already verified as legal and returns
     * the token needed to take it back with {@link #unmakeSearch(Undo)}.
     * Cheaper than {@link #copy()} per node, which is what makes the search fast.
     */
    Undo makeSearch(Move move) {
        return this.makeUnchecked(move);
    }

    /** Restores the position that {@link #makeSearch(Move)} left behind. */
    void unmakeSearch(Undo undo) {
        this.unmake(undo);
    }

    /** What a move captured, for move ordering in the search. */
    public Piece capturedBySearch(Undo undo) {
        return undo.captured != null ? undo.captured : undo.enPassantVictim;
    }

    private GameResult resultAfterMove(Undo undo) {
        if (undo.captured != null && undo.captured.type() == PieceType.KING) {
            return GameResult.KING_CAPTURED;
        }
        if (this.legalMoves().isEmpty()) {
            return this.isInCheck(this.sideToMove) ? GameResult.CHECKMATE : GameResult.STALEMATE;
        }
        if (this.isInsufficientMaterial()) {
            return GameResult.INSUFFICIENT_MATERIAL;
        }
        return GameResult.ONGOING;
    }

    /** Everything needed to put the position back exactly as it was. */
    static final class Undo {
        Move move;
        Piece movingPiece;
        Piece captured;
        int capturedSquare = -1;
        Piece enPassantVictim;
        int rookFrom = -1;
        int rookTo = -1;
        Side sideToMove;
        int castlingRights;
        int enPassantSquare;
    }

    private Undo makeUnchecked(Move move) {
        Undo undo = new Undo();
        undo.move = move;
        undo.sideToMove = this.sideToMove;
        undo.castlingRights = this.castlingRights;
        undo.enPassantSquare = this.enPassantSquare;

        Piece moving = this.board.get(move.from());
        Side side = moving.side();
        undo.movingPiece = moving;
        Piece captured = this.board.get(move.to());
        undo.captured = captured;
        undo.capturedSquare = captured == null ? -1 : move.to();

        this.board.clear(move.from());

        // En passant: the captured pawn is not on the destination square.
        if (moving.type() == PieceType.PAWN
                && move.to() == this.enPassantSquare
                && captured == null
                && Square.fileOf(move.from()) != Square.fileOf(move.to())) {
            int victim = side == Side.WHITE ? move.to() + 8 : move.to() - 8;
            undo.enPassantVictim = this.board.get(victim);
            undo.capturedSquare = victim;
            this.board.clear(victim);
        }

        Piece placed = move.promotion() == null ? moving : Piece.of(move.promotion(), side);
        this.board.set(move.to(), placed);

        // Castling moves the rook too.
        if (moving.type() == PieceType.KING && isCastlingForm(move)) {
            undo.rookFrom = rookHome(side, isKingsideForm(move));
            undo.rookTo = rookTarget(side, isKingsideForm(move));
            this.board.set(undo.rookTo, this.board.get(undo.rookFrom));
            this.board.clear(undo.rookFrom);
        }

        this.updateCastlingRights(move, side, undo.captured);
        this.enPassantSquare = enPassantTargetFor(moving, move);
        this.sideToMove = side.opposite();
        return undo;
    }

    private void unmake(Undo undo) {
        this.sideToMove = undo.sideToMove;
        this.castlingRights = undo.castlingRights;
        this.enPassantSquare = undo.enPassantSquare;

        if (undo.rookFrom >= 0) {
            this.board.set(undo.rookFrom, this.board.get(undo.rookTo));
            this.board.clear(undo.rookTo);
        }

        this.board.clear(undo.move.to());
        this.board.set(undo.move.from(), undo.movingPiece);

        if (undo.enPassantVictim != null) {
            this.board.set(undo.capturedSquare, undo.enPassantVictim);
        } else if (undo.captured != null) {
            this.board.set(undo.capturedSquare, undo.captured);
        }
    }

    /** The square a pawn skips over on a double push, or -1 if it did not move two. */
    private static int enPassantTargetFor(Piece moving, Move move) {
        if (moving.type() != PieceType.PAWN) {
            return -1;
        }
        int fromRow = Square.rankRowOf(move.from());
        int toRow = Square.rankRowOf(move.to());
        if (Math.abs(toRow - fromRow) != 2) {
            return -1;
        }
        return Square.of(Square.fileOf(move.from()), (fromRow + toRow) / 2);
    }

    private void updateCastlingRights(Move move, Side side, Piece captured) {
        if (move.from() == E1) {
            this.castlingRights &= ~(CASTLE_WK | CASTLE_WQ);
        } else if (move.from() == E8) {
            this.castlingRights &= ~(CASTLE_BK | CASTLE_BQ);
        }
        if (move.from() == A1 || (captured != null && move.to() == A1)) {
            this.castlingRights &= ~CASTLE_WQ;
        }
        if (move.from() == H1 || (captured != null && move.to() == H1)) {
            this.castlingRights &= ~CASTLE_WK;
        }
        if (move.from() == A8 || (captured != null && move.to() == A8)) {
            this.castlingRights &= ~CASTLE_BQ;
        }
        if (move.from() == H8 || (captured != null && move.to() == H8)) {
            this.castlingRights &= ~CASTLE_BK;
        }
    }

    public ChessGame copy() {
        ChessGame game = new ChessGame(this.board);
        game.sideToMove = this.sideToMove;
        game.castlingRights = this.castlingRights;
        game.enPassantSquare = this.enPassantSquare;
        return game;
    }

    // ------------------------------------------------------------------
    // End of game
    // ------------------------------------------------------------------

    public boolean isCheckmate() {
        return this.legalMoves().isEmpty() && this.isInCheck(this.sideToMove);
    }

    public boolean isStalemate() {
        return this.legalMoves().isEmpty() && !this.isInCheck(this.sideToMove);
    }

    /** K v K, K+minor v K, and bishops only on one colour. */
    public boolean isInsufficientMaterial() {
        int bishops = 0;
        boolean firstBishopLight = false;
        for (int i = 0; i < 64; i++) {
            Piece p = this.board.get(i);
            if (p == null) {
                continue;
            }
            switch (p.type()) {
                case PAWN:
                case ROOK:
                case QUEEN:
                    return false;
                case BISHOP:
                    bishops++;
                    if (bishops == 1) {
                        firstBishopLight = isLightSquare(i);
                    } else if (isLightSquare(i) != firstBishopLight) {
                        return false;
                    }
                    break;
                default:
                    break;
            }
        }
        return bishops <= 1;
    }

    private static boolean isLightSquare(int index) {
        return (Square.fileOf(index) + Square.rankOf(index)) % 2 == 0;
    }

    public static boolean hasLegalMoves(ChessGame game) {
        return !game.legalMoves().isEmpty();
    }

    // ------------------------------------------------------------------
    // Move result
    // ------------------------------------------------------------------

    public static final class MoveResult {
        private final Move move;
        private final Piece captured;
        private final int capturedAt;
        private final GameResult outcome;

        MoveResult(Move move, Piece captured, int capturedAt, GameResult outcome) {
            this.move = move;
            this.captured = captured;
            this.capturedAt = capturedAt;
            this.outcome = outcome;
        }

        public Move move() {
            return this.move;
        }

        public Piece captured() {
            return this.captured;
        }

        public int capturedAt() {
            return this.capturedAt;
        }

        public GameResult outcome() {
            return this.outcome;
        }
    }
}
