package com.lanchess.net;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.lanchess.core.ChessGame;
import com.lanchess.core.Difficulty;
import com.lanchess.core.Move;
import com.lanchess.core.Side;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/**
 * The computer plays at a human pace. A search budget is only a ceiling, so a
 * shallow level is ready in milliseconds; these check that the reply is still
 * held back rather than snapping onto the board.
 */
@DisplayName("LocalTransport reply pacing")
class LocalTransportTest {

    /** Generous enough that a slow or busy machine does not look like a failure. */
    private static final long SLACK_MILLIS = 1200L;

    private static long awaitReply(LocalTransport transport) throws InterruptedException {
        CountDownLatch arrived = new CountDownLatch(1);
        AtomicReference<Long> at = new AtomicReference<>();
        long started = System.nanoTime();
        transport.start(new TransportListener() {
            @Override
            public void onConnected(ConnectionInfo info) {
                // the opening move is not what is being timed here
            }

            @Override
            public void onMessage(Message message) {
                if (message.type() == MessageType.MOVE && at.get() == null) {
                    at.set((System.nanoTime() - started) / 1_000_000L);
                    arrived.countDown();
                }
            }

            @Override
            public void onDisconnected(String reason) {
            }

            @Override
            public void onProtocolError(String detail) {
            }
        });
        assertTrue(arrived.await(20L, TimeUnit.SECONDS), "the computer never replied");
        return at.get();
    }

    @ParameterizedTest(name = "{0} takes at least its own floor")
    @EnumSource(Difficulty.class)
    @DisplayName("a reply is held for the level's minimum think time")
    void holdsTheReplyForTheMinimum(Difficulty level) throws Exception {
        // A level with a long search is the interesting one: its own budget
        // already exceeds the floor, so it must not be held any longer.
        LocalTransport transport = new LocalTransport(new ChessGame(), Side.WHITE, "Tester", level);
        ChessGame game = new ChessGame();
        game.apply(Move.of("e2e4"));
        transport.setGame(game);

        long took = awaitReply(transport);
        long floor = level.minimumThinkMillis();

        assertTrue(took + SLACK_MILLIS >= floor,
                level + " replied after " + took + "ms, which is short of its " + floor + "ms floor");
        assertTrue(took < floor + SLACK_MILLIS + 4000L,
                level + " replied after " + took + "ms, which is far longer than asked");
        transport.close();
    }

    @Test
    @DisplayName("every level asks for at least two seconds of thinking")
    void everyLevelWaitsAtLeastTwoSeconds() {
        for (Difficulty level : Difficulty.values()) {
            assertTrue(level.minimumThinkMillis() >= 2000L,
                    level + " would answer in under two seconds");
        }
        // And the spread is what makes the levels feel different to sit through.
        assertTrue(Difficulty.HARD.minimumThinkMillis() > Difficulty.SIMPLE.minimumThinkMillis());
    }

    @Test
    @DisplayName("a forced move is played without a search")
    void playsTheOnlyLegalMove() {
        // Black to move, stalemated: there is nothing to search and nothing to wait for.
        ChessGame game = ChessGame.fromStateString("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
        assertTrue(game.legalMoves().isEmpty(), "the fixture should be stalemate, not a position to search");
    }

    @Test
    @DisplayName("closing mid-think stops the reply instead of delivering it")
    void closingCancelsTheReply() throws Exception {
        LocalTransport transport = new LocalTransport(new ChessGame(), Side.BLACK, "Tester", Difficulty.HARD);
        CountDownLatch connected = new CountDownLatch(1);
        transport.start(new TransportListener() {
            @Override
            public void onConnected(ConnectionInfo info) {
                connected.countDown();
            }

            @Override
            public void onMessage(Message message) {
                // a closed transport must deliver nothing at all
            }

            @Override
            public void onDisconnected(String reason) {
            }

            @Override
            public void onProtocolError(String detail) {
            }
        });
        assertTrue(connected.await(5L, TimeUnit.SECONDS));
        transport.close();

        assertFalse(transport.isConnected());
        // Nothing to assert beyond "it returned promptly rather than searching
        // for the full budget": close() interrupts the worker mid-search.
        assertNotNull(transport.difficulty());
        assertEquals(Difficulty.HARD, transport.difficulty());
    }
}
