/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.net;

import com.lanchess.core.Side;
import com.lanchess.net.Message;
import com.lanchess.net.RoomCode;
import com.lanchess.net.TransportListener;

public interface Transport {
    public Side localSide();

    public String localName();

    public String remoteName();

    public RoomCode roomCode();

    public boolean isConnected();

    public void start(TransportListener var1);

    public void send(Message var1);

    public void close();
}

