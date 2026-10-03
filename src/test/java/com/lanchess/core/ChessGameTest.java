package com.lanchess.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** Rules engine: squares, FEN handling, move generation and game end detection. */
class ChessGameTest {

    private static final String START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

    private static ChessGame fromFen(String fen) {
        return new ChessGame(Board.fromFenPiecePlacement(fen));
    }

    private static ChessGame after(String... moves) {
        ChessGame g = new ChessGame();
        for (String m : moves) {
            g.apply(Move.of(m));
        }
        return g;
    }

    @Nested
    @DisplayName("Square")
    class Squares {

        @Test
        void a8IsIndexZeroAndH1IsIndex63() {
            assertEquals(0, Square.fromName("a8"));
            assertEquals(63, Square.fromName("h1"));
            assertEquals(Square.COUNT, 64);
        }

        @Test
        void namesRoundTripForEverySquare() {
            for (int i = 0; i < 64; i++) {
                assertEquals(i, Square.fromName(Square.nameOf(i)), "square " + i);
            }
        }

        @Test
        void fileAndRankAreDerivedFromIndex() {
            int d4 = Square.fromName("d4");
            assertEquals(3, Square.fileOf(d4));
            assertEquals(4, Square.rankOf(d4));
            assertEquals(4, Square.rankRowOf(d4));
        }

        @Test
        void invalidIndicesAreRejected() {
            assertFalse(Square.isValid(-1));
            assertFalse(Square.isValid(64));
            assertTrue(Square.isValid(0));
            assertTrue(Square.isValid(63));
            assertThrows(IllegalArgumentException.class, () -> Square.nameOf(64));
            assertThrows(IllegalArgumentException.class, () -> Square.of(8, 0));
            assertThrows(IllegalArgumentException.class, () -> Square.of(0, -1));
        }

        @Test
        void malformedSquareNamesAreRejected() {
            assertThrows(IllegalArgumentException.class, () -> Square.fromName("e"));
            assertThrows(IllegalArgumentException.class, () -> Square.fromName("z2"));
            assertThrows(IllegalArgumentException.class, () -> Square.fromName("e9"));
            assertThrows(IllegalArgumentException.class, () -> Square.fromName(null));
        }

        @Test
        void labelsMatchNameCharacters() {
            assertEquals('a', Square.fileLabel(Square.fileOf(Square.fromName("a4"))));
            assertEquals(4, Square.rowLabel(Square.rankRowOf(Square.fromName("a4"))));
        }
    }

    @Nested
    @DisplayName("Board and FEN")
    class Boards {

        @Test
        void startingPositionHasThirtyTwoPieces() {
            Board b = Board.starting();
            assertEquals(32, b.countOf(Side.WHITE) + b.countOf(Side.BLACK));
            assertEquals(16, b.countOf(Side.WHITE));
            assertEquals(16, b.countOf(Side.BLACK));
        }

        @Test
        void startingPositionMatchesStandardFen() {
            assertEquals(START_FEN, Board.starting().toFenPiecePlacement());
        }

        @Test
        void fenRoundTripsForStartingPosition() {
            assertEquals(START_FEN, Board.fromFenPiecePlacement(START_FEN).toFenPiecePlacement());
        }

        @Test
        void fenRoundTripsWhenSquaresAreCleared() {
            Board b = Board.starting();
            b.clear(Square.fromName("a1"));
            b.clear(Square.fromName("e4"));
            String fen = b.toFenPiecePlacement();
            assertEquals(fen, Board.fromFenPiecePlacement(fen).toFenPiecePlacement());
        }

        @Test
        void fenParserPlacesPiecesOnCorrectSquares() {
            Board b = fromFen(START_FEN).board();
            assertEquals(Piece.white(PieceType.ROOK), b.get(Square.fromName("a1")));
            assertEquals(Piece.white(PieceType.KING), b.get(Square.fromName("e1")));
            assertEquals(Piece.black(PieceType.KING), b.get(Square.fromName("e8")));
            assertEquals(Piece.black(PieceType.QUEEN), b.get(Square.fromName("d8")));
        }

