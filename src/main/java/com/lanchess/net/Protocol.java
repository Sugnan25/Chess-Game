/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.net;

public final class Protocol {
    public static final int GAME_PORT = 47890;
    public static final int DISCOVERY_PORT = 47891;
    public static final String BROADCAST_ADDRESS = "255.255.255.255";
    public static final String DISCOVERY_MAGIC = "CHESSGAME";
    public static final int DISCOVERY_VERSION = 1;
    public static final long DISCOVERY_INTERVAL_MS = 1000L;
    public static final long DISCOVERY_GRACE_MS = 3000L;
    public static final int CONNECT_TIMEOUT_MS = 8000;
    public static final long PING_INTERVAL_MS = 5000L;
    public static final long PEER_TIMEOUT_MS = 20000L;
    public static final long HOST_IDLE_TIMEOUT_MS = 600000L;
    public static final int MAX_LINE_LENGTH = 8192;

    private Protocol() {
    }
}

