package com.lanchess.app;

import javafx.application.Application;

/**
 * The class named by the jar manifest.
 *
 * <p>JavaFX refuses to start when the class holding {@code main} extends
 * {@link Application} and the libraries are on the classpath rather than the
 * module path, which is how this project ships them. A plain launcher gets
 * around that: it is an ordinary class, so the check never runs.
 */
public final class Launcher {

    private Launcher() {
    }

    public static void main(String[] args) {
        Application.launch(DesktopApp.class, args);
    }
}
