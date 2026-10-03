/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.core;

public enum Side {
    WHITE,
    BLACK;


    public Side opposite() {
        return this == WHITE ? BLACK : WHITE;
    }

    public boolean isEnemyOf(Side side) {
        return side != null && side != this;
    }
}

