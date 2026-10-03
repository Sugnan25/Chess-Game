package com.lanchess.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * The rules layered on top of basic move generation: check, checkmate, castling,
 * en passant and promotion.
 *
 * <p>The perft counts are the standard published reference numbers, so a
 * regression in move generation or in the make/unmake used by the search shows
 * up here rather than in a game.
 */
class RulesTest {

    private static ChessGame pos(String state) {
        return ChessGame.fromStateString(state);
    }

    private static List<String> movesOf(ChessGame game) {
        List<String> out = new ArrayList<>();
        for (Move m : game.legalMoves()) {
            out.add(m.toAlgebraic().toLowerCase());
        }
        return out;
    }

    private static boolean can(ChessGame game, String algebraic) {
        return movesOf(game).contains(algebraic.toLowerCase());
    }

    private static int promotionMoveCount(ChessGame game) {
        int n = 0;
        for (Move m : game.legalMoves()) {
            if (m.promotion() != null) {
                n++;
            }
        }
        return n;
    }

    private static int movesFrom(ChessGame game, String from) {
        int n = 0;
        for (Move m : game.legalMoves()) {
            if (Square.nameOf(m.from()).equals(from)) {
                n++;
            }
        }
        return n;
    }

    @Nested
    @DisplayName("Check and pins")
    class Check {

        @Test
        void aPinnedPieceMayNotStepOffThePin() {
            // Black rook on e8, white rook on e2 shielding the white king on e1.
            ChessGame g = pos("4r2k/8/8/8/8/8/4R3/4K3 w - -");
            assertFalse(g.isInCheck(Side.WHITE), "the rook on e2 is shielding the king");
            assertTrue(can(g, "e2e3"), "sliding further along the file keeps blocking");
            assertTrue(can(g, "e2e5"));
            assertFalse(can(g, "e2d2"), "stepping off the file would expose the king");
                assertFalse(can(g, "e2f2"));
                // The white king is on e1, not d1. It can step to d1 or d2, but
                // not to d1 by the d1-d2 naming this test used to assume.
                assertTrue(can(g, "e1d1"), "the king itself is free to move");
                assertTrue(can(g, "e1d2"));
        }

        @Test
        void kingCannotStepOntoAnAttackedSquare() {
            // Black rook on a3 covers nothing near e1; black bishop on e2 covers d1 and f1.
            ChessGame g = pos("4k3/8/8/r7/8/8/4b3/4K3 w - -");
            assertFalse(g.isInCheck());
            assertFalse(can(g, "e1d1"), "the bishop covers d1");
            assertFalse(can(g, "e1f1"), "and f1");
            assertTrue(can(g, "e1d2"));
            assertTrue(can(g, "e1f2"));
            assertTrue(can(g, "e1e2"), "capturing an undefended bishop is fine");
        }

        @Test
        void slidersAreDetectedAlongFilesRanksAndDiagonals() {
            assertTrue(pos("4k3/8/8/8/8/8/8/r3K3 w - -").isInCheck(Side.WHITE), "rook rakes rank 1");
            assertTrue(pos("4k3/8/8/8/8/8/8/R3K2r w - -").isInCheck(Side.WHITE), "black rook on h1");
            assertTrue(pos("4k3/8/8/b7/8/8/8/4K3 w - -").isInCheck(Side.WHITE), "bishop on the long diagonal");
            assertFalse(pos("4k3/8/8/8/8/8/8/4K3 w - -").isInCheck(Side.WHITE));
        }

        @Test
        void knightsAndPawnsGiveCheck() {
            assertTrue(pos("4k3/8/8/8/8/8/2n5/4K3 w - -").isInCheck(Side.WHITE), "knight on c2 covers e1");
            assertTrue(pos("4k3/8/8/8/8/8/3p4/4K3 w - -").isInCheck(Side.WHITE), "black pawn on d2 covers e1");
        }

