package com.lanchess.server;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * A small HTTP server for the game.
 *
 * <p>It serves the interface out of the classpath and exposes a handful of JSON
 * endpoints the page calls. It binds to the loopback interface only: the
 * interface is not meant to be reachable from the network, and the friend-to-
 * friend traffic goes over the separate game port in {@code Protocol}.
 */
public final class WebServer {

    private static final String WEB_ROOT = "/web";
    private static final int MAX_BODY_BYTES = 64 * 1024;

    private final GameController controller;
    private final Map<String, String> contentTypes = new HashMap<String, String>();
    private HttpServer server;
    private ExecutorService pool;

    public WebServer(GameController controller) {
        this.controller = controller;
        this.contentTypes.put("html", "text/html; charset=utf-8");
        this.contentTypes.put("css", "text/css; charset=utf-8");
        this.contentTypes.put("js", "text/javascript; charset=utf-8");
        this.contentTypes.put("json", "application/json; charset=utf-8");
        this.contentTypes.put("svg", "image/svg+xml");
        this.contentTypes.put("png", "image/png");
        this.contentTypes.put("woff2", "font/woff2");
        this.contentTypes.put("ico", "image/x-icon");
    }

    /** Starts on an arbitrary free port and returns the port it bound to. */
    public int start() throws IOException {
        this.server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        this.server.createContext("/api/state", exchange -> this.reply(exchange, 200, this.controller.stateJson()));
        this.server.createContext("/api/levels", exchange -> this.reply(exchange, 200, this.controller.levelsJson()));
        this.server.createContext("/api/single-player", exchange -> this.post(exchange, body -> {
            this.controller.startSinglePlayer(body.string("level", "medium"), body.string("colour", "white"));
        }));
        this.server.createContext("/api/host", exchange -> this.post(exchange, body -> {
            this.controller.rememberPlayerName(body.string("name", ""));
            this.controller.hostRoom(body.trimmed("name", ""));
        }));
        this.server.createContext("/api/join", exchange -> this.post(exchange, body -> {
            this.controller.rememberPlayerName(body.string("name", ""));
            this.controller.joinRoom(body.trimmed("code", ""), body.trimmed("name", ""));
        }));
        this.server.createContext("/api/join-direct", exchange -> this.post(exchange, body -> {
            this.controller.rememberPlayerName(body.string("name", ""));
            this.controller.joinDirect(body.trimmed("code", ""), body.trimmed("host", ""),
                    body.string("port", "47890"), body.trimmed("name", ""));
        }));
        this.server.createContext("/api/move", exchange -> this.post(exchange, body -> {
            this.controller.playMove(body.integer("from", -1), body.integer("to", -1), body.string("promotion", null));
        }));
        this.server.createContext("/api/select", exchange -> this.post(exchange, body -> {
            this.controller.selectSquare(body.integer("square", -1));
        }));
        this.server.createContext("/api/resign", exchange -> this.post(exchange, body -> {
            this.controller.resign();
        }));
        this.server.createContext("/api/rematch", exchange -> this.post(exchange, body -> {
            this.controller.offerRematch();
        }));
        this.server.createContext("/api/leave", exchange -> this.post(exchange, body -> {
            this.controller.leave();
        }));
        this.server.createContext("/", this::serveAsset);
        this.pool = Executors.newFixedThreadPool(4, runnable -> {
            Thread thread = new Thread(runnable, "chessgame-web");
            // The window must be able to close without waiting on a request.
            thread.setDaemon(true);
            return thread;
        });
        this.server.setExecutor(this.pool);
        this.server.start();
        return this.server.getAddress().getPort();
    }

    /**
     * Stops serving and releases the worker threads. {@code HttpServer.stop()}
     * leaves a pool it was given alone, so the pool is shut down here; otherwise
     * the window would close and the process would stay alive.
     */
    public void stop() {
        if (this.server != null) {
            this.server.stop(0);
        }
        if (this.pool != null) {
            this.pool.shutdownNow();
        }
    }

