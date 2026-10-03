/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.net;

import com.lanchess.net.ConnectionInfo;
import com.lanchess.net.Message;

public interface TransportListener {
    public void onConnected(ConnectionInfo var1);

    public void onMessage(Message var1);

    public void onDisconnected(String var1);

    public void onProtocolError(String var1);
}