        @Test
        void isAttackedReportsSingleSquares() {
            ChessGame g = pos("4k3/8/8/8/8/8/3P4/4K3 w - -");
            assertTrue(g.isAttacked(Square.fromName("e3"), Side.WHITE), "the pawn on d2 attacks e3");
            assertTrue(g.isAttacked(Square.fromName("c3"), Side.WHITE), "and c3");
            assertFalse(g.isAttacked(Square.fromName("e4"), Side.WHITE));
        }
    }

    @Nested
    @DisplayName("Checkmate and stalemate")
    class Endings {

        @Test
        void foolsMateIsCheckmate() {
            ChessGame g = new ChessGame();
            g.apply(Move.of("f2f3"));
            g.apply(Move.of("e7e5"));
            g.apply(Move.of("g2g4"));
            ChessGame.MoveResult r = g.apply(Move.of("d8h4"));
            assertEquals(ChessGame.GameResult.CHECKMATE, r.outcome());
            assertTrue(g.isCheckmate());
            assertTrue(g.legalMoves().isEmpty());
        }

        @Test
        void aKingWithNowhereToGoIsStalemateNotMate() {
            ChessGame g = pos("7k/5Q2/6K1/8/8/8/8/8 b - -");
            assertTrue(g.isStalemate());
            assertFalse(g.isCheckmate());
            assertFalse(g.isInCheck());
            assertTrue(g.legalMoves().isEmpty());
        }

        @Test
        void aMoveThatStalesTheOpponentIsReported() {
            ChessGame g = pos("k7/8/8/8/2K5/8/8/1Q6 w - -");
            assertEquals(ChessGame.GameResult.STALEMATE, g.apply(Move.of("b1b6")).outcome());
        }

        @Test
        void barePiecesCannotForceMate() {
            assertTrue(pos("4k3/8/8/8/8/8/8/4K3 w - -").isInsufficientMaterial());
            assertTrue(pos("4k3/8/8/8/8/8/8/3BK3 w - -").isInsufficientMaterial());
        }

        @Test
        void pawnsAndHeavyPiecesCanStillMate() {
            assertFalse(pos("4k3/8/8/8/8/8/8/3PK3 w - -").isInsufficientMaterial());
            assertFalse(pos("4k3/8/8/8/8/8/8/3RK3 w - -").isInsufficientMaterial());
            assertFalse(pos("2b1k3/8/8/8/8/8/8/3BK3 w - -").isInsufficientMaterial(),
                    "bishops on both colours can mate");
        }
    }

    @Nested
    @DisplayName("Castling")
    class Castling {

        @Test
        void bothSidesAreAvailableOnceThePathIsClear() {
            assertFalse(can(new ChessGame(), "e1g1"), "the opening blocks the way");
            assertFalse(can(new ChessGame(), "e1c1"), "on both sides");

            ChessGame g = pos("4k3/8/8/8/8/8/8/R3K2R w KQ -");
            assertTrue(can(g, "e1g1"), "the kingside path f1 and g1 is clear");
            assertTrue(can(g, "e1c1"), "queenside needs b1, c1 and d1");
        }

        @Test
        void kingsideCastlingMovesBothPieces() {
            ChessGame g = pos("4k3/8/8/8/8/8/8/R3K2R w KQ -");
            g.apply(Move.of("e1g1"));
            assertEquals(Piece.white(PieceType.KING), g.pieceAt(Square.fromName("g1")));
            assertEquals(Piece.white(PieceType.ROOK), g.pieceAt(Square.fromName("f1")));
            assertTrue(g.isEmpty(Square.fromName("e1")));
            assertTrue(g.isEmpty(Square.fromName("h1")));
            assertFalse(g.canCastle(Side.WHITE, true), "a king that has moved cannot castle again");
            assertFalse(g.canCastle(Side.WHITE, false));
        }

        @Test
        void queensideCastlingMovesBothPieces() {
            ChessGame g = pos("4k3/8/8/8/8/8/8/R3K2R w KQ -");
            g.apply(Move.of("e1c1"));
            assertEquals(Piece.white(PieceType.KING), g.pieceAt(Square.fromName("c1")));
            assertEquals(Piece.white(PieceType.ROOK), g.pieceAt(Square.fromName("d1")));
            assertTrue(g.isEmpty(Square.fromName("a1")));
            assertTrue(g.isEmpty(Square.fromName("e1")));
        }

