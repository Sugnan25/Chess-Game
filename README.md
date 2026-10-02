# Chess Game

Play chess against the computer or a friend on the same Wi-Fi. No server, no
internet, no account.

The game is a desktop window that renders an HTML, CSS and JavaScript interface,
served by the Java process itself. The rules engine and networking are plain
Java, so the same code can be reused in a mobile app later.

## Two ways to play

**Against the computer.** Pick Simple, Medium or Hard and a colour, and the
built-in engine plays a real game. The search runs on a background thread, so the
board stays responsive while it thinks.

**With a friend.** One device opens a room with a 4-digit code; the other joins
it, either by looking for the room on the network or by typing the host's address
by hand.

## Playing

The start screen has three things on it: your name, a computer game, and a friend
game. Starting either one switches the window into game mode, where the board
fills the screen and a slim rail beside it holds the move list and the buttons.

| Action | How |
| --- | --- |
| Select a piece | Click it; legal destinations are marked with a dot |
| Move | Click a marked square |
| Promote | A panel offers queen, rook, bishop or knight |
| Resign | **Resign** in the rail |
| Rematch | **Rematch** once the game has ended |
| Leave | **Menu** at the top left |

The board is drawn from the piece placement the Java side reports. Pieces live in
their own layer, so a move slides from one square to the next, a captured piece
fades out where it stood, and a promotion slides into place. The board flips so
your pieces are always nearest you, the last move stays highlighted, the king glows
while it is in check, and the squares you have taken are listed beside each
player.

## Single player

The computer opponent is a negamax search with alpha-beta pruning, iterative
deepening, a quiescence search, and move ordering. It shares the exact same
`ChessGame` and `GameSession` code as a networked game, which is why a single
player game cannot drift out of step with the rules.

| Level | Search depth | Search budget | Reply time | Behaviour |
| --- | --- | --- | --- | --- |
| Simple | 1 | 0.12s | 2.0-2.3s | Hangs pieces, misses tactics a beginner would see |
| Medium | 3 | 0.7s | 2.4-2.7s | Steady club-level play |
| Hard | 6 | 2.6s | 2.8-3.1s | Full search, no deliberate mistakes |

The search budget is only a ceiling. A shallow level is ready in milliseconds, so
`LocalTransport` holds the reply back to a human pace instead of letting it snap
onto the board: a short reaction delay, then a wait until the level's minimum
think time has passed, plus a little jitter so repeated games do not feel
mechanical. The level's minimum is also published to the interface as
`minimumThinkMillis`, and the difficulty cards state the wait.

The weaker levels play a *near-best* move instead of a random one, which is how a
human beginner actually plays, and they add a little evaluation noise so repeated
games do not open identically. Hard plays the best move it can find.

You can play either colour. Choosing black means the computer opens the game.

## Play with a friend

1. Player 1 chooses **Open a room**. The app picks a random 4-digit code and
   starts advertising it on the local network.
2. Player 2 types the code and chooses **Find room**. The host is found over UDP
   broadcast.
3. The host is always **White** and the joining player is always **Black**. The
   host sends the starting position during the handshake so both boards agree.
4. Moves, resignations and rematch requests are sent as they are played. A
   `PING`/`PONG` keepalive detects a player who walked away.

If UDP broadcast is blocked, the join panel has a manual field for the host's IP
address.

## Requirements

- Java 17 or newer (developed against Java 21)
- Maven 3.9+
- For LAN play: both devices on the same network, or on one hotspot
- For LAN play: the host firewall must allow inbound TCP `47890` and UDP `47891`

If two devices cannot see each other, the usual culprits are guest/client
isolation on the Wi-Fi network, or a VPN on one of the devices.

## Build and run

```bash
mvn clean package
java -jar target/chess-game.jar
```

`target/lib` is written next to the jar and holds the JavaFX libraries, so the jar
runs on its own. From VS Code, press **F5** (`.vscode/launch.json` is set up); it
runs the `maven: build for launch` task first, then starts
`com.lanchess.app.Launcher`.

`.vscode/tasks.json` also offers these as runnable tasks, so **Ctrl+Shift+B**
(build) and **Ctrl+Shift+P → Tasks: Run Task** work without the terminal:

| Task | Command |
| --- | --- |
| `maven: compile` | `mvn -q compile` |
| `maven: test` | `mvn clean test` |
| `maven: package` | `mvn clean package` |
| `maven: build for launch` | `mvn -q clean package -DskipTests` |
| `run jar` | `java -jar target\chess-game.jar` |

Prefer `mvn clean test` over `mvn test`. The project path contains a space, and
stale classes in `target` can otherwise break test discovery. Note that a test
run binds the LAN ports; close a running copy of the game first, or the
`/api/host` test fails to claim port `47890`.

## Rules

The engine implements legal move generation and the full standard rules set:

- Castling, including the squares the king passes through
- En passant
- Promotion, chosen from all four pieces
- Check, checkmate, and stalemate
- Insufficient material
- FEN import and export, with a compact internal state string

