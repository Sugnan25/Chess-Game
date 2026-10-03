/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.core;

public enum PieceType {
    KING('K'),
    QUEEN('Q'),
    ROOK('R'),
    BISHOP('B'),
    KNIGHT('N'),
    PAWN('P');

    private final char symbol;

    private PieceType(char symbol) {
        this.symbol = symbol;
    }

    public char symbol() {
        return this.symbol;
    }

    public String label() {
        String n = this.name().toLowerCase();
        return Character.toUpperCase(n.charAt(0)) + n.substring(1);
    }

    public static PieceType fromSymbol(char c) {
        char u = Character.toUpperCase(c);
        for (PieceType t : PieceType.values()) {
            if (t.symbol != u) continue;
            return t;
        }
        throw new IllegalArgumentException("Unknown piece symbol: " + c);
    }
}