        @Test
        void movingTheRookRemovesThatRightOnly() {
            ChessGame g = pos("4k3/8/8/8/8/8/8/R3K2R w KQ -");
            g.apply(Move.of("h1g1"));
            assertFalse(g.canCastle(Side.WHITE, true));
            assertTrue(g.canCastle(Side.WHITE, false), "queenside is untouched");
        }

        @Test
        void capturingARookRemovesTheOpponentsRight() {
            ChessGame g = pos("r3k2r/8/8/8/8/8/8/R3K2R w KQkq -");
            g.apply(Move.of("a1a8"));
            assertEquals(Piece.white(PieceType.ROOK), g.pieceAt(Square.fromName("a8")));
            assertFalse(g.canCastle(Side.BLACK, false), "black's a8 rook is gone");
            assertTrue(g.canCastle(Side.BLACK, true), "the h8 rook is still home");
        }

        @Test
        void cannotCastleOutOfCheck() {
            ChessGame g = pos("4k3/8/8/8/8/8/4r3/R3K2R w KQ -");
            assertTrue(g.isInCheck(Side.WHITE));
            assertFalse(can(g, "e1g1"));
            assertFalse(can(g, "e1c1"));
            assertTrue(can(g, "e1e2"), "capturing the checker is the way out");
        }

        @Test
        void cannotCastleThroughAnAttackedSquare() {
            // The bishop on b5 covers f1, so the king may not pass over it.
            ChessGame g = pos("4k3/8/1b6/8/8/8/8/R3K2R w KQ -");
            assertFalse(g.isInCheck(Side.WHITE));
            assertFalse(can(g, "e1g1"), "f1 is attacked");
            assertTrue(can(g, "e1c1"), "queenside is safe");
        }

        @Test
        void cannotCastleWhenAPieceIsInTheWay() {
            ChessGame bishopBlocksKingside = pos("4k3/8/8/8/8/8/8/R3KB1R w KQ -");
            assertFalse(can(bishopBlocksKingside, "e1g1"), "the bishop sits on f1");
            assertTrue(can(bishopBlocksKingside, "e1c1"));

            ChessGame knightBlocksQueenside = pos("4k3/8/8/8/8/8/8/RN2K2R w KQ -");
            assertFalse(can(knightBlocksQueenside, "e1c1"), "the knight sits on b1");
            assertTrue(can(knightBlocksQueenside, "e1g1"));
        }

        @Test
        void aRookTravellingTwoFilesIsNotCastling() {
            ChessGame g = pos("4k3/8/8/8/8/8/8/1R2K2R w KQ -");
            assertTrue(can(g, "b1d1"), "a rook sliding two files is a normal move");
        }

        @Test
        void castlingIsNotPossibleWithoutAHomeRook() {
            ChessGame g = pos("4k3/8/8/8/8/8/8/4K3 w KQ -");
            assertFalse(can(g, "e1g1"), "no rook to castle with");
            assertFalse(can(g, "e1c1"));
        }
    }

    @Nested
    @DisplayName("En passant")
    class EnPassant {

        @Test
        void captureIsOfferedRightAfterADoublePush() {
            ChessGame g = new ChessGame();
            g.apply(Move.of("e2e4"));
            assertEquals(Square.fromName("e3"), g.enPassantSquare());
            ChessGame h = pos("rnbqkbnr/ppp1p1pp/8/3pP2P/8/8/PPPP1PPP/RNBQKBNR w KQkq f6");
            assertTrue(can(h, "e5f6"), "the pawn takes en passant");
        }

        @Test
        void theRightExpiresAfterAnyOtherMove() {
            ChessGame g = new ChessGame();
            g.apply(Move.of("e2e4"));
            g.apply(Move.of("a7a6"));
            assertEquals(-1, g.enPassantSquare(), "only the very next move may capture");
        }

        @Test
        void singlePushDoesNotOfferACapture() {
            ChessGame g = new ChessGame();
            g.apply(Move.of("e2e3"));
            assertEquals(-1, g.enPassantSquare());
        }

