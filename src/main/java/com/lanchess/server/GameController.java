package com.lanchess.server;

import com.lanchess.core.ChessGame;
import com.lanchess.core.Move;
import com.lanchess.core.Piece;
import com.lanchess.core.PieceType;
import com.lanchess.core.Side;
import com.lanchess.core.Square;
import com.lanchess.net.ConnectionInfo;
import com.lanchess.net.GameClient;
import com.lanchess.net.GameServer;
import com.lanchess.net.LocalTransport;
import com.lanchess.net.Message;
import com.lanchess.net.Protocol;
import com.lanchess.net.RoomCode;
import com.lanchess.net.RoomFinder;
import com.lanchess.net.RoomHostListener;
import com.lanchess.net.Transport;
import com.lanchess.net.TransportListener;
import com.lanchess.session.GameSession;
import com.lanchess.session.GameSession.MoveMark;
import java.net.InetAddress;
import java.util.List;

/**
 * The bridge between the web interface and the game.
 *
 * <p>Everything the browser can ask for or be told about goes through here. The
 * browser holds no game rules of its own: it asks for a state snapshot and gets
 * back squares, legal targets, whose turn it is, and any message worth showing.
 */
public final class GameController {

    /** How the current game was set up. */
    public enum Mode {
        IDLE, SINGLE_PLAYER, HOSTING, JOINING
    }

    private final GameSession session;
    private final Bridge bridge = new Bridge();
    private final Object lock = new Object();

    private Mode mode = Mode.IDLE;
    private String playerName = "Player";
    private String roomCode = "";
    private String localAddress = "";
    private String pending = "";
    private String error = "";
    private String gameOverHeadline = "";
    private String gameOverDetail = "";
    private boolean localWon;
    private boolean gameOver;
    private boolean rematchOffered;

    private GameServer server;
    private GameClient client;
    private RoomFinder finder;
    private Thread searchThread;
    private volatile boolean closing;

    public GameController() {
        this.session = new GameSession(new ChessGame());
        this.session.setListener(new GameSession.Listener() {
            @Override
            public void onStateChanged() {
            }

            @Override
            public void onStatusChanged(String status) {
            }

            @Override
            public void onGameOver(String headline, String detail, boolean won) {
                GameController.this.gameOverHeadline = headline;
                GameController.this.gameOverDetail = detail;
                GameController.this.localWon = won;
                GameController.this.gameOver = true;
            }

            @Override
            public void onRematchRequested() {
                GameController.this.rematchOffered = true;
            }

            @Override
            public void onRematchCleared() {
                GameController.this.rematchOffered = false;
                GameController.this.gameOver = false;
            }

            @Override
            public void onError(String detail) {
                GameController.this.error = detail == null ? "" : detail;
            }
        });
    }

    // ------------------------------------------------------------------
    // Commands from the browser
    // ------------------------------------------------------------------

    public void startSinglePlayer(String level, String colour) {
        synchronized (this.lock) {
            this.teardownLocked();
            com.lanchess.core.Difficulty chosen = com.lanchess.core.Difficulty.of(level);
            Side human = "black".equalsIgnoreCase(colour) ? Side.BLACK : Side.WHITE;
            ChessGame game = new ChessGame();
            this.mode = Mode.SINGLE_PLAYER;
            this.roomCode = "";
            this.localAddress = "";
            this.error = "";
            this.pending = "";
            this.clearGameOver();
            // The transport is told about the opening position; the session is
            // then pointed at the same object so both see every move.
            LocalTransport transport = new LocalTransport(game, human, this.playerName, chosen);
            this.session.setGame(game);
            transport.setGame(game);
            this.session.attach(transport);
            this.bridge.transport = transport;
            transport.start(this.bridge);
        }
    }

    public void hostRoom(String name) {
        synchronized (this.lock) {
            this.teardownLocked();
            this.playerName = clean(name, this.playerName);
            this.error = "";
            this.pending = "Opening a room on this network...";
            this.mode = Mode.HOSTING;
            this.clearGameOver();
        }
        this.startServer();
    }

    public void joinRoom(String code, String name) {
        synchronized (this.lock) {
            this.teardownLocked();
            this.playerName = clean(name, this.playerName);
            this.error = "";
            this.roomCode = code == null ? "" : code.trim();
            if (!isRoomCode(this.roomCode)) {
                this.error = "That room code is not four digits.";
                this.mode = Mode.IDLE;
                return;
            }
            this.pending = "Looking for room " + this.roomCode + "...";
            this.mode = Mode.JOINING;
            this.clearGameOver();
        }
        this.startSearch();
    }

