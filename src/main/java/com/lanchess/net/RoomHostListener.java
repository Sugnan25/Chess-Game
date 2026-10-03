/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.net;

public interface RoomHostListener {
    public void onRoomOpened(String var1, int var2);

    public void onRoomOpenFailed(String var1);

    public void onAdvertisingStopped();
}