        @Test
        void fenWithDigitsSkipsEmptyFilesCorrectly() {
            Board b = Board.fromFenPiecePlacement("8/8/8/8/8/8/4P3/4K3");
            assertEquals(Piece.white(PieceType.PAWN), b.get(Square.fromName("e2")));
            assertEquals(Piece.white(PieceType.KING), b.get(Square.fromName("e1")));
            assertTrue(b.isEmpty(Square.fromName("a2")));
            assertTrue(b.isEmpty(Square.fromName("h2")));
        }

        @Test
        void malformedFenIsRejected() {
            assertThrows(IllegalArgumentException.class, () -> Board.fromFenPiecePlacement(""));
            assertThrows(IllegalArgumentException.class, () -> Board.fromFenPiecePlacement(null));
            assertThrows(IllegalArgumentException.class, () -> Board.fromFenPiecePlacement("8/8/8/8"));
            assertThrows(IllegalArgumentException.class, () -> Board.fromFenPiecePlacement("9/8/8/8/8/8/8/8"));
            assertThrows(IllegalArgumentException.class, () -> Board.fromFenPiecePlacement("4P4/8/8/8/8/8/8/8"));
        }

        @Test
        void containsFindsSpecificPieces() {
            Board b = Board.starting();
            assertTrue(b.contains(Side.WHITE, PieceType.KING));
            assertTrue(b.contains(Side.BLACK, PieceType.KING));
            assertFalse(b.contains(Side.WHITE, PieceType.BISHOP) == false);
            assertFalse(Board.fromFenPiecePlacement("8/8/8/8/8/8/8/K7").contains(Side.BLACK, PieceType.ROOK));
        }

        @Test
        void squaresOfReturnsOnlyThatSide() {
            Board b = Board.fromFenPiecePlacement("8/8/8/8/8/8/8/K6k");
            List<Integer> white = b.squaresOf(Side.WHITE);
            List<Integer> black = b.squaresOf(Side.BLACK);
            assertEquals(1, white.size());
            assertEquals(1, black.size());
            assertEquals(Square.fromName("a1"), (int) white.get(0));
            assertEquals(Square.fromName("h1"), (int) black.get(0));
        }

        @Test
        void outOfRangeAccessIsSafe() {
            Board b = Board.starting();
            assertNull(b.get(64));
            assertNull(b.get(-1));
            assertTrue(b.isEmpty(64));
            b.set(64, Piece.white(PieceType.PAWN));
            assertTrue(b.isEmpty(64));
        }
    }

    @Nested
    @DisplayName("Move generation")
    class Moves {

        @Test
        void startingPositionHasTwentyLegalMoves() {
            assertEquals(20, new ChessGame().legalMoves().size());
        }

        @Test
        void pawnMovesOneAndTwoSquaresFromHome() {
            List<Integer> targets = new ChessGame().legalTargets(Square.fromName("e2"));
            assertTrue(targets.contains(Square.fromName("e3")));
            assertTrue(targets.contains(Square.fromName("e4")));
            assertEquals(2, targets.size());
        }

        @Test
        void pawnCannotMoveTwoSquaresFromMidBoard() {
            ChessGame g = after("e2e4", "a7a6");
            assertEquals(1, g.legalTargets(Square.fromName("e4")).size());
        }

        @Test
        void pawnCapturesDiagonallyOnly() {
            ChessGame g = fromFen("4k3/8/8/3p4/4P3/8/8/4K3");
            List<Integer> targets = g.legalTargets(Square.fromName("e4"));
            assertEquals(2, targets.size(), "one push to e5 and one capture on d5");
            assertTrue(targets.contains(Square.fromName("e5")));
            assertTrue(targets.contains(Square.fromName("d5")));
        }

        @Test
        void knightHasEightMovesFromCentre() {
            ChessGame g = fromFen("4k3/8/8/3N4/8/8/8/4K3");
            assertEquals(8, g.legalTargets(Square.fromName("d5")).size());
        }

        @Test
        void knightOnCornerHasTwoMoves() {
            ChessGame g = fromFen("4k3/8/8/8/8/8/8/N3K3");
            assertEquals(2, g.legalTargets(Square.fromName("a1")).size());
        }