        @Test
        void theCapturedPawnIsRemovedFromBesideTheTarget() {
            ChessGame g = pos("4k3/8/8/3pP3/8/8/8/4K3 w - d6");
            g.apply(Move.of("e5d6"));
            assertEquals(Piece.white(PieceType.PAWN), g.pieceAt(Square.fromName("d6")));
            assertTrue(g.isEmpty(Square.fromName("d5")), "the black pawn comes off d5");
            assertTrue(g.isEmpty(Square.fromName("e5")));
        }

        @Test
        void blackCanAlsoCaptureEnPassant() {
            ChessGame g = pos("4k3/8/8/8/3Pp3/8/8/4K3 b - d3");
            assertTrue(can(g, "e4d3"));
            g.apply(Move.of("e4d3"));
            assertEquals(Piece.black(PieceType.PAWN), g.pieceAt(Square.fromName("d3")));
            assertTrue(g.isEmpty(Square.fromName("e4")));
        }

        @Test
        void aDoublePushAlsoRecordsTheSquareOnTheStateString() {
            ChessGame g = new ChessGame();
            g.apply(Move.of("d2d4"));
            assertTrue(g.toStateString().endsWith(" d3"), g.toStateString());
        }
    }

    @Nested
    @DisplayName("Promotion")
    class Promotion {

                private static final String WHITE_PROMOTION = "8/P7/8/8/8/8/8/K6k w - -";
                // A black pawn promotes from rank 2, not rank 7.
                private static final String BLACK_PROMOTION = "4k3/8/8/8/8/8/p7/4K3 b - -";

        @Test
        void allFourPiecesAreOfferedForWhite() {
            assertEquals(4, promotionMoveCount(pos(WHITE_PROMOTION)));
        }

        @Test
        void allFourPiecesAreOfferedForBlack() {
            assertEquals(4, promotionMoveCount(pos(BLACK_PROMOTION)));
        }

        @Test
        void theChosenPieceIsPlaced() {
            ChessGame g = pos(WHITE_PROMOTION);
            g.apply(new Move(Square.fromName("a7"), Square.fromName("a8"), PieceType.KNIGHT));
            assertEquals(Piece.white(PieceType.KNIGHT), g.pieceAt(Square.fromName("a8")));
        }

        @Test
        void promotingLeavesNoPawnBehind() {
            ChessGame g = pos(WHITE_PROMOTION);
            g.apply(new Move(Square.fromName("a7"), Square.fromName("a8"), PieceType.ROOK));
            assertTrue(g.isEmpty(Square.fromName("a7")));
            assertEquals(2, g.board().countOf(Side.WHITE), "king and rook only");
        }

        @Test
        void everyMoveOntoTheLastRankCarriesAPromotionPiece() {
            ChessGame g = pos(WHITE_PROMOTION);
            for (Move m : g.legalMoves()) {
                if (Square.nameOf(m.from()).equals("a7")) {
                    assertNotNull(m.promotion(), m.toAlgebraic() + " must name a promotion piece");
                }
            }
            assertEquals(4, movesFrom(g, "a7"));
        }

                @Test
                void aPromotedRookIsFullyActive() {
                    ChessGame g = pos(WHITE_PROMOTION);
                    g.apply(new Move(Square.fromName("a7"), Square.fromName("a8"), PieceType.ROOK));
                    // It is now Black's turn, so the rook's own moves are tested
                    // on a copy with the side to move set back to White.
                    ChessGame white = g.copy();
                    white.setSideToMove(Side.WHITE);
                    assertTrue(can(white, "a8a4"), "the rook now slides down the file");
                    assertTrue(can(white, "a8h8"), "and along the back rank");
                }

                @Test
                void aPromotedRookDoesNotOweBlackAPromotion() {
                    // Promotion is the mover's choice. After White promotes on a8
                    // it is Black to move, and Black's own pieces must move
                    // normally, promotion field or not.
                    ChessGame g = pos(WHITE_PROMOTION);
                    g.apply(new Move(Square.fromName("a7"), Square.fromName("a8"), PieceType.ROOK));
                    assertEquals(Side.BLACK, g.sideToMove());
                    assertFalse(g.legalMoves().isEmpty(), "Black still has king moves");
                }

