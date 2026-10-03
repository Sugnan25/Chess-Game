/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.net;

import com.lanchess.core.Side;
import com.lanchess.net.RoomCode;

public final class ConnectionInfo {
    private final Side localSide;
    private final String localName;
    private final String remoteName;
    private final RoomCode roomCode;
    private final String boardState;
    private final String remoteAddress;

    public ConnectionInfo(Side localSide, String localName, String remoteName, RoomCode roomCode, String boardState, String remoteAddress) {
        this.localSide = localSide;
        this.localName = localName;
        this.remoteName = remoteName;
        this.roomCode = roomCode;
        this.boardState = boardState;
        this.remoteAddress = remoteAddress;
    }

    public Side localSide() {
        return this.localSide;
    }

    public String localName() {
        return this.localName;
    }

    public String remoteName() {
        return this.remoteName;
    }

    public RoomCode roomCode() {
        return this.roomCode;
    }

    public String boardState() {
        return this.boardState;
    }

    public String remoteAddress() {
        return this.remoteAddress;
    }
}