        @Test
        void slidingPieceStopsAtBlocker() {
            ChessGame g = fromFen("4k3/8/8/8/8/8/P7/R3K3");
            List<Integer> targets = g.legalTargets(Square.fromName("a1"));
            assertFalse(targets.contains(Square.fromName("a2")), "own pawn on a2 blocks the rook");
            assertFalse(targets.contains(Square.fromName("a3")));
            assertTrue(targets.contains(Square.fromName("b1")), "the rook is still free along rank 1");
        }

        @Test
        void rookCapturesFirstBlockerOnly() {
            ChessGame g = fromFen("4k3/8/8/8/8/8/p7/R3K3");
            List<Integer> targets = g.legalTargets(Square.fromName("a1"));
            assertTrue(targets.contains(Square.fromName("a2")), "may take the enemy pawn");
            assertFalse(targets.contains(Square.fromName("a3")), "but may not slide past it");
        }

        @Test
        void bishopStaysOnItsColour() {
            ChessGame g = fromFen("4k3/8/8/8/8/8/8/B3K3");
            for (int to : g.legalTargets(Square.fromName("a1"))) {
                int lightA1 = (0 + 7) % 2;
                int lightTarget = (Square.fileOf(to) + Square.rankOf(to)) % 2;
                assertEquals(lightA1, lightTarget, Square.nameOf(to) + " must stay on one colour");
            }
        }

        @Test
        void queenMovesAlongFilesRanksAndDiagonals() {
            // Queen a1, own king e1 blocks the rank after d1, nothing else in the way.
            ChessGame g = fromFen("4k3/8/8/8/8/8/8/Q3K3");
            assertEquals(7 + 3 + 7, g.legalTargets(Square.fromName("a1")).size());
        }

        @Test
        void kingMovesOneSquareInAnyDirection() {
            ChessGame g = fromFen("4k3/8/8/8/4K3/8/8/8");
            assertEquals(8, g.legalTargets(Square.fromName("e4")).size());
        }

        @Test
        void kingOnCornerHasThreeMoves() {
            ChessGame g = fromFen("4k3/8/8/8/8/8/8/K7");
            assertEquals(3, g.legalTargets(Square.fromName("a1")).size());
        }

        @Test
        void cannotCaptureOwnPiece() {
            ChessGame g = fromFen("4k3/8/8/8/8/8/P7/R3K3");
            assertFalse(g.legalTargets(Square.fromName("a1")).contains(Square.fromName("a2")),
                    "the bug this engine originally had: rook must not take its own pawn");
        }

        @Test
        void onlySideToMoveHasMoves() {
            ChessGame g = new ChessGame();
            assertTrue(g.legalTargets(Square.fromName("e7")).isEmpty(), "black pawn while white to move");
            assertFalse(g.legalTargets(Square.fromName("e2")).isEmpty());
        }

        @Test
        void emptySquareHasNoMoves() {
            assertTrue(new ChessGame().legalTargets(Square.fromName("e4")).isEmpty());
        }

        @Test
        void isLegalMatchesGeneratedMoves() {
            ChessGame g = new ChessGame();
            assertTrue(g.isLegal(Move.of("e2e4")));
            assertFalse(g.isLegal(Move.of("e2e5")));
            assertFalse(g.isLegal(Move.of("e7e5")), "not black's turn");
            assertFalse(g.isLegal(null));
        }

        @Test
        void moveRejectsIllegalInput() {
            assertThrows(IllegalArgumentException.class, () -> Move.of("e2"));
            assertThrows(IllegalArgumentException.class, () -> Move.of("e2e4e5"));
            assertThrows(IllegalArgumentException.class, () -> new Move(0, 64));
            assertThrows(IllegalArgumentException.class, () -> new Move(-1, 0));
        }

        @Test
        void algebraIncludesPromotionPiece() {
            assertEquals("a7a8", new Move(Square.fromName("a7"), Square.fromName("a8")).toAlgebraic());
            assertEquals("a7a8q", new Move(Square.fromName("a7"), Square.fromName("a8"), PieceType.QUEEN).toAlgebraic());
        }