    /** Connects straight to an address, for when broadcast discovery is blocked. */
    public void joinDirect(String code, String host, String port, String name) {
        synchronized (this.lock) {
            this.teardownLocked();
            this.playerName = clean(name, this.playerName);
            this.error = "";
            this.roomCode = code == null ? "" : code.trim();
            if (!isRoomCode(this.roomCode) || host == null || host.trim().isEmpty()) {
                this.error = host == null || host.trim().isEmpty()
                        ? "Enter the address of the computer hosting the room."
                        : "That room code is not four digits.";
                this.mode = Mode.IDLE;
                return;
            }
            this.pending = "Connecting to " + host + "...";
            this.mode = Mode.JOINING;
            this.clearGameOver();
        }
        int portNumber = Protocol.GAME_PORT;
        try {
            portNumber = Integer.parseInt(port.trim());
        } catch (RuntimeException e) {
            // keep the default
        }
        this.connect(new GameClient(this.playerName, RoomCode.parse(this.roomCode), host.trim(), portNumber));
    }

    /** Selects or clears a square, exactly as a click would. */
    public void clickSquare(int square) {
        synchronized (this.lock) {
            if (Square.isValid(square)) {
                this.session.onLocalSquareClicked(square);
            }
        }
    }

    public void selectSquare(int square) {
        synchronized (this.lock) {
            if (Square.isValid(square) && this.session.canPlayNow()) {
                this.session.onLocalSquareClicked(square);
            }
        }
    }

    public void playMove(int from, int to, String promotion) {
        synchronized (this.lock) {
            if (Square.isValid(from) && Square.isValid(to) && from != to) {
                this.session.playLocalMove(from, to, pieceType(promotion));
            }
        }
    }

    public void resign() {
        synchronized (this.lock) {
            this.session.resign();
        }
    }

    public void offerRematch() {
        synchronized (this.lock) {
            this.session.offerRematch();
        }
    }

    /** Leaves whatever game is running and returns to the menu. */
    public void leave() {
        synchronized (this.lock) {
            this.teardownLocked();
            this.mode = Mode.IDLE;
            this.roomCode = "";
            this.localAddress = "";
            this.pending = "";
            this.error = "";
            this.clearGameOver();
            this.session.setGame(new ChessGame());
        }
    }

    public void rememberPlayerName(String name) {
        this.playerName = clean(name, this.playerName);
    }

    public void shutdown() {
        this.closing = true;
        synchronized (this.lock) {
            this.teardownLocked();
        }
    }

    // ------------------------------------------------------------------
    // State for the browser
    // ------------------------------------------------------------------

    /** Everything the interface needs to draw itself, in one object. */
    /** The levels offered on the start screen, so the browser cannot guess. */
    public String levelsJson() {
        Json.Arr out = new Json.Arr();
        for (com.lanchess.core.Difficulty level : com.lanchess.core.Difficulty.values()) {
            out.add(new Json.Obj()
                    .put("id", level.name().toLowerCase())
                    .put("label", level.label())
                    .put("blurb", level.blurb())
                    .put("depth", level.maxDepth())
                    .put("thinkingMillis", level.budgetMillis())
                    .put("minimumThinkMillis", level.minimumThinkMillis()));
        }
        return out.toString();
    }

