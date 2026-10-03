package com.lanchess.session;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.lanchess.core.ChessGame;
import com.lanchess.core.Move;
import com.lanchess.core.PieceType;
import com.lanchess.core.Side;
import com.lanchess.net.Message;
import com.lanchess.net.RoomCode;
import com.lanchess.net.Transport;
import com.lanchess.net.TransportListener;
import com.lanchess.session.GameSession.MoveMark;
import com.lanchess.session.GameSession.MoveMark.Relocation;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * The session tells the board which pieces a move carried. That set has to
 * include the castling rook and the en passant victim, or those pieces jump
 * instead of sliding, so it is worth pinning down.
 */
@DisplayName("Game session move markers")
class GameSessionTest {

    /** White is local, so a move made here is a local one. */
    private static GameSession session(String position) {
        GameSession session = new GameSession(ChessGame.fromStateString(position));
        session.attach(new StubTransport(session.game(), Side.WHITE));
        return session;
    }

    private static List<Relocation> playAndRead(GameSession session, Move move) {
        session.playLocalMove(move.from(), move.to(), move.promotion());
        return session.lastMove().relocations();
    }

    private static boolean carries(List<Relocation> relocations, int from, int to) {
        return relocations.stream().anyMatch(r -> r.from() == from && r.to() == to);
    }

    @Nested
    @DisplayName("the relocations a move reports")
    class Relocations {

        @Test
        @DisplayName("an ordinary move carries only the piece that moved")
        void plainMove() {
            // Kings and rooks already off, so castling is not also available.
            GameSession session = session("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1");
            List<Relocation> moved = playAndRead(session, new Move(52, 36));

            assertEquals(1, moved.size(), "e2e4 moves one piece");
            assertTrue(carries(moved, 52, 36));
        }

        @Test
        @DisplayName("castling carries the rook as well as the king")
        void kingsideCastle() {
            GameSession session = session("r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1");
            List<Relocation> moved = playAndRead(session, new Move(60, 62));

            assertEquals(2, moved.size(), "both the king and the rook cross");
            assertTrue(carries(moved, 60, 62), "the king goes e1 to g1");
            assertTrue(carries(moved, 63, 61), "the rook goes h1 to f1");
        }

        @Test
        @DisplayName("queenside castling carries the rook from the other corner")
        void queensideCastle() {
            GameSession session = session("r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1");
            List<Relocation> moved = playAndRead(session, new Move(60, 58));

            assertEquals(2, moved.size(), "both the king and the rook cross");
            assertTrue(carries(moved, 60, 58), "the king goes e1 to c1");
            assertTrue(carries(moved, 56, 59), "the rook goes a1 to d1");
        }

        @Test
        @DisplayName("castling for black carries the rook the same way")
        void blackCastle() {
            GameSession session = session("r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1");
            session.onRemoteMessage(Message.move(new Move(4, 6)));

            List<Relocation> moved = session.lastMove().relocations();
            assertTrue(carries(moved, 4, 6), "the king goes e8 to g8");
            assertTrue(carries(moved, 7, 5), "the rook goes h8 to f8");
        }

        @Test
        @DisplayName("en passant carries the pawn that was taken")
        void enPassantCapture() {
            // Black has just pushed h7-h5, so the pawn on g5 can be taken on h6.
            GameSession session = session("4k3/8/8/6Pp/8/8/8/4K3 w - h6 0 2");
            List<Relocation> moved = playAndRead(session, new Move(30, 23));

            assertEquals(2, moved.size(), "the capturing pawn and its victim both move");
            assertTrue(carries(moved, 30, 23), "g5 to h6");
            assertTrue(carries(moved, 31, 23), "the h5 pawn is taken on h6");
        }

        @Test
        @DisplayName("a promotion carries only the pawn")
        void promotion() {
            GameSession session = session("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
            List<Relocation> moved = playAndRead(session, new Move(8, 0, PieceType.QUEEN));

            assertEquals(1, moved.size(), "a promoting pawn is still one piece");
            assertTrue(carries(moved, 8, 0));
        }
    }

    @Nested
    @DisplayName("the marker a move leaves behind")
    class Marker {

        @Test
        @DisplayName("the two highlighted squares are the move the player made")
        void highlightsTheChosenMove() {
            GameSession session = session("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1");
            playAndRead(session, new Move(52, 36));

            assertEquals(52, session.lastMove().from());
            assertEquals(36, session.lastMove().to());
        }

        @Test
        @DisplayName("the list is a copy, so a caller cannot change it")
        void markerIsImmutable() {
            GameSession session = session("r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1");
            playAndRead(session, new Move(60, 62));
            List<Relocation> relocations = session.lastMove().relocations();

            assertTrue(relocations instanceof List);
            try {
                relocations.add(new Relocation(0, 1));
                throw new AssertionError("the relocation list should not be modifiable");
            } catch (UnsupportedOperationException expected) {
                // the list handed out is a read-only view
            }
        }
    }

    /** The minimum as a local transport would need it: connected, and it eats messages. */
    private static final class StubTransport implements Transport {

        private final ChessGame game;
        private final Side localSide;
        private final List<Message> sent = new ArrayList<>();

        StubTransport(ChessGame game, Side localSide) {
            this.game = game;
            this.localSide = localSide;
        }

        @Override
        public Side localSide() {
            return this.localSide;
        }

        @Override
        public String localName() {
            return "Tester";
        }

        @Override
        public String remoteName() {
            return "Opponent";
        }

        @Override
        public RoomCode roomCode() {
            return RoomCode.of(0);
        }

        @Override
        public boolean isConnected() {
            return true;
        }

        @Override
        public void start(TransportListener listener) {
            // nothing to announce
        }

        @Override
        public void send(Message message) {
            this.sent.add(message);
        }

        @Override
        public void close() {
            // nothing to release
        }

        List<Message> sent() {
            return this.sent;
        }
    }
}
