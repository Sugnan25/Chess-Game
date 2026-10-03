/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.core;

import com.lanchess.core.PieceType;
import com.lanchess.core.Square;
import java.util.Objects;

public final class Move {
    private final int from;
    private final int to;
    private final PieceType promotion;

    public Move(int from, int to) {
        this(from, to, null);
    }

    public Move(int from, int to, PieceType promotion) {
        if (!Square.isValid(from)) {
            throw new IllegalArgumentException("Bad from square: " + from);
        }
        if (!Square.isValid(to)) {
            throw new IllegalArgumentException("Bad to square: " + to);
        }
        this.from = from;
        this.to = to;
        this.promotion = promotion;
    }

    public static Move of(String algebraic) {
        if (algebraic == null || algebraic.length() != 4) {
            throw new IllegalArgumentException("Bad move: " + algebraic);
        }
        return new Move(Square.fromName(algebraic.substring(0, 2)), Square.fromName(algebraic.substring(2, 4)));
    }

    public int from() {
        return this.from;
    }

    public int to() {
        return this.to;
    }

    public PieceType promotion() {
        return this.promotion;
    }

    public String toAlgebraic() {
        String base = Square.nameOf(this.from) + Square.nameOf(this.to);
        return this.promotion == null ? base : base + Character.toLowerCase(this.promotion.symbol());
    }

    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof Move)) {
            return false;
        }
        Move m = (Move)o;
        return this.from == m.from && this.to == m.to && this.promotion == m.promotion;
    }

    public int hashCode() {
        return Objects.hash(new Object[]{this.from, this.to, this.promotion});
    }

    public String toString() {
        return this.toAlgebraic();
    }
}