        @Test
        void moveEqualityIncludesPromotion() {
            int a = Square.fromName("a7");
            int b = Square.fromName("a8");
            assertEquals(new Move(a, b), new Move(a, b));
            assertEquals(new Move(a, b).hashCode(), new Move(a, b).hashCode());
            assertFalse(new Move(a, b).equals(new Move(a, b, PieceType.QUEEN)));
            assertFalse(new Move(a, b).equals("a7a8"));
        }

        @Test
        void pieceTypeSymbolsRoundTrip() {
            for (PieceType t : PieceType.values()) {
                assertEquals(t, PieceType.fromSymbol(t.symbol()));
                assertEquals(t, PieceType.fromSymbol(Character.toLowerCase(t.symbol())));
            }
            assertThrows(IllegalArgumentException.class, () -> PieceType.fromSymbol('x'));
        }
    }

    @Nested
    @DisplayName("Applying moves")
    class Applying {

        @Test
        void moveUpdatesBothSidesAndBoard() {
            ChessGame g = new ChessGame();
            ChessGame.MoveResult r = g.apply(Move.of("e2e4"));
            assertEquals(Side.BLACK, g.sideToMove());
            assertTrue(g.isEmpty(Square.fromName("e2")));
            assertEquals(Piece.white(PieceType.PAWN), g.pieceAt(Square.fromName("e4")));
            assertNull(r.captured());
            assertEquals(-1, r.capturedAt());
            assertEquals(ChessGame.GameResult.ONGOING, r.outcome());
        }

        @Test
        void illegalMoveIsRejectedAndBoardUnchanged() {
            ChessGame g = new ChessGame();
            assertThrows(IllegalArgumentException.class, () -> g.apply(Move.of("e2e5")));
            assertEquals(START_FEN, g.board().toFenPiecePlacement());
            assertEquals(Side.WHITE, g.sideToMove());
        }

        @Test
        void captureRemovesEnemyPiece() {
            ChessGame g = after("e2e4", "d7d5");
            ChessGame.MoveResult r = g.apply(Move.of("e4d5"));
            assertEquals(Piece.black(PieceType.PAWN), r.captured());
            assertEquals(Square.fromName("d5"), r.capturedAt());
            assertEquals(Piece.white(PieceType.PAWN), g.pieceAt(Square.fromName("d5")));
            assertTrue(g.isEmpty(Square.fromName("e4")), "the capturing pawn vacates its old square");
        }

        @Test
        void captureMarksTheVacatedSquare() {
            ChessGame g = after("e2e4", "d7d5", "e4d5");
            ChessGame.MoveResult r = g.apply(Move.of("d8d5"));
            assertEquals(Square.fromName("d5"), r.capturedAt());
            assertEquals(Piece.black(PieceType.QUEEN), g.pieceAt(Square.fromName("d5")));
            assertTrue(g.isEmpty(Square.fromName("d8")));
        }

        @Test
        void takingTheKingEndsTheGame() {
            ChessGame g = fromFen("4k3/4R3/8/8/8/8/8/4K3");
            ChessGame.MoveResult r = g.apply(Move.of("e7e8"));
            assertEquals(ChessGame.GameResult.KING_CAPTURED, r.outcome());
            assertEquals(PieceType.KING, r.captured().type());
        }

        @Test
        void promotionPlacesTheChosenPiece() {
            ChessGame g = fromFen("4k3/P7/8/8/8/8/8/4K3");
            ChessGame.MoveResult r = g.apply(new Move(Square.fromName("a7"), Square.fromName("a8"), PieceType.QUEEN));
            assertEquals(Piece.white(PieceType.QUEEN), g.pieceAt(Square.fromName("a8")));
            assertEquals(ChessGame.GameResult.ONGOING, r.outcome());
        }

        @Test
        void copyIsIndependentOfOriginal() {
            ChessGame g = new ChessGame();
            ChessGame copy = g.copy();
            copy.apply(Move.of("d2d4"));
            assertTrue(g.isEmpty(Square.fromName("d4")), "original must not see the copy's move");
            assertTrue(copy.pieceAt(Square.fromName("d4")) != null);
            assertEquals(Side.BLACK, copy.sideToMove());
            assertEquals(Side.WHITE, g.sideToMove());
        }

        @Test
        void boardAccessorReturnsADefensiveCopy() {
            ChessGame g = new ChessGame();
            Board b = g.board();
            b.clear(Square.fromName("a1"));
            assertNotNull(g.pieceAt(Square.fromName("a1")), "mutating the returned board must not affect the game");
        }

