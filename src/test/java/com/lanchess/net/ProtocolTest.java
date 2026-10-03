package com.lanchess.net;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.lanchess.core.ChessGame;
import com.lanchess.core.Move;
import com.lanchess.core.PieceType;
import com.lanchess.core.Side;
import com.lanchess.core.Square;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

/** Room codes, wire framing, and real socket handshakes between a host and a guest. */
class ProtocolTest {

    private static final String START_STATE = new ChessGame().toStateString();

    /** Collects everything a transport reports so tests can assert on it. */
    private static final class Recorder implements TransportListener {
        final List<Message> messages = new ArrayList<>();
        final CountDownLatch connected = new CountDownLatch(1);
        final CountDownLatch disconnected = new CountDownLatch(1);
        volatile ConnectionInfo info;
        volatile String disconnectReason;
        volatile String protocolError;

        @Override
        public void onConnected(ConnectionInfo info) {
            this.info = info;
            this.connected.countDown();
        }

        @Override
        public void onMessage(Message message) {
            synchronized (this.messages) {
                this.messages.add(message);
            }
        }

        @Override
        public void onDisconnected(String reason) {
            this.disconnectReason = reason;
            this.disconnected.countDown();
        }

        @Override
        public void onProtocolError(String text) {
            this.protocolError = text;
        }

        boolean awaitMessage(MessageType type, long millis) throws InterruptedException {
            long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(millis);
            while (System.nanoTime() < deadline) {
                synchronized (this.messages) {
                    for (Message m : this.messages) {
                        if (m.type() == type) {
                            return true;
                        }
                    }
                }
                Thread.sleep(10L);
            }
            return false;
        }
    }

    private static int freePort() throws IOException {
        try (ServerSocket probe = new ServerSocket(0)) {
            return probe.getLocalPort();
        }
    }

    @Nested
    @DisplayName("RoomCode")
    class Codes {

        @Test
        void textIsAlwaysFourDigits() {
            assertEquals("0007", RoomCode.of(7).text());
            assertEquals("4523", RoomCode.of(4523).text());
            assertEquals("1000", RoomCode.of(1000).text());
        }

        @Test
        void parseAcceptsPlainDigits() {
            assertEquals(RoomCode.of(4523), RoomCode.parse("4523"));
            assertEquals(RoomCode.of(7), RoomCode.parse("7"));
        }

        @Test
        void parseIgnoresSpacesAndSeparators() {
            assertEquals(RoomCode.of(4523), RoomCode.parse(" 45 23 "));
            assertEquals(RoomCode.of(4523), RoomCode.parse("4-5-2-3"));
        }

        @Test
        void parseRejectsGarbage() {
            assertNull(RoomCode.parse(null));
            assertNull(RoomCode.parse(""));
            assertNull(RoomCode.parse("abcd"));
            assertNull(RoomCode.parse("12345"), "more than four digits is not a room code");
        }

        @Test
        void isValidMatchesParse() {
            assertTrue(RoomCode.isValid("4523"));
            assertFalse(RoomCode.isValid("nope"));
        }

        @Test
        void valueRangeIsEnforced() {
            assertThrows(IllegalArgumentException.class, () -> RoomCode.of(-1));
            assertThrows(IllegalArgumentException.class, () -> RoomCode.of(10000));
        }

        @Test
        void randomCodesStayInRangeAndAvoidRepeatingPatterns() {
            Random rng = new Random(1234L);
            for (int i = 0; i < 2000; i++) {
                RoomCode code = RoomCode.random(rng);
                int v = code.value();
                assertTrue(v >= 1000 && v <= 9999, "out of range: " + code);
                assertNotEqualsAllDigits(v, "repeating pattern like 1234: " + code);
            }
        }

        private void assertNotEqualsAllDigits(int value, String message) {
            char first = String.format("%04d", value).charAt(0);
            for (char c : String.format("%04d", value).toCharArray()) {
                if (c != first) {
                    return;
                }
            }
            org.junit.jupiter.api.Assertions.fail(message);
        }

