/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.net;

public enum MessageType {
    JOIN,
    WELCOME,
    MOVE,
    RESIGN,
    REMATCH,
    PING,
    PONG,
    BYE,
    ERROR;


    public static MessageType parse(String raw) {
        if (raw == null) {
            return null;
        }
        String candidate = raw.trim();
        for (MessageType t : MessageType.values()) {
            if (t.name().equalsIgnoreCase(candidate)) {
                return t;
            }
        }
        return null;
    }
}