**Not implemented:** the fifty-move rule, threefold repetition, and draw offers.
A game therefore ends on checkmate, stalemate, a king capture, insufficient
material, or resignation. There are no clocks and no undo.

`RulesTest` verifies the engine against the published perft reference counts, so
a move-generation or make/unmake regression fails the build rather than showing
up in a game.

## Networking details

| Setting | Value |
| --- | --- |
| Game port (TCP) | `47890` |
| Discovery port (UDP) | `47891` |
| Discovery packet | `CHESSGAME\|<version>\|<code>\|<name>\|<port>` |
| Wire format | Newline-delimited `TYPE\|arg\|arg...` |
| Message types | `JOIN`, `WELCOME`, `MOVE`, `RESIGN`, `REMATCH`, `PING`, `PONG`, `BYE`, `ERROR` |

Both ports and the discovery magic live in `Protocol`. Change them there and
rebuild if your network blocks the defaults. Both players must run a build with
the same magic, since a mismatched packet is ignored rather than misread.

## How the interface is wired

The desktop shell is only a window. `WebServer` starts an HTTP server on the
loopback interface, serves `src/main/resources/web`, and exposes a small JSON API.
The page reads `/api/state` on a timer and posts commands such as `select` and
`move`. A command answers with the state it produced, so a click is answered by
the one request that carried it rather than by a poll afterwards; `/api/state` is
what picks up the moves the computer plays, which arrive while nobody is clicking.

That means the browser holds no rules of its own: it asks what is legal and it is
told. The window is bound to `127.0.0.1` on a port the app picks at startup, so
the interface is not reachable from the network; friend-to-friend traffic goes
over the separate game port.

The poll rate follows the state of the game: about 110ms while the opponent is
thinking, about 170ms on your turn, and about 420ms when nothing is happening. A
command skips the wait entirely, so the board answers a click on the next poll
rather than up to 170ms later.

### How a piece moves on screen

`GameSession` decides the move and then reports every piece that changed square
as a `MoveMark` with a list of relocations. That list is what makes special moves
look right: a castled rook and an en passant victim are not standing on the
move's own two squares, so an animation told only about the dragged piece would
leave them blinking out and back in. The session stays free of any UI type and
simply hands over the whole set; the page slides each one.

Pieces are drawn in three layers — the piece itself, a soft shadow, and a
highlight — and the ones in play animate with `transform` and `opacity` only, so
the compositor keeps them smooth. The board also holds your own piece in place the
moment you drop it and reconciles when the server agrees, which is why a move
never appears to jump backwards.

### Colour themes

Three themes ship in `styles.css`: **Ember** (the default), **Slate** and
**Forest**. The picker sits on the start screen, the choice is saved under
`localStorage` key `chessgame.theme`, and switching is a single attribute on the
document root, so no stylesheet is reloaded.

## Project layout

```
src/main/java/com/lanchess/
  core/     Chess engine and computer opponent. Pure Java, no UI or socket imports.
  net/      Room codes, wire protocol, UDP discovery, TCP transports, LocalTransport.
  session/  GameSession: whose turn it is, history, rematch, resign. No UI types.
  server/   GameController, WebServer and a small JSON reader/writer.
  app/      DesktopApp and Launcher: the JavaFX window and its web view.
src/main/resources/web/
  index.html  The markup for both screens.
  css/styles.css  All layout, colour and animation.
  js/app.js      Rendering, board input, and the state poll.
src/test/java/com/lanchess/
  ChessGameTest.java     Move generation, FEN, game end conditions.
  RulesTest.java         Rules, perft reference counts, state serialisation.
  ComputerEngineTest.java Tactic, legality, difficulty and evaluation checks.
  ProtocolTest.java      Handshake, framing, discovery, disconnect handling.
  LocalTransportTest.java Reply pacing: every level holds its minimum think time.
  GameSessionTest.java   The relocations a move reports, including castling,
                         en passant and promotion.
  WebServerTest.java     The JSON API and the served interface files.
  JsonTest.java          The JSON reader and writer.
```

`core`, `net` and `session` deliberately depend only on the JDK. `LocalTransport`
implements the same `Transport` interface as the socket-based client and server,
which is what lets single player reuse the networked session code.

## Mobile port

The desktop layer is the only part that cannot be reused. To ship on a phone:

1. Put `core`, `net` and `session` in a shared module, and reuse them unchanged.
2. Replace `RoomAdvertiser`/`RoomFinder` UDP broadcast with NSD (`NsdManager`)
   plus a `DatagramSocket` fallback, since mobile restricts broadcast sends.
3. Render `GameSession` however the platform likes. The web interface in
   `resources/web` can be reused inside a `WebView` on Android, which is the
   shortest path; otherwise `stateJson()` is already a complete description of the
   position.
4. Swap the Maven build for Gradle and add the mobile Gradle Plugin.

The protocol, room codes and computer engine need no changes.