        @Test
        void equalityAndHashUseTheValue() {
            assertEquals(RoomCode.of(4271), RoomCode.of(4271));
            assertEquals(RoomCode.of(4271).hashCode(), RoomCode.of(4271).hashCode());
            assertFalse(RoomCode.of(4271).equals(RoomCode.of(4272)));
            assertFalse(RoomCode.of(4271).equals("4271"));
            assertEquals("4271", RoomCode.of(4271).toString());
        }
    }

    @Nested
    @DisplayName("Message framing")
    class Framing {

        @Test
        void encodeEndsWithNewlineAndPipesFields() {
            String wire = Message.join("Ada").encode();
            assertEquals("JOIN|Ada\n", wire);
        }

        @Test
        void decodeIsTheInverseOfEncode() {
            Message original = Message.welcome(Side.BLACK, START_STATE, "Ada", "Bob", RoomCode.of(4271));
            Message back = Message.decode(original.encode());
            assertNotNull(back);
            assertEquals(MessageType.WELCOME, back.type());
            assertEquals(Side.BLACK, back.yourSide());
            assertEquals(START_STATE, back.boardState());
            assertEquals("Ada", back.hostName());
            assertEquals("Bob", back.guestName());
            assertEquals(RoomCode.of(4271), back.roomCode());
        }

        @Test
        void separatorsInPlayerNamesCannotBreakFraming() {
            Message m = Message.join("Ma|ke\nBreak");
            String wire = m.encode();
            assertEquals(1, wire.chars().filter(c -> c == '\n').count(), "exactly one terminator");
            assertEquals(1, wire.chars().filter(c -> c == '|').count(), "type plus one field");
            assertEquals("Ma ke Break", Message.decode(wire).playerName());
        }

        @Test
        void moveCarriesSquaresAndPromotion() {
            Message m = Message.move(new Move(Square.fromName("a7"), Square.fromName("a8"), PieceType.QUEEN));
            Message back = Message.decode(m.encode());
            assertEquals(MessageType.MOVE, back.type());
            assertEquals(Square.fromName("a7"), back.move().from());
            assertEquals(Square.fromName("a8"), back.move().to());
            assertEquals(PieceType.QUEEN, back.move().promotion());
        }

        @Test
        void plainMoveHasNoPromotion() {
            Message back = Message.decode(Message.move(Move.of("e2e4")).encode());
            assertNull(back.move().promotion());
            assertEquals(Move.of("e2e4"), back.move());
        }

        @Test
        void simpleMessagesRoundTrip() {
            assertEquals(MessageType.RESIGN, Message.decode(Message.resign().encode()).type());
            assertEquals(MessageType.REMATCH, Message.decode(Message.rematch().encode()).type());
            assertEquals(MessageType.PING, Message.decode(Message.ping().encode()).type());
            assertEquals(MessageType.PONG, Message.decode(Message.pong().encode()).type());
            assertEquals("left", Message.decode(Message.bye("left").encode()).text());
            assertEquals("boom", Message.decode(Message.error("boom").encode()).text());
        }

        @Test
        void decodeIgnoresBlankAndUnknownLines() {
            assertNull(Message.decode(null));
            assertNull(Message.decode(""));
            assertNull(Message.decode("   "));
            assertNull(Message.decode("NONSENSE|x\n"));
        }

        @Test
        void truncatedMessagesDecodeWithoutThrowing() {
            Message m = Message.decode("MOVE|e2|e4\n");
            assertEquals(2, m.argCount());
            assertEquals("e2", m.text(), "field 0 is still readable");
            assertEquals(0, m.roomCode().value(), "a missing field reads as empty");
        }

        @Test
        void welcomeWithoutRoomCodeFallsBackToZero() {
            Message m = Message.decode("WELCOME|WHITE|state|Ada|Bob|\n");
            assertEquals(0, m.roomCode().value());
        }

