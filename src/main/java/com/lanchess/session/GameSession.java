/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.session;

import com.lanchess.core.ChessGame;
import com.lanchess.core.Move;
import com.lanchess.core.Piece;
import com.lanchess.core.PieceType;
import com.lanchess.core.Side;
import com.lanchess.core.Square;
import com.lanchess.net.LocalTransport;
import com.lanchess.net.Message;
import com.lanchess.net.Transport;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class GameSession {

    /** The four pieces a pawn may become, in the order they are offered. */
    private static final PieceType[] PROMOTION_PIECES = {
        PieceType.QUEEN, PieceType.ROOK, PieceType.BISHOP, PieceType.KNIGHT
    };

    private ChessGame game;
    private Transport transport;
    private Listener listener;
    private PromotionChooser promotionChooser = side -> PieceType.QUEEN;
    private int selected = -1;
    private MoveMark lastMove;
    private final List<String> history = new ArrayList<String>();
    private String status = "";
    private boolean finished;
    private boolean localRematchReady;
    private boolean remoteRematchReady;
    private boolean rematchOfferShown;

    public GameSession(ChessGame game) {
        this.game = game;
    }

    public void setListener(Listener listener) {
        this.listener = listener;
    }

    /** Asks the player which piece a promoting pawn becomes. */
    public void setPromotionChooser(PromotionChooser chooser) {
        this.promotionChooser = chooser == null ? (side -> PieceType.QUEEN) : chooser;
    }

    public void attach(Transport transport) {
        this.transport = transport;
        this.syncLocalTransport();
    }

    /**
     * The computer plays off a copy of the live position, so it has to be
     * re-pointed every time the session's game object changes.
     */
    private void syncLocalTransport() {
        if (this.transport instanceof LocalTransport) {
            ((LocalTransport) this.transport).setGame(this.game);
        }
    }

    public ChessGame game() {
        return this.game;
    }

    public Side localSide() {
        return this.transport == null ? Side.WHITE : this.transport.localSide();
    }

    public String localName() {
        return this.transport == null ? "" : this.transport.localName();
    }

    public String remoteName() {
        return this.transport == null ? "Opponent" : GameSession.orDefault(this.transport.remoteName(), "Opponent");
    }

    public String status() {
        return this.status;
    }

    public boolean isFinished() {
        return this.finished;
    }

    public MoveMark lastMove() {
        return this.lastMove;
    }

    public int selected() {
        return this.selected;
    }

    public boolean isRemoteRematchReady() {
        return this.remoteRematchReady;
    }

    public void setGame(ChessGame game) {
        this.game = game;
        this.selected = -1;
        this.lastMove = null;
        this.finished = false;
        this.history.clear();
        this.syncLocalTransport();
    }

    public List<String> history() {
        return Collections.unmodifiableList(this.history);
    }

    public int plyCount() {
        return this.history.size();
    }

    private void record(Move move) {
        this.history.add(move.toAlgebraic());
    }

    public void onLocalSquareClicked(int square) {
        if (!this.canPlayNow()) {
            return;
        }
        if (this.selected >= 0 && this.selected != square && this.canReach(this.selected, square)) {
            Move candidate = this.buildMove(this.selected, square);
            if (candidate != null) {
                this.commitLocal(candidate);
            }
            return;
        }
        Piece piece = this.game.pieceAt(square);
        if (piece != null && piece.side() == this.localSide()) {
            this.selected = this.selected == square ? -1 : square;
            this.refresh();
        } else {
            this.selected = -1;
            this.refresh();
        }
    }

    /** True when a click from the local player would be accepted. */
    public boolean canPlayNow() {
        return !this.finished
                && this.transport != null
                && this.transport.isConnected()
                && this.game.sideToMove() == this.localSide();
    }

    /**
     * Moves a piece directly, for a caller that has already done its own
     * click-to-click selection, such as the web board.
     *
     * @param promotion the piece a promoting pawn becomes, or null to be asked
     * @return true when the move was legal and played
     */
    public boolean playLocalMove(int from, int to, PieceType promotion) {
        if (!this.canPlayNow() || from == to) {
            return false;
        }
        Move candidate = this.needsPromotion(from, to) ? new Move(from, to, promotion) : new Move(from, to);
        if (!this.game.isLegal(candidate)) {
            return false;
        }
        this.commitLocal(candidate);
        return true;
    }

    /**
     * The destinations the selected piece may legally reach. A promoting pawn
     * reports the square once even though it has four legal forms, so the web
     * board can offer a single target and ask for the piece afterwards.
     */
    public int[] destinationsFor(int square) {
        if (!this.canPlayNow() || square < 0) {
            return new int[0];
        }
        Piece piece = this.game.pieceAt(square);
        if (piece == null || piece.side() != this.localSide()) {
            return new int[0];
        }
        int[] targets = this.game.legalTargetsFrom(square);
        if (targets == null) {
            targets = new int[0];
        }
        return targets;
    }

    /** True when moving from to square needs the player to pick a new piece. */
    public boolean needsPromotionChoice(int from, int to) {
        return this.needsPromotion(from, to);
    }

    /**
     * True when some version of the move is legal. A promoting pawn always has
     * four legal forms, so a plain two-square move is never legal for it and
     * the check has to look at all of them.
     */
    private boolean canReach(int from, int to) {
        if (this.needsPromotion(from, to)) {
            for (PieceType piece : PROMOTION_PIECES) {
                if (this.game.isLegal(new Move(from, to, piece))) {
                    return true;
                }
            }
            return false;
        }
        return this.game.isLegal(new Move(from, to));
    }

    private boolean needsPromotion(int from, int to) {
        Piece piece = this.game.pieceAt(from);
        if (piece == null || piece.type() != PieceType.PAWN) {
            return false;
        }
        int lastRow = piece.side() == Side.WHITE ? 0 : 7;
        return Square.rankRowOf(to) == lastRow;
    }

    private Move buildMove(int from, int to) {
        if (!this.needsPromotion(from, to)) {
            return new Move(from, to);
        }
        PieceType choice = this.promotionChooser.choose(this.localSide());
        if (choice == null) {
            this.selected = -1;
            this.refresh();
            return null;
        }
        return new Move(from, to, choice);
    }

    private void commitLocal(Move move) {
        List<MoveMark.Relocation> relocations = this.relocationsFor(move);
        ChessGame.MoveResult result = this.game.apply(move);
        this.selected = -1;
        this.record(move);
        this.lastMove = new MoveMark(move.from(), move.to(), relocations);
        this.syncLocalTransport();
        this.transport.send(Message.move(move));
        this.settle(result);
    }

    /**
     * Every piece that changes square because of this move, worked out while the
     * board still holds the old position.
     *
     * <p>A castled rook and an en passant victim are not standing on the move's
     * own two squares. A board animation told only about the piece that was
     * dragged would leave them blinking out and back in, so the session hands
     * over the whole set and the viewer slides each one.
     */
    private List<MoveMark.Relocation> relocationsFor(Move move) {
        List<MoveMark.Relocation> out = new ArrayList<>(2);
        out.add(new MoveMark.Relocation(move.from(), move.to()));

        Piece mover = this.game.pieceAt(move.from());
        if (mover == null) {
            return out;
        }
        if (mover.type() == PieceType.KING && Math.abs(move.to() - move.from()) == 2) {
            // Castling: the rook starts in the far corner on the side the king
            // travelled towards and finishes on the square just beyond the king,
            // so e1-g1 pairs the rook on h1 with f1 and e1-c1 pairs a1 with d1.
            int row = Square.rankRowOf(move.from());
            boolean towardsHighFiles = move.to() > move.from();
            int corner = row * 8 + (towardsHighFiles ? 7 : 0);
            if (this.game.pieceAt(corner) != null) {
                out.add(new MoveMark.Relocation(corner, move.to() + (towardsHighFiles ? -1 : 1)));
            }
            return out;
        }
        if (mover.type() == PieceType.PAWN) {
            int target = this.game.enPassantSquare();
            if (target >= 0 && move.to() == target) {
                // The captured pawn sits beside the target, not on it.
                out.add(new MoveMark.Relocation(
                        target + (mover.side() == Side.WHITE ? 8 : -8), target));
            }
        }
        return out;
    }


    /**
     * Turns an engine result into a win, a loss or a draw. The rules engine can
     * now end a game by checkmate, stalemate or insufficient material as well as
     * by capturing a king.
     */
    private void settle(ChessGame.MoveResult result) {
        Side local = this.localSide();
        ChessGame.GameResult outcome = result.outcome();
        switch (outcome) {
            case KING_CAPTURED: {
                boolean localWon = result.captured().isBlack() == (local == Side.WHITE);
                this.finish(localWon ? "You won" : "You lost",
                        localWon ? "You captured the king." : this.remoteName() + " captured your king.", localWon);
                return;
            }
            case CHECKMATE: {
                // The side to move has just been mated.
                boolean localWon = this.game.sideToMove() != local;
                this.finish(localWon ? "Checkmate - you won" : "Checkmate - you lost",
                        localWon ? this.remoteName() + " is checkmated." : "You are checkmated.", localWon);
                return;
            }
            case STALEMATE: {
                this.finish("Draw by stalemate",
                        this.game.sideToMove() == local
                                ? "You have no legal move but are not in check."
                                : this.remoteName() + " has no legal move but is not in check.", false);
                return;
            }
            case INSUFFICIENT_MATERIAL: {
                this.finish("Draw - not enough material", "Neither side can deliver checkmate.", false);
                return;
            }
            default:
                this.updateStatus();
                this.refresh();
        }
    }

    public void onRemoteMessage(Message message) {
        switch (message.type()) {
            case MOVE: {
                this.applyRemoteMove(message);
                break;
            }
            case RESIGN: {
                this.applyRemoteResign();
                break;
            }
            case REMATCH: {
                this.applyRemoteRematch();
                break;
            }
            case ERROR: {
                this.reportError(message.text());
                break;
            }
            case BYE: {
                this.reportError(message.text());
                break;
            }
        }
    }

    private void applyRemoteMove(Message message) {
        Move move;
        try {
            move = message.move();
        }
        catch (RuntimeException e) {
            this.reportError("Opponent sent an unreadable move.");
            return;
        }
        if (this.finished || !this.game.isLegal(move)) {
            this.reportError("Opponent sent a move that is not allowed: " + message.text());
            return;
        }
        List<MoveMark.Relocation> relocations = this.relocationsFor(move);
        ChessGame.MoveResult result = this.game.apply(move);
        this.selected = -1;
        this.record(move);
        this.lastMove = new MoveMark(move.from(), move.to(), relocations);
        this.syncLocalTransport();
        this.settle(result);
    }

    private void applyRemoteResign() {
        if (this.finished) {
            return;
        }
        this.finish("You won", this.remoteName() + " resigned.", true);
    }

    public void onDisconnected(String reason) {
        if (this.finished) {
            return;
        }
        this.finished = true;
        this.selected = -1;
        String detail = reason == null || reason.isBlank() ? "The opponent disconnected." : reason;
        this.notifyStatus(detail);
        if (this.listener != null) {
            this.listener.onGameOver("Opponent disconnected", detail, false);
        }
        this.refresh();
    }

    private void applyRemoteRematch() {
        this.remoteRematchReady = true;
        if (this.localRematchReady) {
            this.resetForRematch();
        } else if (!this.rematchOfferShown) {
            this.rematchOfferShown = true;
            if (this.listener != null) {
                this.listener.onRematchRequested();
            }
        }
    }

    public void resign() {
        if (this.finished || this.transport == null || !this.transport.isConnected()) {
            return;
        }
        this.transport.send(Message.resign());
        this.finish("You resigned", this.localSide() == Side.WHITE ? "Black wins." : "White wins.", false);
    }

    public void offerRematch() {
        if (this.transport == null || !this.transport.isConnected()) {
            return;
        }
        this.localRematchReady = true;
        this.transport.send(Message.rematch());
        this.rematchOfferShown = false;
        if (this.remoteRematchReady) {
            this.resetForRematch();
        } else {
            this.notifyStatus("Waiting for " + this.remoteName() + " to accept the rematch.");
        }
    }

    private void resetForRematch() {
        ChessGame fresh = new ChessGame();
        // The computer opens a rematch, so the side to move has to be the one
        // that is not the local player. Over a network the remote side starts.
        fresh.setSideToMove(this.localSide() == Side.WHITE ? Side.BLACK : Side.WHITE);
        this.game = fresh;
        this.selected = -1;
        this.lastMove = null;
        this.finished = false;
        this.history.clear();
        this.localRematchReady = false;
        this.remoteRematchReady = false;
        this.rematchOfferShown = false;
        this.syncLocalTransport();
        if (this.listener != null) {
            this.listener.onRematchCleared();
        }
        this.updateStatus();
        this.refresh();
        // The computer opens the new game, so ask it to move if that is its turn.
        if (this.transport instanceof LocalTransport local) {
            local.playOpeningMoveIfNeeded();
        }
    }

    public void updateStatus() {
        if (this.finished) {
            return;
        }
        if (this.game.sideToMove() == this.localSide()) {
            this.notifyStatus("Your move  -  you play " + this.localSide().name().toLowerCase());
        } else {
            this.notifyStatus("Waiting for " + this.remoteName() + " to move");
        }
    }

    private void finish(String headline, String detail, boolean localWon) {
        this.finished = true;
        this.selected = -1;
        this.notifyStatus(detail);
        if (this.listener != null) {
            this.listener.onGameOver(headline, detail, localWon);
        }
        this.refresh();
    }

    private void reportError(String detail) {
        if (this.listener != null && detail != null && !detail.isBlank()) {
            this.listener.onError(detail);
        }
    }

    private void notifyStatus(String text) {
        String string = this.status = text == null ? "" : text;
        if (this.listener != null) {
            this.listener.onStatusChanged(this.status);
        }
    }

    private void refresh() {
        if (this.listener != null) {
            this.listener.onStateChanged();
        }
    }

    private static String orDefault(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    public static interface Listener {
        public void onStateChanged();

        public void onStatusChanged(String var1);

        public void onGameOver(String var1, String var2, boolean var3);

        public void onRematchRequested();

        public void onRematchCleared();

        public void onError(String var1);
    }

    /** Asks which piece a promoting pawn becomes, or null to cancel the move. */
    public static interface PromotionChooser {
        public PieceType choose(Side side);
    }

    /**
     * The two squares of the move just played, plus every other piece the move
     * carried with it. The web layer highlights the first pair and slides the
     * whole set, so the session no longer needs to know anything about Swing
     * components.
     */
    public static final class MoveMark {
        private final int from;
        private final int to;
        private final List<Relocation> relocations;

        MoveMark(int from, int to, List<Relocation> relocations) {
            this.from = from;
            this.to = to;
            this.relocations = relocations == null
                    ? Collections.<Relocation>emptyList()
                    : Collections.unmodifiableList(new ArrayList<>(relocations));
        }

        public int from() {
            return this.from;
        }

        public int to() {
            return this.to;
        }

        /** Never empty: the piece that was moved is always the first entry. */
        public List<Relocation> relocations() {
            return this.relocations;
        }

        /** One piece travelling from one square to another. */
        public static final class Relocation {
            private final int from;
            private final int to;

            public Relocation(int from, int to) {
                this.from = from;
                this.to = to;
            }

            public int from() {
                return this.from;
            }

            public int to() {
                return this.to;
            }
        }
    }
}

