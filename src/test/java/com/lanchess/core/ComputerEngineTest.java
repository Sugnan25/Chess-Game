package com.lanchess.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Random;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

/**
 * Behaviour of the computer opponent. These avoid exact move numbers wherever a
 * different but equally strong move would pass, and only pin down the choices
 * that a real player would call a mistake.
 */
class ComputerEngineTest {

    private static Move best(ChessGame game, Difficulty level) {
        return ComputerEngine.chooseMove(game, level, new Random(20260930L));
    }

    /** Same, but with a tight clock so a long game does not stall the suite. */
    private static Move quick(ChessGame game, Difficulty level, long seed) {
        return ComputerEngine.chooseMove(game, level, new Random(seed), 25L);
    }

    private static String bestAlgebraic(ChessGame game, Difficulty level) {
        Move move = best(game, level);
        assertNotNull(move, "the engine must return a move");
        return move.toAlgebraic();
    }

    @Nested
    @DisplayName("Tactics")
    class Tactics {

        // These run at HARD, which is the only level that never deliberately
        // misplays. Asserting an exact move on a level that picks a weaker one
        // on purpose would only be testing the dice.

        @Test
        void takesAHangingQueen() {
            // Black queen on d5 is attacked by the rook on d1 and is not defended.
            ChessGame g = ChessGame.fromStateString("4k3/8/8/3q4/8/8/8/3RK3 w - -");
            assertFalse(g.isInCheck(Side.WHITE));
            assertEquals("d1d5", bestAlgebraic(g, Difficulty.HARD));
        }

        @Test
        void findsMateInOne() {
            // Ra1-a8 is mate: the black king on g8 has its own pawns in the way.
            ChessGame g = ChessGame.fromStateString("6k1/5ppp/8/8/8/8/8/R5K1 w - -");
            assertEquals("a1a8", bestAlgebraic(g, Difficulty.HARD));
        }

        @Test
        void aKnightMayJumpOntoTheEighthRank() {
            // Regression: treating the last rank as "must promote" for every
            // piece would make Nb8 and Ra8 illegal and cripple the whole game.
            ChessGame g = ChessGame.fromStateString("4k3/8/8/8/8/8/8/1N2K3 w - -");
            assertTrue(g.isLegal(Move.of("b1a3")));
            assertTrue(g.isLegal(Move.of("b1c3")));
        }

        @Test
        void prefersTheMateOverGainingMaterial() {
            // Rb1 can win the free b4 pawn, but Ra1-a8 mates first. The two
            // candidate moves sit on different files, so the pawn cannot also
            // be blocking the mating rook's path.
            ChessGame g = ChessGame.fromStateString("7k/5ppp/8/8/1p6/8/8/RR4K1 w - -");
            assertTrue(g.isLegal(Move.of("b1b4")), "the other rook could take the pawn instead");
            assertEquals("a1a8", bestAlgebraic(g, Difficulty.HARD));
        }

        @Test
        void takesTheQueenOutOfCheck() {
            // White is in check from Qf2, and Kxf2 wins the queen.
            ChessGame g = ChessGame.fromStateString("4k3/8/8/8/8/8/5q2/4K2R w K -");
            assertTrue(g.isInCheck(Side.WHITE));
            assertEquals("e1f2", bestAlgebraic(g, Difficulty.HARD));
        }

        @Test
        void seesADefendedPieceIsNotFree() {
            // The knight on c3 is defended by the b1 knight, so capturing it
            // just loses a piece for nothing.
            ChessGame g = ChessGame.fromStateString("4k3/8/8/8/8/2n5/8/1N2K3 w - -");
            assertNotEquals("c3b2", bestAlgebraic(g, Difficulty.HARD));
        }

        @Test
        void everyLevelStillSpotsAFreeQueenMostOfTheTime() {
            // The weaker levels may misplay, but not on every single move.
            ChessGame g = ChessGame.fromStateString("4k3/8/8/3q4/8/8/8/3RK3 w - -");
            int found = 0;
            for (int seed = 0; seed < 40; seed++) {
                if ("d1d5".equals(ComputerEngine.chooseMove(g, Difficulty.SIMPLE, new Random(seed)).toAlgebraic())) {
                    found++;
                }
            }
            assertTrue(found >= 10,
                    "simple should take a free queen now and then, did so " + found + "/40 times");
        }
    }

    @Nested
    @DisplayName("Legality and safety")
    class Legality {

        @Test
        void onlyEverReturnsALegalMove() {
            ChessGame g = new ChessGame();
            for (int ply = 0; ply < 80; ply++) {
                List<Move> legal = g.legalMoves();
                if (legal.isEmpty()) {
                    return;
                }
                Move move = quick(g, Difficulty.MEDIUM, ply);
                assertNotNull(move);
                assertTrue(g.isLegal(move), "engine played an illegal move: " + move);
                g.apply(move);
            }
        }

        /*
         * A full game is played out at every level to prove the search never
         * offers an illegal move. HARD searches to depth 6, so this is the
         * longest test in the suite and the allowance is generous on purpose:
         * a busy machine slows it down without meaning anything is wrong.
         */
        @Test
        @Timeout(420)
        void survivesAWholeSelfPlayGameAtEveryLevel() {
            for (Difficulty level : Difficulty.values()) {
                ChessGame g = new ChessGame();
                for (int ply = 0; ply < 160; ply++) {
                    List<Move> legal = g.legalMoves();
                    if (legal.isEmpty()) {
                        break;
                    }
                    Move move = quick(g, level, ply + 7);
                    assertNotNull(move, level + " returned no move at ply " + ply);
                    assertTrue(g.isLegal(move), level + " played an illegal move: " + move);
                    g.apply(move);
                }
            }
        }

