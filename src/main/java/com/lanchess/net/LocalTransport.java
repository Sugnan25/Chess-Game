/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.net;

import com.lanchess.core.ChessGame;
import com.lanchess.core.ComputerEngine;
import com.lanchess.core.Difficulty;
import com.lanchess.core.Move;
import com.lanchess.core.Side;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * A transport with no sockets: the opponent is the computer on this machine.
 *
 * <p>Because it implements the same {@link Transport} contract as the LAN
 * client and server, a single-player game runs through exactly the same
 * {@code GameSession} code as a game over the network. The human's move comes
 * in through {@link #send(Message)} and the computer's reply is handed back
 * through {@link TransportListener#onMessage(Message)} as if a remote player
 * had sent it.
 */
public final class LocalTransport implements Transport {

    /**
     * A beat before the search starts, so the board shows the opponent as
     * thinking the moment you move rather than in the same frame.
     */
    private static final long REACTION_MILLIS = 140L;

    /**
     * Random extra time on top of the level's floor. Without it every reply
     * lands at exactly the same moment and the computer sounds like a timer.
     */
    private static final long JITTER_MAX_MILLIS = 320L;

    private final Side humanSide;
    private final String humanName;
    private final Difficulty difficulty;
    private final RoomCode roomCode;
    private final AtomicBoolean closed = new AtomicBoolean(false);

    private volatile TransportListener listener;
    private volatile ChessGame game;
    private volatile Thread worker;
    private volatile ComputerEngine engine;

    public LocalTransport(ChessGame game, Side humanSide, String humanName, Difficulty difficulty) {
        this.game = game == null ? new ChessGame() : game;
        this.humanSide = humanSide == null ? Side.WHITE : humanSide;
        this.humanName = humanName == null ? "" : humanName;
        this.difficulty = difficulty == null ? Difficulty.MEDIUM : difficulty;
        this.roomCode = RoomCode.of(0);
    }

    /** Hands the transport the live position so the computer can search it. */
    public void setGame(ChessGame game) {
        if (game != null) {
            this.game = game;
        }
    }

    /**
     * Starts a search when it is the computer's turn. Used for the opening move
     * of a game and again after a rematch is accepted.
     */
    public void playOpeningMoveIfNeeded() {
        this.think();
    }

    @Override
    public Side localSide() {
        return this.humanSide;
    }

    @Override
    public String localName() {
        return this.humanName;
    }

    @Override
    public String remoteName() {
        return "Computer (" + this.difficulty.label() + ")";
    }

    public Difficulty difficulty() {
        return this.difficulty;
    }

    @Override
    public RoomCode roomCode() {
        return this.roomCode;
    }

    @Override
    public boolean isConnected() {
        return !this.closed.get();
    }

    @Override
    public void start(TransportListener listener) {
        this.listener = listener;
        listener.onConnected(new ConnectionInfo(
                this.humanSide, this.humanName, this.remoteName(), this.roomCode, this.game.toStateString(), null));
        // When the human chose black, the computer has to open the game.
        if (this.game.sideToMove() != this.humanSide) {
            this.think();
        }
    }

    @Override
    public void send(Message message) {
        if (message == null || this.closed.get()) {
            return;
        }
        switch (message.type()) {
            case MOVE:
                this.think();
                break;
            case REMATCH:
                // Answer straight away so the session can reset without a wait.
                this.deliver(Message.rematch());
                break;
            case PING:
                this.deliver(Message.pong());
                break;
            case BYE:
                this.close();
                break;
            case RESIGN:
                this.closed.set(true);
                break;
            default:
                break;
        }
    }

    @Override
    public void close() {
        if (this.closed.compareAndSet(false, true)) {
            ComputerEngine running = this.engine;
            if (running != null) {
                running.cancel();
            }
            Thread current = this.worker;
            if (current != null) {
                current.interrupt();
            }
        }
    }

    /**
     * How a reply reaches the listener. The search finishes on a worker thread
     * but the listener touches Swing, so the UI installs a marshaller that
     * hops to the event thread. Left unset, delivery is direct, which is what
     * a headless caller wants.
     */
    private volatile java.util.function.Consumer<Runnable> marshaller;

    /**
     * Installs the thread hand-off used for replies. Passing null restores
     * direct delivery.
     */
    public void setMarshaller(java.util.function.Consumer<Runnable> marshaller) {
        this.marshaller = marshaller;
    }

    private void deliver(Message message) {
        TransportListener target = this.listener;
        if (target == null || this.closed.get()) {
            return;
        }
        Runnable handoff = () -> {
            if (!this.closed.get()) {
                target.onMessage(message);
            }
        };
        java.util.function.Consumer<Runnable> post = this.marshaller;
        if (post == null) {
            handoff.run();
        } else {
            post.accept(handoff);
        }
    }

    /** Runs the search on a background thread and replies on the caller's thread. */
    private void think() {
        if (this.closed.get()) {
            return;
        }
        ChessGame position = this.game.copy();
        if (position.sideToMove() == this.humanSide || position.legalMoves().isEmpty()) {
            return;
        }
        Thread thread = new Thread(() -> {
            long startedAt = System.nanoTime();
            if (!pause(REACTION_MILLIS)) {
                return;
            }

            ComputerEngine local = new ComputerEngine();
            this.engine = local;
            local.beginSearch(this.difficulty);
            Move reply;
            try {
                reply = local.chooseMove(position);
            } catch (RuntimeException e) {
                reply = position.legalMoves().isEmpty() ? null : position.legalMoves().get(0);
            }

            // The search budget is a ceiling, so a shallow level is ready long
            // before its budget runs out. Hold the answer back to the level's
            // floor instead, which is what gives every level the same unhurried
            // pace rather than letting a depth 1 reply snap out.
            long spent = (System.nanoTime() - startedAt) / 1_000_000L;
            long floor = this.difficulty.minimumThinkMillis()
                    + ThreadLocalRandom.current().nextLong(JITTER_MAX_MILLIS);
            if (spent < floor && !pause(floor - spent)) {
                return;
            }
            if (reply != null && !this.closed.get()) {
                this.deliver(Message.move(reply));
            }
        }, "lanchess-computer");
        thread.setDaemon(true);
        this.worker = thread;
        thread.start();
    }

    /**
     * Sleeps for the given time. Returns false when the transport was closed
     * while waiting, so a caller does not deliver a reply into a dead game.
     */
    private boolean pause(long millis) {
        if (millis <= 0L) {
            return !this.closed.get();
        }
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
        return !this.closed.get();
    }
}
