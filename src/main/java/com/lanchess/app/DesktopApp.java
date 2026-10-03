package com.lanchess.app;

import com.lanchess.server.GameController;
import com.lanchess.server.WebServer;
import java.io.IOException;
import javafx.application.Application;
import javafx.application.Platform;
import javafx.scene.Scene;
import javafx.scene.image.Image;
import javafx.scene.web.WebView;
import javafx.stage.Stage;

/**
 * The desktop shell.
 *
 * <p>The window itself is JavaFX, but it only holds a web view. Everything the
 * player sees is HTML, CSS and JavaScript served by {@link WebServer}, so the
 * interface can be restyled without touching this class.
 */
public final class DesktopApp extends Application {

    /** The size the window returns to when it is un-maximised. */
    private static final int WINDOW_WIDTH = 1280;
    private static final int WINDOW_HEIGHT = 860;
    private static final int MIN_WIDTH = 940;
    private static final int MIN_HEIGHT = 640;

    private GameController controller;
    private WebServer server;

    @Override
    public void start(Stage stage) {
        this.controller = new GameController();
        try {
            this.server = new WebServer(this.controller);
            int port = this.server.start();
            WebView view = new WebView();
            view.getEngine().setJavaScriptEnabled(true);
            view.getEngine().load(this.server.url());
            Scene scene = new Scene(view, WINDOW_WIDTH, WINDOW_HEIGHT);
            stage.setTitle("Chess Game");
            stage.setScene(scene);
            stage.setMinWidth(MIN_WIDTH);
            stage.setMinHeight(MIN_HEIGHT);
            stage.setOnCloseRequest(event -> this.stopEverything());
            stage.show();
            /*
               The board is sized from the height left over in its column, so a
               window that stops short of the screen leaves a small board in a
               large empty frame. Opening on the work area gives the board the
               height it wants; un-maximising still drops back to the size above.
            */
            stage.setMaximized(true);
        } catch (IOException e) {
            throw new IllegalStateException("Could not start the game window", e);
        }
    }

    private void stopEverything() {
        if (this.server != null) {
            this.server.stop();
        }
        if (this.controller != null) {
            this.controller.shutdown();
        }
    }

    @Override
    public void stop() {
        this.stopEverything();
        Platform.exit();
    }

    public static void main(String[] args) {
        launch(args);
    }
}