        @Test
        void stateStringRoundTripsPositionAndTurn() {
            ChessGame g = after("e2e4", "e7e5");
            assertEquals("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6", g.toStateString());
            ChessGame back = ChessGame.fromStateString(g.toStateString());
            assertEquals(g.toStateString(), back.toStateString());
            assertEquals(Side.WHITE, back.sideToMove(), "two plies have been played, so it is white again");
            assertTrue(back.pieceAt(Square.fromName("e4")) != null);
            assertTrue(back.pieceAt(Square.fromName("e5")) != null);
        }

        @Test
        void stateStringDefaultsToWhiteWhenTurnMissing() {
            assertEquals(Side.WHITE, ChessGame.fromStateString(START_FEN).sideToMove());
        }

        @Test
        void emptyStateStringIsRejected() {
            assertThrows(IllegalArgumentException.class, () -> ChessGame.fromStateString(null));
            assertThrows(IllegalArgumentException.class, () -> ChessGame.fromStateString(""));
        }
    }

    @Nested
    @DisplayName("Rule coverage")
    class Rules {

        @Test
        void implementedRulesAreReported() {
            for (ChessGame.Rule r : new ChessGame.Rule[]{
                    ChessGame.Rule.CASTLING,
                    ChessGame.Rule.EN_PASSANT,
                    ChessGame.Rule.PROMOTION,
                    ChessGame.Rule.CHECK,
                    ChessGame.Rule.STALEMATE}) {
                assertTrue(ChessGame.isRuleImplemented(r), r + " should be implemented");
            }
        }

        @Test
        void drawRulesAreStillDeferred() {
            for (ChessGame.Rule r : new ChessGame.Rule[]{
                    ChessGame.Rule.FIFTY_MOVE_RULE,
                    ChessGame.Rule.THREEFOLD_REPETITION}) {
                assertFalse(ChessGame.isRuleImplemented(r), r + " is not implemented yet");
            }
        }

        @Test
        void allSevenRulesAreEnumerated() {
            assertEquals(7, ChessGame.Rule.values().length);
        }

        @Test
        void gameResultCoversEveryWayToFinish() {
            assertEquals(5, ChessGame.GameResult.values().length);
            assertFalse(ChessGame.GameResult.ONGOING.isOver());
            for (ChessGame.GameResult r : ChessGame.GameResult.values()) {
                if (r != ChessGame.GameResult.ONGOING) {
                    assertTrue(r.isOver(), r + " should end the game");
                }
            }
        }
    }

    @Test
    @DisplayName("side helpers")
    void sideHelpersBehave() {
        assertEquals(Side.BLACK, Side.WHITE.opposite());
        assertEquals(Side.WHITE, Side.BLACK.opposite());
        assertTrue(Side.WHITE.isEnemyOf(Side.BLACK));
        assertFalse(Side.WHITE.isEnemyOf(Side.WHITE));
        assertFalse(Side.WHITE.isEnemyOf(null));
        assertTrue(Piece.white(PieceType.PAWN).isFriendlyTo(Piece.white(PieceType.ROOK)));
        assertFalse(Piece.white(PieceType.PAWN).isFriendlyTo(Piece.black(PieceType.PAWN)));
        assertFalse(Piece.white(PieceType.PAWN).isFriendlyTo(null));
        assertEquals('P', Piece.white(PieceType.PAWN).toFenChar());
        assertEquals('p', Piece.black(PieceType.PAWN).toFenChar());
    }

    @Test
    @DisplayName("piece metadata")
    void pieceLabelsAreReadable() {
        assertEquals("Knight", PieceType.KNIGHT.label());
        assertEquals("Pawn", PieceType.PAWN.label());
        assertEquals(Piece.white(PieceType.ROOK), Piece.of(PieceType.ROOK, Side.WHITE));
        assertEquals(Piece.white(PieceType.ROOK).hashCode(), Piece.of(PieceType.ROOK, Side.WHITE).hashCode());
        assertNotSame(Piece.white(PieceType.ROOK), Piece.white(PieceType.ROOK));
    }
}
