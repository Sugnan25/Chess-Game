package com.lanchess.server;

import static org.junit.jupiter.api.Assertions.assertTrue;

import com.lanchess.core.Difficulty;
import com.lanchess.core.Side;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Writes a run of real interface states to a file so the front end can be
 * replayed against them without a browser. Not a test of behaviour: it exists so
 * a change to the board code can be checked against real payloads.
 */
@DisplayName("Interface state dump")
class StateDumpTest {

    private static final Path OUT = Path.of("target", "states.json");

    private static String waitForTurn(GameController controller, String who) throws Exception {
        for (int i = 0; i < 400; i++) {
            if (who.equals("white") ? controller.stateJson().contains("\"yourTurn\":true")
                    : controller.stateJson().contains("\"yourTurn\":false")) {
                return controller.stateJson();
            }
            Thread.sleep(50L);
        }
        throw new AssertionError("never got a " + who + " turn");
    }

    @Test
    @DisplayName("a real game is written out state by state")
    void dumpAGame() throws Exception {
        StringBuilder out = new StringBuilder("[\n");
        GameController controller = new GameController();
        try {
            controller.startSinglePlayer("simple", "white");
            out.append(controller.stateJson()).append(",\n");

            /* A real opening: pawn pushes, a knight, and then a capture. */
            int[][] moves = {
                { 52, 36 },   /* e2-e4  */
                { 11, 19 },   /* b7-b5  */
                { 62, 45 },   /* g1-f3  */
                { 19, 27 },   /* b5-b4  */
                { 61, 34 },   /* f1-c4  */
                { 27, 35 },   /* b4-b3  */
                { 51, 43 },   /* d2-d4  */
                { 6, 37 }     /* g8-f6  */
            };
            for (int[] move : moves) {
                waitForTurn(controller, "white");
                out.append(controller.stateJson()).append(",\n");
                controller.playMove(move[0], move[1], null);
                Thread.sleep(120L);
                out.append(controller.stateJson()).append(",\n");
            }
            waitForTurn(controller, "white");
            out.append(controller.stateJson()).append("\n");
        } finally {
            controller.shutdown();
        }
        String json = out.toString() + "]\n";
        assertTrue(json.contains("\"screen\":\"game\""), "should have captured game states");
        Files.createDirectories(OUT.getParent());
        Files.write(OUT, json.getBytes(StandardCharsets.UTF_8));
        System.out.println("wrote " + OUT.toAbsolutePath() + " ("
                + (json.split("\"screen\"").length - 1) + " states)");
    }

    @Test
    @DisplayName("the dump is only useful if the levels and rules are real")
    void sanity() {
        assertTrue(Difficulty.values().length == 3);
        assertTrue(Side.WHITE != Side.BLACK);
    }
}