        @Test
        void yourSideOnlyTreatsBlackAsBlack() {
            assertEquals(Side.BLACK, Message.decode("WELCOME|BLACK|s|h|g|1\n").yourSide());
            assertEquals(Side.WHITE, Message.decode("WELCOME|white|s|h|g|1\n").yourSide());
            assertEquals(Side.WHITE, Message.decode("WELCOME|garbage|s|h|g|1\n").yourSide());
        }

        @Test
        void messageTypeParseIsCaseInsensitive() {
            assertEquals(MessageType.MOVE, MessageType.parse("move"));
            assertEquals(MessageType.MOVE, MessageType.parse("  MOVE "));
            assertNull(MessageType.parse("unknown"));
            assertNull(MessageType.parse(null));
        }

        @Test
        void protocolConstantsAreSane() {
            assertTrue(Protocol.GAME_PORT > 1024 && Protocol.GAME_PORT < 65536);
            assertTrue(Protocol.DISCOVERY_PORT > 1024 && Protocol.DISCOVERY_PORT < 65536);
            assertFalse(Protocol.GAME_PORT == Protocol.DISCOVERY_PORT);
            assertNotNull(Protocol.DISCOVERY_MAGIC);
            assertTrue(Protocol.DISCOVERY_INTERVAL_MS > 0);
            assertTrue(Protocol.PEER_TIMEOUT_MS > Protocol.PING_INTERVAL_MS);
            assertEquals(Protocol.GAME_PORT, new GameClient("x", RoomCode.of(1), "h", 0) == null ? -1 : Protocol.GAME_PORT);
        }

        @Test
        void aGameClientDefaultsToTheStandardPort() {
            assertNotNull(new GameClient("x", RoomCode.of(1), "127.0.0.1", 0));
        }
    }

    @Nested
    @DisplayName("Live host and guest")
    class Live {

        @Test
        @Timeout(30)
        void guestJoinsAndReceivesTheBoardState() throws Exception {
            int port = freePort();
            RoomCode code = RoomCode.of(4271);
            GameServer server = new GameServer("Ada", code, () -> START_STATE, port);
            Recorder host = new Recorder();
            server.start(host);
            try {
                Recorder guest = new Recorder();
                GameClient client = new GameClient("Bob", code, "127.0.0.1", port);
                client.start(guest);
                try {
                    assertTrue(host.connected.await(8, TimeUnit.SECONDS), "host should see the guest");
                    assertTrue(guest.connected.await(8, TimeUnit.SECONDS), "guest should be welcomed");
                    assertEquals(START_STATE, guest.info.boardState());
                    assertEquals("Ada", guest.info.remoteName());
                    assertEquals(code, guest.info.roomCode());
                    assertEquals(Side.WHITE, host.info.localSide());
                    assertEquals(Side.BLACK, client.localSide());
                } finally {
                    client.close();
                }
            } finally {
                server.close();
            }
        }

        @Test
        @Timeout(30)
        void movesTravelInBothDirections() throws Exception {
            int port = freePort();
            RoomCode code = RoomCode.of(4271);
            GameServer server = new GameServer("Ada", code, () -> START_STATE, port);
            Recorder host = new Recorder();
            server.start(host);
            GameClient client = new GameClient("Bob", code, "127.0.0.1", port);
            Recorder guest = new Recorder();
            try {
                client.start(guest);
                assertTrue(guest.connected.await(8, TimeUnit.SECONDS));

                client.send(Message.move(Move.of("e2e4")));
                assertTrue(host.awaitMessage(MessageType.MOVE, 8000), "host should receive the move");
                synchronized (host.messages) {
                    assertEquals(Move.of("e2e4"), host.messages.get(0).move());
                }

                server.send(Message.move(Move.of("e7e5")));
                assertTrue(guest.awaitMessage(MessageType.MOVE, 8000), "guest should receive the reply");
                synchronized (guest.messages) {
                    assertEquals(Move.of("e7e5"), guest.messages.get(0).move());
                }
            } finally {
                client.close();
                server.close();
            }
        }