    public String stateJson() {
        synchronized (this.lock) {
            ChessGame game = this.session.game();
            Json.Obj root = new Json.Obj()
                    .put("mode", this.mode.name().toLowerCase())
                    .put("screen", this.mode == Mode.IDLE ? "home" : "game")
                    .put("playerName", this.playerName)
                    .put("localName", this.session.localName())
                    .put("connected", this.bridge.transport != null && this.bridge.transport.isConnected())
                    .put("roomCode", this.roomCode)
                    .put("localAddress", this.localAddress)
                    .put("pending", this.pending)
                    .put("error", this.error)
                    .put("status", this.session.status())
                    .put("finished", this.session.isFinished())
                    .put("localSide", this.session.localSide().name().toLowerCase())
                    .put("remoteName", this.session.remoteName())
                    .put("singlePlayer", this.mode == Mode.SINGLE_PLAYER)
                    .put("thinking", this.thinking())
                    .put("yourTurn", this.session.canPlayNow())
                    .put("gameOver", this.gameOver)
                    .put("gameOverHeadline", this.gameOverHeadline)
                    .put("gameOverDetail", this.gameOverDetail)
                    .put("localWon", this.localWon)
                    .put("rematchOffered", this.rematchOffered)
                    .put("checkSquare", this.checkSquare(game))
                    .put("selected", this.session.selected())
                    .put("fen", game.toStateString());

            Json.Arr squares = new Json.Arr();
            for (int i = 0; i < Square.COUNT; i++) {
                squares.add(squareJson(game, i));
            }
            root.put("squares", squares);

            Json.Arr targets = new Json.Arr();
            int selected = this.session.selected();
            if (selected >= 0 && this.session.canPlayNow()) {
                for (int to : this.session.destinationsFor(selected)) {
                    targets.add(to);
                }
            }
            root.put("legalTargets", targets);

            MoveMark mark = this.session.lastMove();
            if (mark == null) {
                root.putNullable("lastMove", null);
            } else {
                root.put("lastMove", new Json.Obj().put("from", mark.from()).put("to", mark.to()));
            }

            // Every piece the move carried, not just the one that was dragged,
            // so a castling rook slides across instead of blinking out.
            Json.Arr moved = new Json.Arr();
            if (mark != null) {
                for (MoveMark.Relocation relocation : mark.relocations()) {
                    moved.add(new Json.Obj()
                            .put("from", relocation.from())
                            .put("to", relocation.to()));
                }
            }
            root.put("moved", moved);

            Json.Arr history = new Json.Arr();
            List<String> moves = this.session.history();
            for (int i = 0; i < moves.size(); i++) {
                history.add(moves.get(i));
            }
            root.put("history", history);
            return root.toString();
        }
    }

    private Json.Obj squareJson(ChessGame game, int square) {
        Piece piece = game.pieceAt(square);
        int file = Square.fileOf(square);
        int row = Square.rankRowOf(square);
        Json.Obj out = new Json.Obj()
                .put("index", square)
                .put("name", Square.nameOf(square))
                // a1 is a dark square, so a dark square has an odd file + row.
                .put("dark", (file + row) % 2 != 0)
                .put("file", String.valueOf(Square.fileLabel(file)))
                .put("rank", Square.rankOf(square));
        out.putNullable("piece", piece == null ? null : piece.type().name().toLowerCase());
        out.putNullable("side", piece == null ? null : piece.side().name().toLowerCase());
        return out;
    }

    private int checkSquare(ChessGame game) {
        if (this.session.isFinished()) {
            return -1;
        }
        return game.isInCheck() ? game.findKing(game.sideToMove()) : -1;
    }

    private boolean thinking() {
        Transport transport = this.bridge.transport;
        if (!(transport instanceof LocalTransport)) {
            return false;
        }
        return this.mode == Mode.SINGLE_PLAYER
                && this.session.game().sideToMove() != this.session.localSide()
                && !this.session.isFinished();
    }

    // ------------------------------------------------------------------
    // Transport wiring
    // ------------------------------------------------------------------

    private void startServer() {
        GameServer created = new GameServer(this.playerName, RoomCode.random(),
                () -> this.session.game().toStateString(), Protocol.GAME_PORT);
        // The listener is how the server reports that the port is free, so the
        // code and address are only published once the room really exists.
        created.setRoomHostListener(new RoomHostListener() {
            @Override
            public void onRoomOpened(String address, int port) {
                synchronized (GameController.this.lock) {
                    GameController.this.localAddress = address;
                    GameController.this.roomCode = created.roomCode().text();
                    GameController.this.pending = "";
                    GameController.this.error = "";
                    GameController.this.server = created;
                    GameController.this.bridge.transport = created;
                    GameController.this.session.attach(created);
                }
            }

            @Override
            public void onRoomOpenFailed(String detail) {
                synchronized (GameController.this.lock) {
                    GameController.this.error = detail == null ? "Could not open a room." : detail;
                    GameController.this.mode = Mode.IDLE;
                    GameController.this.pending = "";
                }
            }

            @Override
            public void onAdvertisingStopped() {
            }
        });
        created.start(this.bridge);
    }