    /** The address the interface should be loaded from. */
    public String url() {
        return "http://127.0.0.1:" + this.server.getAddress().getPort() + "/";
    }

    private void post(HttpExchange exchange, BodyAction action) throws IOException {
        if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            this.reply(exchange, 405, "{\"error\":\"POST required\"}");
            return;
        }
        Json.Value body = Json.parse(this.readBody(exchange));
        try {
            action.run(body);
        } catch (RuntimeException e) {
            this.reply(exchange, 400, "{\"error\":" + quote(describe(e)) + "}");
            return;
        }
        /*
         * The reply carries the state the command produced, so the page can
         * paint straight from it.
         *
         * It used to say only that the command had been accepted, which left the
         * page waiting for a second request - the next poll - before anything
         * moved. Every click therefore cost two round trips back to back, and on
         * top of that the poll that arrived in between could draw the position as
         * it was before the command, which is the sort of thing that reads as lag
         * when you are clicking squares quickly.
         */
        this.reply(exchange, 200, this.controller.stateJson());
    }

    private void serveAsset(HttpExchange exchange) throws IOException {
        String path = exchange.getRequestURI().getPath();
        if ("/".equals(path) || path.isEmpty()) {
            path = "/index.html";
        }
        String extension = extensionOf(path);
        byte[] body = this.readAsset(path);
        if (body == null) {
            this.reply(exchange, 404, "Not found");
            return;
        }
        exchange.getResponseHeaders().set("Content-Type", this.contentTypeFor(extension));
        // The interface is served from the classpath of a packaged jar, so it
        // can never change under a running game.
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(200, body.length);
        OutputStream out = exchange.getResponseBody();
        try {
            out.write(body);
        } finally {
            out.close();
        }
    }

    private byte[] readAsset(String path) throws IOException {
        if (path.contains("..")) {
            return null;
        }
        String resource = WEB_ROOT + path;
        InputStream in = WebServer.class.getResourceAsStream(resource);
        if (in == null) {
            // Running from an IDE, the resources may only be on disk.
            Path onDisk = devRoot();
            if (onDisk == null) {
                return null;
            }
            Path file = onDisk.resolve(path.substring(1)).normalize();
            if (!file.startsWith(onDisk) || !Files.isRegularFile(file)) {
                return null;
            }
            try {
                return Files.readAllBytes(file);
            } catch (IOException e) {
                return null;
            }
        }
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = in.read(chunk)) > 0) {
                out.write(chunk, 0, read);
            }
            return out.toByteArray();
        } finally {
            in.close();
        }
    }

    private String readBody(HttpExchange exchange) throws IOException {
        InputStream in = exchange.getRequestBody();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] chunk = new byte[4096];
        int read;
        while ((read = in.read(chunk)) > 0 && out.size() < MAX_BODY_BYTES) {
            out.write(chunk, 0, read);
        }
        in.close();
        return out.toString(StandardCharsets.UTF_8);
    }

    private void reply(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, bytes.length);
        OutputStream out = exchange.getResponseBody();
        try {
            out.write(bytes);
        } finally {
            out.close();
        }
    }

    private String contentTypeFor(String extension) {
        String type = this.contentTypes.get(extension);
        return type == null ? "application/octet-stream" : type;
    }

    private static String extensionOf(String path) {
        int dot = path.lastIndexOf('.');
        return dot < 0 ? "" : path.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    private static String describe(Exception e) {
        String message = e.getMessage();
        return message == null || message.isBlank() ? e.getClass().getSimpleName() : message;
    }

    private static String quote(String text) {
        StringBuilder out = new StringBuilder("\"");
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '"' || c == '\\') {
                out.append('\\').append(c);
            } else if (c < 0x20) {
                out.append(' ');
            } else {
                out.append(c);
            }
        }
        return out.append('"').toString();
    }

    private interface BodyAction {
        void run(Json.Value body);
    }

    /** Reads the web assets from disk when they are beside the class files. */
    static Path devRoot() {
        Path candidate = Path.of("src", "main", "resources", "web");
        return Files.isDirectory(candidate) ? candidate : null;
    }
}