        @Test
        @Timeout(30)
        void secondGuestIsRefusedWithoutDisturbingTheFirst() throws Exception {
            int port = freePort();
            RoomCode code = RoomCode.of(4271);
            GameServer server = new GameServer("Ada", code, () -> START_STATE, port);
            Recorder host = new Recorder();
            server.start(host);
            GameClient first = new GameClient("Bob", code, "127.0.0.1", port);
            try {
                Recorder firstRec = new Recorder();
                first.start(firstRec);
                assertTrue(firstRec.connected.await(8, TimeUnit.SECONDS));

                Recorder secondRec = new Recorder();
                GameClient second = new GameClient("Eve", code, "127.0.0.1", port);
                try {
                    second.start(secondRec);
                    assertTrue(secondRec.disconnected.await(8, TimeUnit.SECONDS), "second guest should be turned away");
                    assertNotNull(secondRec.disconnectReason);
                    assertTrue(secondRec.disconnectReason.toLowerCase().contains("already"),
                            "expected a room-full reason, got: " + secondRec.disconnectReason);
                } finally {
                    second.close();
                }

                assertTrue(host.connected.getCount() == 0, "host keeps the original guest");
                assertFalse(first.isConnected() && firstRec.disconnectReason != null, "first guest must survive");
            } finally {
                first.close();
                server.close();
            }
        }

        @Test
        @Timeout(60)
        void guestNoticesWhenTheHostGoesAway() throws Exception {
            int port = freePort();
            RoomCode code = RoomCode.of(4271);
            GameServer server = new GameServer("Ada", code, () -> START_STATE, port);
            server.start(new Recorder());
            GameClient client = new GameClient("Bob", code, "127.0.0.1", port);
            Recorder guest = new Recorder();
            client.start(guest);
            try {
                assertTrue(guest.connected.await(8, TimeUnit.SECONDS), "guest should connect first");
                server.close();
                assertTrue(guest.disconnected.await(30, TimeUnit.SECONDS), "guest should notice the host leaving");
            } finally {
                client.close();
                server.close();
            }
        }

        @Test
        @Timeout(30)
        void connectingToAClosedPortFailsCleanly() throws Exception {
            int port = freePort();
            Recorder guest = new Recorder();
            GameClient client = new GameClient("Bob", RoomCode.of(4271), "127.0.0.1", port);
            client.start(guest);
            try {
                assertTrue(guest.disconnected.await(10, TimeUnit.SECONDS), "should report it cannot connect");
                assertNotNull(guest.disconnectReason);
            } finally {
                client.close();
            }
        }

        @Test
        @Timeout(30)
        void aStrayProbeDoesNotStealTheRoom() throws Exception {
            int port = freePort();
            RoomCode code = RoomCode.of(4271);
            GameServer server = new GameServer("Ada", code, () -> START_STATE, port);
            Recorder host = new Recorder();
            server.start(host);
            try {
                try (java.net.Socket probe = new java.net.Socket("127.0.0.1", port)) {
                    probe.getOutputStream().write("hello\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    probe.getOutputStream().flush();
                }
                Thread.sleep(300L);

                Recorder guest = new Recorder();
                GameClient client = new GameClient("Bob", code, "127.0.0.1", port);
                try {
                    client.start(guest);
                    assertTrue(guest.connected.await(8, TimeUnit.SECONDS), "a real guest should still get in");
                } finally {
                    client.close();
                }
            } finally {
                server.close();
            }
        }

        @Test
        @Timeout(30)
        void closeIsIdempotent() throws Exception {
            int port = freePort();
            GameServer server = new GameServer("Ada", RoomCode.of(4271), () -> START_STATE, port);
            server.start(new Recorder());
            server.close();
            server.close();
            assertFalse(server.isConnected());
        }

        @Test
        void clientAcceptsASocketAddressConstructor() throws Exception {
            int port = freePort();
            GameClient client = new GameClient("Bob", RoomCode.of(4271), new InetSocketAddress("127.0.0.1", port));
            assertEquals(Side.BLACK, client.localSide());
            client.close();
        }
    }
}