    private void startSearch() {
        final RoomCode code = RoomCode.parse(this.roomCode);
        final RoomFinder search = new RoomFinder(code);
        synchronized (this.lock) {
            this.finder = search;
        }
        Thread worker = new Thread(() -> {
            try {
                InetAddress host = search.awaitHost(12000L);
                if (host == null) {
                    synchronized (this.lock) {
                        if (this.mode == Mode.JOINING) {
                            this.error = "No room " + code.text() + " answered. Check the code, or enter the host address below.";
                            this.mode = Mode.IDLE;
                            this.pending = "";
                        }
                    }
                    return;
                }
                this.connect(new GameClient(this.playerName, code, host.getHostAddress(), Protocol.GAME_PORT));
            } catch (Exception e) {
                synchronized (this.lock) {
                    if (this.mode == Mode.JOINING) {
                        this.error = "Search failed: " + describe(e);
                        this.mode = Mode.IDLE;
                        this.pending = "";
                    }
                }
            } finally {
                try {
                    search.close();
                } catch (RuntimeException e) {
                    // nothing useful to do
                }
            }
        }, "chessgame-room-finder");
        worker.setDaemon(true);
        this.searchThread = worker;
        worker.start();
    }

    private void connect(GameClient newClient) {
        synchronized (this.lock) {
            if (this.mode != Mode.JOINING || this.closing) {
                return;
            }
            this.client = newClient;
            this.pending = "";
            this.bridge.transport = newClient;
            this.session.attach(newClient);
        }
        newClient.start(this.bridge);
    }

    private void teardownLocked() {
        Thread searching = this.searchThread;
        this.searchThread = null;
        if (searching != null) {
            searching.interrupt();
        }
        if (this.finder != null) {
            closeQuietly(this.finder::close);
            this.finder = null;
        }
        if (this.server != null) {
            closeQuietly(this.server::close);
            this.server = null;
        }
        if (this.client != null) {
            closeQuietly(this.client::close);
            this.client = null;
        }
        Transport transport = this.bridge.transport;
        if (transport != null) {
            closeQuietly(transport::close);
            this.bridge.transport = null;
        }
    }

    private static void closeQuietly(Runnable closer) {
        if (closer == null) {
            return;
        }
        try {
            closer.run();
        } catch (RuntimeException e) {
            // shutting down, so a failure here is not worth reporting
        }
    }

    private void clearGameOver() {
        this.gameOver = false;
        this.gameOverHeadline = "";
        this.gameOverDetail = "";
        this.localWon = false;
        this.rematchOffered = false;
    }

    private static boolean isRoomCode(String text) {
        return text != null && text.length() == RoomCode.LENGTH && text.chars().allMatch(Character::isDigit);
    }

    private static String clean(String value, String fallback) {
        if (value == null) {
            return fallback;
        }
        String trimmed = value.trim();
        if (trimmed.isEmpty()) {
            return fallback;
        }
        return trimmed.length() > 20 ? trimmed.substring(0, 20) : trimmed;
    }

    private static String describe(Exception e) {
        String message = e.getMessage();
        return message == null || message.isBlank() ? e.getClass().getSimpleName() : message;
    }

    private static PieceType pieceType(String name) {
        if (name != null) {
            for (PieceType type : PieceType.values()) {
                if (type.name().equalsIgnoreCase(name.trim())) {
                    return type;
                }
            }
        }
        return PieceType.QUEEN;
    }

    /** Carries transport callbacks into the controller. */
    private final class Bridge implements TransportListener {

        private volatile Transport transport;

        @Override
        public void onConnected(ConnectionInfo info) {
            synchronized (GameController.this.lock) {
                GameController.this.pending = "";
                GameController.this.error = "";
                if (info.boardState() != null && !info.boardState().isBlank()) {
                    try {
                        GameController.this.session.setGame(ChessGame.fromStateString(info.boardState()));
                    } catch (RuntimeException e) {
                        GameController.this.session.setGame(new ChessGame());
                    }
                } else {
                    GameController.this.session.setGame(new ChessGame());
                }
                if (info.roomCode() != null) {
                    GameController.this.roomCode = info.roomCode().text();
                }
            }
        }

        @Override
        public void onMessage(Message message) {
            synchronized (GameController.this.lock) {
                GameController.this.session.onRemoteMessage(message);
            }
        }

        @Override
        public void onDisconnected(String reason) {
            synchronized (GameController.this.lock) {
                GameController.this.pending = "";
                if (GameController.this.session.isFinished()) {
                    GameController.this.error = "";
                    return;
                }
                if (GameController.this.mode == Mode.IDLE) {
                    GameController.this.error = reason == null || reason.isBlank()
                            ? "The other player disconnected." : reason;
                    return;
                }
                GameController.this.session.onDisconnected(reason);
            }
        }

        @Override
        public void onProtocolError(String detail) {
            synchronized (GameController.this.lock) {
                GameController.this.error = detail == null ? "" : detail;
            }
        }
    }
}