                @Test
                void aRookMayLandOnTheLastRankWithoutPromoting() {
                    // Only a pawn is bound to promote. A rook or a knight moving
                    // onto rank 8 is an ordinary move, and demanding a promotion
                    // piece here would delete most of the back rank.
                    ChessGame g = pos("4k3/8/8/8/8/8/8/R3K3 w - -");
                    assertTrue(can(g, "a1a8"), "a rook may move to the eighth rank");
                    assertTrue(can(g, "a1a7"));

                    ChessGame knights = pos("4k3/8/8/8/8/8/8/1N2K3 w - -");
                    assertTrue(can(knights, "b1a3"));
                    assertTrue(can(knights, "b1c3"));
                }
    }

    @Nested
    @DisplayName("Perft reference counts")
    class Perft {

        private static long perft(ChessGame game, int depth) {
            List<Move> moves = game.legalMoves();
            if (depth == 1) {
                return moves.size();
            }
            long total = 0;
            for (Move m : moves) {
                ChessGame child = game.copy();
                child.apply(m);
                total += perft(child, depth - 1);
            }
            return total;
        }

        private static void assertPerft(String state, int depth, long expected) {
            assertEquals(expected, perft(pos(state), depth), "perft(" + depth + ") of " + state);
        }

        @Test
        void startingPosition() {
            String fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
            assertPerft(fen, 1, 20);
            assertPerft(fen, 2, 400);
            assertPerft(fen, 3, 8902);
            assertPerft(fen, 4, 197281);
        }

        @Test
        void kiwipeteCoversCastlingAndEnPassant() {
            String fen = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -";
            assertPerft(fen, 1, 48);
            assertPerft(fen, 2, 2039);
            assertPerft(fen, 3, 97862);
        }

        @Test
        void endgameWithEnPassantAvailable() {
            String fen = "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -";
            assertPerft(fen, 1, 14);
            assertPerft(fen, 2, 191);
            assertPerft(fen, 3, 2812);
        }

        @Test
        void positionFullOfPromotions() {
            String fen = "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq -";
            assertPerft(fen, 1, 6);
            assertPerft(fen, 2, 264);
            assertPerft(fen, 3, 9467);
        }

        @Test
        void positionWithPromotionAndChecks() {
            String fen = "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ -";
            assertPerft(fen, 1, 44);
            assertPerft(fen, 2, 1486);
            assertPerft(fen, 3, 62379);
        }
    }

    @Nested
    @DisplayName("State integrity")
    class State {

        @Test
        void castlingRightsSurviveSerialisation() {
            ChessGame g = pos("4k3/8/8/8/8/8/8/R3K2R w KQ -");
            g.apply(Move.of("e1g1"));
            ChessGame back = ChessGame.fromStateString(g.toStateString());
            assertFalse(back.canCastle(Side.WHITE, true));
            assertFalse(back.canCastle(Side.WHITE, false));
            assertEquals(g.toStateString(), back.toStateString());
        }

        @Test
        void untouchedRightsSurviveSerialisation() {
            ChessGame g = pos("4k3/8/8/8/8/8/8/R3K2R w KQ -");
            ChessGame back = ChessGame.fromStateString(g.toStateString());
            assertTrue(back.canCastle(Side.WHITE, true));
            assertTrue(back.canCastle(Side.WHITE, false));
            assertTrue(can(back, "e1g1"), "and the move is still offered");
        }

        @Test
        void enPassantSquareSurvivesSerialisation() {
            ChessGame g = new ChessGame();
            g.apply(Move.of("e2e4"));
            ChessGame back = ChessGame.fromStateString(g.toStateString());
            assertEquals(Square.fromName("e3"), back.enPassantSquare());
        }

        @Test
        void probingLegalityLeavesNoTrace() {
            ChessGame g = new ChessGame();
            String before = g.toStateString();
            for (Move m : g.legalMoves()) {
                assertTrue(g.isLegal(m));
                assertEquals(before, g.toStateString(), "isLegal must restore the position");
            }
        }
    }
}
