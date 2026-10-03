package com.lanchess;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.lanchess.server.GameController;
import com.lanchess.server.Json;
import com.lanchess.server.WebServer;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Covers the HTTP surface the interface depends on. No JavaFX is involved, so
 * this runs in a plain headless build.
 */
class WebServerTest {

    private GameController controller;
    private WebServer server;
    private HttpClient client;
    private String base;

    @BeforeEach
    void startServer() throws IOException {
        this.controller = new GameController();
        this.server = new WebServer(this.controller);
        String url = "http://127.0.0.1:" + this.server.start() + "/";
        this.base = url.substring(0, url.length() - 1);
        this.client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
        this.controller.leave();
    }

    @AfterEach
    void stopServer() {
        this.controller.shutdown();
        this.server.stop();
    }

    private HttpResponse<String> get(String path) throws IOException, InterruptedException {
        return this.client.send(HttpRequest.newBuilder(URI.create(this.base + path)).GET().build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> post(String path, String json) throws IOException, InterruptedException {
        return this.client.send(HttpRequest.newBuilder(URI.create(this.base + path))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build(), HttpResponse.BodyHandlers.ofString());
    }

    private Json.Value state() throws IOException, InterruptedException {
        HttpResponse<String> response = this.get("/api/state");
        assertEquals(200, response.statusCode());
        return Json.parse(response.body());
    }

    /*
     * Sends a command and reads the state out of the reply itself.
     *
     * Nothing here asks for the state afterwards, so every test below is also
     * checking that a command comes back describing the position it produced. A
     * command used to answer only that it had been accepted, which left the page
     * to ask again, and cost two round trips for every click.
     */
    private Json.Value command(String path, String json) throws IOException, InterruptedException {
        HttpResponse<String> response = this.post(path, json);
        assertEquals(200, response.statusCode(), response.body());
        Json.Value body = Json.parse(response.body());
        assertFalse(body.string("screen", "").isEmpty(), response.body());
        return body;
    }

    @Nested
    @DisplayName("interface assets")
    class Assets {

        @Test
        @DisplayName("the page and its stylesheet and script are served")
        void servesTheInterface() throws Exception {
            HttpResponse<String> page = get("/");
            assertEquals(200, page.statusCode());
            assertTrue(page.headers().firstValue("Content-Type").orElse("").contains("text/html"));
            assertTrue(page.body().contains("Chess Game"));

            HttpResponse<String> css = get("/css/styles.css");
            assertEquals(200, css.statusCode());
            assertTrue(css.headers().firstValue("Content-Type").orElse("").contains("text/css"));
            assertTrue(css.body().contains(".board"));

            HttpResponse<String> script = get("/js/app.js");
            assertEquals(200, script.statusCode());
            assertTrue(script.headers().firstValue("Content-Type").orElse("").contains("javascript"));
            assertTrue(script.body().contains("api/state"));
        }

        @Test
        @DisplayName("the settings panel and its switches reach the page")
        void servesTheSettingsPanel() throws Exception {
            String page = get("/").body();
            // The panel, and the way in to it from both screens.
            assertTrue(page.contains("id=\"settings\""), "no settings panel");
            assertTrue(page.contains("id=\"btn-settings\""), "no settings button in the game bar");
            assertTrue(page.contains("id=\"btn-settings-home\""), "no settings button on the start screen");

            String script = get("/js/app.js").body();
            assertTrue(script.contains("opt-dots") && script.contains("opt-last")
                && script.contains("opt-coords") && script.contains("opt-volume"),
                "a settings control has no script behind it");
            assertTrue(script.contains("board--no-coords"), "nothing hides the coordinates");
            assertTrue(script.contains("chessgame.settings"), "settings are never remembered");

            String css = get("/css/styles.css").body();
            assertTrue(css.contains(".switch") && css.contains(".settings"),
                "the panel is unstyled");
        }

        @Test
        @DisplayName("the sound engine is built rather than fetched")
        void servesTheSoundEngine() throws Exception {
            String script = get("/js/app.js").body();
            // The sounds are made with the audio graph rather than loaded, so
            // there is no audio to ship and none to go missing.
            assertTrue(script.contains("AudioContext"), "no audio graph");
            assertFalse(script.contains("new Audio("), "an audio file is fetched instead of made");
            for (String voice : new String[] {"select", "move", "capture", "castle", "check", "win", "lose"}) {
                assertTrue(script.contains(voice + ": function"),
                    "no sound for " + voice);
            }
        }

        @Test
        @DisplayName("an unknown path is a 404 rather than a stack trace")
        void rejectsUnknownPaths() throws Exception {
            assertEquals(404, get("/nope.html").statusCode());
        }
    }

    @Nested
    @DisplayName("state and level endpoints")
    class ReadOnly {

        @Test
        @DisplayName("a fresh game describes the starting board and the menu screen")
        void describesTheStartingBoard() throws Exception {
            Json.Value state = state();
            assertEquals("home", state.string("screen", ""));
            assertEquals("idle", state.string("mode", ""));
            assertFalse(state.flag("yourTurn", true));
            assertEquals(-1, state.integer("selected", 0));
            assertEquals(-1, state.integer("checkSquare", 0));
            assertNotNull(state.string("fen", null));
            assertTrue(state.string("fen", "").startsWith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"));
        }

        @Test
        @DisplayName("the three strengths are offered with a label and a blurb")
        void offersTheLevels() throws Exception {
            HttpResponse<String> response = get("/api/levels");
            assertEquals(200, response.statusCode());
            String body = response.body();
            assertTrue(body.contains("\"simple\""));
            assertTrue(body.contains("\"medium\""));
            assertTrue(body.contains("\"hard\""));
            assertTrue(body.contains("blurb"));
        }
    }

    @Nested
    @DisplayName("playing the computer")
    class SinglePlayer {

        @Test
        @DisplayName("starting a game on the easy level hands the player the first move")
        void startsAGame() throws Exception {
            Json.Value state = command("/api/single-player", "{\"level\":\"simple\",\"colour\":\"white\"}");
            assertEquals("game", state.string("screen", ""));
            assertEquals("single_player", state.string("mode", ""));
            assertEquals("white", state.string("localSide", ""));
            assertTrue(state.flag("yourTurn", false));
        }

        @Test
        @DisplayName("a known level is used and an unknown one falls back")
        void acceptsLevelNames() throws Exception {
            assertEquals("game", command("/api/single-player", "{\"level\":\"hard\"}").string("screen", ""));
            assertEquals("game", command("/api/single-player", "{\"level\":\"sideways\"}").string("screen", ""));
        }

        @Test
        @DisplayName("selecting a pawn offers its legal squares and nothing more")
        void offersOnlyLegalSquares() throws Exception {
            command("/api/single-player", "{\"level\":\"simple\",\"colour\":\"white\"}");
            Json.Value state = command("/api/select", "{\"square\":52}");
            assertEquals(52, state.integer("selected", -1));
            // e2 reaches e3 and e4 only.
            assertArrayEquals(new int[] {44, 36}, state.integers("legalTargets"));
        }

        @Test
        @DisplayName("an opponent's piece cannot be picked up")
        void refusesAnOpponentsPiece() throws Exception {
            command("/api/single-player", "{\"level\":\"simple\",\"colour\":\"white\"}");
            Json.Value state = command("/api/select", "{\"square\":12}");
            assertEquals(-1, state.integer("selected", 0));
            assertEquals(0, state.integers("legalTargets").length);
        }

        @Test
        @DisplayName("playing black means waiting for the first move")
        void playingBlackWaits() throws Exception {
            Json.Value state = command("/api/single-player", "{\"level\":\"simple\",\"colour\":\"black\"}");
            assertEquals("black", state.string("localSide", ""));
            assertFalse(state.flag("yourTurn", true));
            state = command("/api/select", "{\"square\":52}");
            assertEquals(-1, state.integer("selected", 0));
        }

        @Test
        @DisplayName("a move updates the position, the history and the last-move marker")
        void playsAMove() throws Exception {
            command("/api/single-player", "{\"level\":\"simple\",\"colour\":\"white\"}");
            String start = state().string("fen", "");
            command("/api/select", "{\"square\":52}");
            Json.Value state = command("/api/move", "{\"from\":52,\"to\":44}");

            assertEquals(-1, state.integer("selected", 0));
            assertEquals(52, state.child("lastMove").integer("from", -1));
            assertEquals(44, state.child("lastMove").integer("to", -1));
            assertTrue(state.string("history", "").contains("e2e3"));
            assertFalse(state.string("fen", "").equals(start));
        }

        @Test
        @DisplayName("an illegal move changes nothing")
        void refusesAnIllegalMove() throws Exception {
            command("/api/single-player", "{\"level\":\"simple\",\"colour\":\"white\"}");
            String before = state().string("fen", "");
            Json.Value after = command("/api/move", "{\"from\":52,\"to\":53}");
            assertEquals(before, after.string("fen", ""));
            assertFalse(after.string("history", "").contains("e4"));
        }

        @Test
        @DisplayName("a square outside the board is ignored")
        void ignoresRubbishInput() throws Exception {
            command("/api/single-player", "{\"level\":\"simple\",\"colour\":\"white\"}");
            Json.Value state = command("/api/move", "{\"from\":99,\"to\":-4}");
            assertTrue(state.string("fen", "").startsWith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"));
            assertEquals(-1, state.integer("selected", 0));
        }

        @Test
        @DisplayName("resigning ends the game with a loss")
        void resigningEndsTheGame() throws Exception {
            command("/api/single-player", "{\"level\":\"simple\",\"colour\":\"white\"}");
            Json.Value state = command("/api/resign", "{}");
            assertTrue(state.flag("finished", false));
            assertTrue(state.flag("gameOver", false));
            assertFalse(state.flag("localWon", true));
        }
    }

    @Nested
    @DisplayName("rooms")
    class Rooms {

        @Test
        @DisplayName("hosting publishes a four digit code and an address")
        void hostingOpensARoom() throws Exception {
            Json.Value state = command("/api/host", "{\"name\":\"Ada\"}");
            assertEquals("hosting", state.string("mode", ""));
            String code = state.string("roomCode", "");
            assertEquals(4, code.length());
            assertTrue(code.chars().allMatch(Character::isDigit));
            assertFalse(state.string("localAddress", "").isBlank());
            assertFalse(state.flag("yourTurn", true));
        }

        @Test
        @DisplayName("a bad code is refused before any searching starts")
        void refusesABadCode() throws Exception {
            Json.Value state = command("/api/join", "{\"code\":\"12\",\"name\":\"Bo\"}");
            assertEquals("idle", state.string("mode", ""));
            assertFalse(state.string("error", "").isBlank());
        }
    }

    @Test
    @DisplayName("leaving returns to the menu and forgets the room")
    void leavingGoesBackToTheMenu() throws Exception {
        command("/api/host", "{\"name\":\"Ada\"}");
        Json.Value state = command("/api/leave", "{}");
        assertEquals("idle", state.string("mode", ""));
        assertEquals("home", state.string("screen", ""));
        assertEquals("", state.string("roomCode", "x"));
    }
}