        @Test
        void leavesThePositionExactlyAsItFoundIt() {
            ChessGame g = new ChessGame();
            g.apply(Move.of("e2e4"));
            g.apply(Move.of("e7e5"));
            String before = g.toStateString();
            ComputerEngine.chooseMove(g, Difficulty.MEDIUM, new Random(1));
            assertEquals(before, g.toStateString(), "the search must undo everything it did");
        }

        @Test
        void returnsNothingWhenTheGameIsAlreadyOver() {
            assertNull(best(ChessGame.fromStateString("7k/5Q2/6K1/8/8/8/8/8 b - -"), Difficulty.MEDIUM),
                    "a stalemated king has no move to make");
        }

        @Test
        void promotesWhenAPawnReachesTheLastRank() {
            // HARD only, so the assertion is about the search rather than
            // about a level that misplays on purpose.
            ChessGame g = ChessGame.fromStateString("4k3/P7/8/8/8/8/8/4K3 w - -");
            Move move = best(g, Difficulty.HARD);
            assertNotNull(move);
            assertEquals(Square.fromName("a8"), move.to());
            assertNotNull(move.promotion(), "a pawn on the eighth rank must promote");
        }

        @Test
        void castlesWhenItIsSafeAndWorthIt() {
            ChessGame g = ChessGame.fromStateString("r3k2r/8/8/8/8/8/6q1/R3K2R w KQkq -");
            Move move = best(g, Difficulty.MEDIUM);
            assertNotNull(move);
            assertTrue(g.isLegal(move));
        }
    }

    @Nested
    @DisplayName("Difficulty")
    class Levels {

        @Test
        void everyLevelReturnsAUsableMove() {
            ChessGame g = new ChessGame();
            for (Difficulty level : Difficulty.values()) {
                Move move = best(g, level);
                assertNotNull(move, level + " produced no move");
                assertTrue(g.isLegal(move), level + " produced an illegal move");
            }
        }

        @Test
        void hardIsNeverWeakerThanSimpleOnATactic() {
            // The deep level must always take the free queen.
            ChessGame g = ChessGame.fromStateString("4k3/8/8/3q4/8/8/8/3RK3 w - -");
            for (int seed = 0; seed < 10; seed++) {
                assertEquals("d1d5",
                        ComputerEngine.chooseMove(g, Difficulty.HARD, new Random(seed)).toAlgebraic(),
                        "hard missed the free queen on seed " + seed);
            }
        }

        @Test
        @Timeout(30)
        void respectsItsTimeBudget() {
            ChessGame g = new ChessGame();
            for (Difficulty level : Difficulty.values()) {
                long started = System.currentTimeMillis();
                ComputerEngine engine = new ComputerEngine();
                engine.beginSearch(level);
                engine.chooseMove(g);
                long took = System.currentTimeMillis() - started;
                assertTrue(took < 12000L, level + " took " + took + "ms, well past its budget");
            }
        }

        @Test
        void aLongerBudgetSearchesDeeper() {
            ChessGame g = new ChessGame();
            ComputerEngine quick = new ComputerEngine(new Random(1));
            quick.beginSearch(Difficulty.SIMPLE);
            quick.chooseMove(g);
            ComputerEngine thorough = new ComputerEngine(new Random(1));
            thorough.beginSearch(Difficulty.MEDIUM);
            thorough.chooseMove(g);
            assertTrue(thorough.nodes() > quick.nodes(),
                    "medium (" + thorough.nodes() + ") should visit more nodes than simple (" + quick.nodes() + ")");
        }

        @Test
        @Timeout(60)
        void hardVisitsManyMoreNodesThanSimple() {
            ChessGame g = new ChessGame();
            int[] counts = new int[2];
            ComputerEngine simple = new ComputerEngine(new Random(5));
            simple.beginSearch(Difficulty.SIMPLE);
            simple.chooseMove(g);
            counts[0] = simple.nodes();

            ComputerEngine hard = new ComputerEngine(new Random(5));
            hard.beginSearch(Difficulty.HARD, 400L);
            hard.chooseMove(g);
            counts[1] = hard.nodes();

            assertTrue(counts[1] > counts[0] * 5,
                    "hard (" + counts[1] + ") should search far deeper than simple (" + counts[0] + ")");
        }
    }

    @Nested
    @DisplayName("Evaluation")
    class Scores {

        @Test
        void theOpeningIsRoughlyLevel() {
            int score = Evaluation.evaluate(new ChessGame());
            assertTrue(score > 0 && score <= 15, "start position should be near even, was " + score);
        }

        @Test
        void aFreeQueenIsWorthALot() {
            ChessGame g = ChessGame.fromStateString("4k3/8/8/8/8/8/4Q3/4K3 w - -");
            assertTrue(Evaluation.evaluate(g) > Evaluation.QUEEN / 2);
        }

        @Test
        void beingAheadIsAPositiveScoreForTheSideToMove() {
            ChessGame white = ChessGame.fromStateString("4k3/8/8/8/8/8/4Q3/4K3 w - -");
            assertTrue(Evaluation.evaluate(white) > 0);
        }

        @Test
        void centralKnightsBeatCornerKnights() {
            ChessGame centre = ChessGame.fromStateString("4k3/8/8/3N4/8/8/8/4K3 w - -");
            ChessGame corner = ChessGame.fromStateString("4k3/8/8/8/8/8/8/N3K3 w - -");
            assertTrue(Evaluation.evaluate(centre) > Evaluation.evaluate(corner));
        }
    }
}
