/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.core;

import com.lanchess.core.PieceType;
import com.lanchess.core.Side;
import java.util.Objects;

public final class Piece {
    private final PieceType type;
    private final Side side;

    private Piece(PieceType type, Side side) {
        this.type = Objects.requireNonNull(type, "type");
        this.side = Objects.requireNonNull(side, "side");
    }

    public static Piece of(PieceType type, Side side) {
        return new Piece(type, side);
    }

    public static Piece white(PieceType type) {
        return new Piece(type, Side.WHITE);
    }

    public static Piece black(PieceType type) {
        return new Piece(type, Side.BLACK);
    }

    public PieceType type() {
        return this.type;
    }

    public Side side() {
        return this.side;
    }

    public boolean isWhite() {
        return this.side == Side.WHITE;
    }

    public boolean isBlack() {
        return this.side == Side.BLACK;
    }

    public boolean isFriendlyTo(Piece other) {
        return other != null && other.side == this.side;
    }

    public char toFenChar() {
        if (this == null) {
            return '.';
        }
        char s = this.type.symbol();
        return this.side == Side.WHITE ? s : Character.toLowerCase(s);
    }

    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof Piece)) {
            return false;
        }
        Piece p = (Piece)o;
        return this.type == p.type && this.side == p.side;
    }

    public int hashCode() {
        return this.type.hashCode() * 31 + this.side.hashCode();
    }

    public String toString() {
        return String.valueOf((Object)this.side) + " " + String.valueOf((Object)this.type);
    }
}

