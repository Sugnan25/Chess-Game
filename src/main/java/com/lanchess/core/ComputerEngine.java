package com.lanchess.core;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * The computer opponent: negamax with alpha-beta pruning, iterative deepening,
 * a quiescence search over captures, and killer/history move ordering.
 *
 * <p>Pure Java with no UI or networking imports, so the same code runs on
 * Android. One {@code ComputerEngine} handles one search: call
 * {@link #beginSearch()} then {@link #chooseMove(ChessGame)} from a background
 * thread, or use the {@link #chooseMove(ChessGame, Difficulty, Random)} helper
 * for a single self-contained call.
 */
public final class ComputerEngine {

    private static final int MAX_PLY = 64;
    private static final int KILLER = 1_000_000;
    private static final int PROMOTION_ORDER = 800_000;
    private static final int CAPTURE_ORDER = 700_000;
    private static final int HISTORY_CAP = 600_000;

    private final Random random;
    private final Move[][] killers = new Move[MAX_PLY][];
    private final int[] history = new int[64 * 64];

    private Difficulty difficulty = Difficulty.MEDIUM;
    private long deadline;
    private int nodes;
    private volatile boolean cancelled;

    public ComputerEngine() {
        this(new Random());
    }

    public ComputerEngine(Random random) {
        this.random = random == null ? new Random() : random;
        for (int i = 0; i < MAX_PLY; i++) {
            this.killers[i] = new Move[2];
        }
    }

    /** Clears the search tables and starts the clock for the given level. */
    public void beginSearch(Difficulty level) {
        this.beginSearch(level, level == null ? Difficulty.MEDIUM.budgetMillis() : level.budgetMillis());
    }

    /**
     * Same, but with an explicit time budget. The level still decides the depth
     * and how loosely the engine plays; this only changes how long it thinks.
     */
    public void beginSearch(Difficulty level, long budgetMillis) {
        this.difficulty = level == null ? Difficulty.MEDIUM : level;
        this.deadline = System.currentTimeMillis() + Math.max(1L, budgetMillis);
        this.cancelled = false;
        this.nodes = 0;
        java.util.Arrays.fill(this.history, 0);
        for (Move[] pair : this.killers) {
            pair[0] = null;
            pair[1] = null;
        }
    }

    public Difficulty difficulty() {
        return this.difficulty;
    }

    public int nodes() {
        return this.nodes;
    }

    /** Stops an in-flight search at the next node boundary. */
    public void cancel() {
        this.cancelled = true;
    }

    /** One-shot convenience for tests and small callers. */
    public static Move chooseMove(ChessGame game, Difficulty level, Random random) {
        return chooseMove(game, level, random, -1L);
    }

    /** As above, with an explicit time budget; a negative value uses the level's. */
    public static Move chooseMove(ChessGame game, Difficulty level, Random random, long budgetMillis) {
        ComputerEngine engine = new ComputerEngine(random);
        if (budgetMillis < 0L) {
            engine.beginSearch(level);
        } else {
            engine.beginSearch(level, budgetMillis);
        }
        return engine.chooseMove(game);
    }

    public static Move chooseMove(ChessGame game, Difficulty level) {
        return chooseMove(game, level, null);
    }

    /**
     * Picks a move for the side to move, or null when the position is already
     * over. The game is left exactly as it was passed in.
     */
    public Move chooseMove(ChessGame game) {
        if (game == null) {
            return null;
        }
        List<Move> rootMoves = game.legalMoves();
        if (rootMoves.isEmpty()) {
            return null;
        }
        if (rootMoves.size() == 1) {
            return rootMoves.get(0);
        }
        this.orderMoves(game, rootMoves, 0);

        Move best = rootMoves.get(0);
        int[] bestScores = new int[rootMoves.size()];
        boolean haveResult = false;
        boolean reliable = false;

        // Iterative deepening. Each pass re-searches with a larger depth, and
        // the moves from the previous pass are already in a good order, so the
        // alpha-beta windows prune more each time.
        for (int depth = 1; depth <= this.difficulty.maxDepth(); depth++) {
            if (this.cancelled || (haveResult && this.timedOut())) {
                break;
            }

            int alpha = -Evaluation.INFINITY;
            int passBestScore = 0;
            int passBestIndex = -1;
            int[] passScores = new int[rootMoves.size()];
            boolean complete = true;

            for (int i = 0; i < rootMoves.size(); i++) {
                Move move = rootMoves.get(i);
                ChessGame.Undo undo = game.makeSearch(move);
                int score = -this.negamax(game, depth - 1, -Evaluation.INFINITY, -alpha, 0);
                game.unmakeSearch(undo);

                if (this.cancelled) {
                    break;
                }
                passScores[i] = score;
                if (passBestIndex < 0 || score > passBestScore) {
                    passBestScore = score;
                    passBestIndex = i;
                }
                if (score > alpha) {
                    alpha = score;
                }
                if (this.timedOut()) {
                    complete = false;
                    break;
                }
            }

            // Only trust a pass that actually looked at every move. A truncated
            // pass would leave stale scores behind, and those are what decide
            // whether a weak level deliberately misplays.
            if (passBestIndex >= 0 && (complete || !haveResult)) {
                best = rootMoves.get(passBestIndex);
                haveResult = true;
                reliable = complete;
                if (complete) {
                    bestScores = passScores;
                }
            }
            if (this.cancelled) {
                break;
            }
            if (complete && haveResult && Math.abs(passBestScore) > Evaluation.MATE_SCORE - MAX_PLY) {
                // A forced mate is worth stopping for.
                break;
            }
            if (complete) {
                // Keep the best move first for the next, better-pruning pass.
                // The scores move with the moves: the two must never drift
                // apart, or every later pass would report the wrong move.
                sortByScore(rootMoves, bestScores);
            }
        }

        if (!haveResult) {
            return rootMoves.get(0);
        }
        return reliable ? this.soften(rootMoves, bestScores, best) : best;
    }

    /** Sorts both lists together, highest score first. */
    private static void sortByScore(List<Move> moves, int[] scores) {
        Integer[] order = new Integer[moves.size()];
        for (int i = 0; i < order.length; i++) {
            order[i] = i;
        }
        final int[] current = scores;
        java.util.Arrays.sort(order, (x, y) -> Integer.compare(current[y], current[x]));

        List<Move> sortedMoves = new ArrayList<>(moves.size());
        int[] sortedScores = new int[scores.length];
        for (int i = 0; i < order.length; i++) {
            sortedMoves.add(moves.get(order[i]));
            sortedScores[i] = scores[order[i]];
        }
        moves.clear();
        moves.addAll(sortedMoves);
        System.arraycopy(sortedScores, 0, scores, 0, sortedScores.length);
    }

    /**
     * Weak levels play a slightly worse move on purpose so a beginner gets a
     * game they can win. The mistake is always a near-best move rather than a
     * random one, which is what a human beginner actually does.
     */
    private Move soften(List<Move> moves, int[] scores, Move best) {
        if (this.difficulty.blunderChance() > 0 && moves.size() > 1
                && this.random.nextInt(100) < this.difficulty.blunderChance()) {
            // Deliberately take the second or third best move.
            int[] order = rank(scores);
            int rank = 1 + this.random.nextInt(Math.min(2, order.length - 1));
            return moves.get(order[rank]);
        }
        if (this.difficulty.noise() > 0) {
            int chosen = -1;
            int chosenScore = Integer.MIN_VALUE;
            for (int i = 0; i < scores.length; i++) {
                int noisy = scores[i] + this.random.nextInt(this.difficulty.noise() * 2 + 1)
                        - this.difficulty.noise();
                if (noisy > chosenScore) {
                    chosenScore = noisy;
                    chosen = i;
                }
            }
            if (chosen >= 0) {
                return moves.get(chosen);
            }
        }
        return best;
    }

    /** Indices of the moves ordered by score, best first. */
    private static int[] rank(int[] scores) {
        Integer[] order = new Integer[scores.length];
        for (int i = 0; i < scores.length; i++) {
            order[i] = i;
        }
        final int[] current = scores;
        java.util.Arrays.sort(order, (x, y) -> Integer.compare(current[y], current[x]));
        int[] result = new int[order.length];
        for (int i = 0; i < order.length; i++) {
            result[i] = order[i];
        }
        return result;
    }

    // ------------------------------------------------------------------
    // Negamax
    // ------------------------------------------------------------------

    private int negamax(ChessGame game, int depth, int alpha, int beta, int ply) {
        this.nodes++;
        if (this.cancelled) {
            return 0;
        }
        if (ply >= MAX_PLY - 2) {
            return Evaluation.evaluate(game);
        }
        if (this.timedOut()) {
            return 0;
        }
        if (depth <= 0) {
            return this.quiescence(game, alpha, beta, ply);
        }

        List<Move> moves = game.legalMoves();
        if (moves.isEmpty()) {
            // Mate scores get a ply bonus so the engine prefers a quicker mate
            // and pushes a mate away when it is losing.
            return game.isInCheck() ? -Evaluation.MATE_SCORE + ply : 0;
        }
        this.orderMoves(game, moves, ply);

        int best = -Evaluation.INFINITY;
        for (Move move : moves) {
            ChessGame.Undo undo = game.makeSearch(move);
            int score = -this.negamax(game, depth - 1, -beta, -alpha, ply + 1);
            game.unmakeSearch(undo);

            if (this.cancelled) {
                return 0;
            }
            if (score > best) {
                best = score;
            }
            if (score > alpha) {
                alpha = score;
            }
            if (alpha >= beta) {
                this.rememberCutoff(ply, move);
                break;
            }
        }
        return best;
    }

    /**
     * Searches only captures and promotions before it is willing to judge a
     * position. Without this the engine happily grabs a queen that was about to
     * be captured anyway.
     */
    private int quiescence(ChessGame game, int alpha, int beta, int ply) {
        this.nodes++;
        if (this.cancelled || this.timedOut() || ply >= MAX_PLY - 2) {
            return Evaluation.evaluate(game);
        }
        int standPat = Evaluation.evaluate(game);
        if (standPat >= beta) {
            // Fail soft: hand back the real score rather than the window edge.
            // Clamping to beta here would make every refuted move look exactly
            // as good as the best one, because the root negates this window.
            return standPat;
        }
        if (standPat > alpha) {
            alpha = standPat;
        }

        List<Move> captures = new ArrayList<>();
        for (Move move : game.legalMoves()) {
            if (isTactical(game, move)) {
                captures.add(move);
            }
        }
        if (captures.isEmpty()) {
            return alpha;
        }
        captures.sort((a, b) -> Integer.compare(this.mvvLva(game, b), this.mvvLva(game, a)));

        for (Move move : captures) {
            ChessGame.Undo undo = game.makeSearch(move);
            int score = -this.quiescence(game, -beta, -alpha, ply + 1);
            game.unmakeSearch(undo);

            if (this.cancelled) {
                return 0;
            }
            if (this.timedOut()) {
                return alpha;
            }
            if (score >= beta) {
                return score;
            }
            if (score > alpha) {
                alpha = score;
            }
        }
        return alpha;
    }

    private static boolean isTactical(ChessGame game, Move move) {
        return !game.isEmpty(move.to()) || move.promotion() != null || move.to() == game.enPassantSquare();
    }

    /** Most valuable victim, least valuable attacker. */
    private int mvvLva(ChessGame game, Move move) {
        Piece victim = game.pieceAt(move.to());
        if (victim == null && move.to() == game.enPassantSquare()) {
            victim = game.pieceAt(move.to() + (game.sideToMove() == Side.WHITE ? 8 : -8));
        }
        Piece attacker = game.pieceAt(move.from());
        int victimValue = victim == null ? 0 : Evaluation.valueOf(victim.type());
        int attackerValue = attacker == null ? Evaluation.PAWN : Evaluation.valueOf(attacker.type());
        return victimValue * 16 - attackerValue;
    }

    // ------------------------------------------------------------------
    // Move ordering
    // ------------------------------------------------------------------

    private void orderMoves(ChessGame game, List<Move> moves, int ply) {
        int n = moves.size();
        if (n < 2) {
            return;
        }
        // Insertion sort over cached scores. The list arrives nearly ordered
        // from the previous iteration, so this is close to linear and avoids
        // allocating a comparator or a parallel array every call.
        int[] scores = new int[n];
        for (int i = 0; i < n; i++) {
            scores[i] = this.orderScore(game, moves.get(i), ply);
        }
        for (int i = 1; i < n; i++) {
            Move move = moves.get(i);
            int score = scores[i];
            int j = i - 1;
            while (j >= 0 && scores[j] < score) {
                moves.set(j + 1, moves.get(j));
                scores[j + 1] = scores[j];
                j--;
            }
            moves.set(j + 1, move);
            scores[j + 1] = score;
        }
    }

    private int orderScore(ChessGame game, Move move, int ply) {
        if (this.killers[ply][0] == move) {
            return KILLER;
        }
        if (this.killers[ply][1] == move) {
            return KILLER - 1;
        }
        if (move.promotion() != null) {
            return PROMOTION_ORDER + Evaluation.valueOf(move.promotion());
        }
        if (isTactical(game, move)) {
            return CAPTURE_ORDER + this.mvvLva(game, move);
        }
        return this.history[move.from() * 64 + move.to()];
    }

    private void rememberCutoff(int ply, Move move) {
        if (ply < 0 || ply >= MAX_PLY) {
            return;
        }
        if (this.killers[ply][0] != move) {
            this.killers[ply][1] = this.killers[ply][0];
            this.killers[ply][0] = move;
        }
        int index = move.from() * 64 + move.to();
        this.history[index] = Math.min(this.history[index] + 8, HISTORY_CAP);
    }

    private boolean timedOut() {
        // Reading the clock at every node is measurable, so only check it every
        // 256 nodes. A coarser interval lets a small budget overshoot badly,
        // because one node in a deep quiescence line is not cheap.
        if ((this.nodes & 0xFF) != 0) {
            return false;
        }
        return System.currentTimeMillis() >= this.deadline;
    }
}
