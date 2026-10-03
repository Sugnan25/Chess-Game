/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.core;

public final class Square {
    public static final int COUNT = 64;
    public static final int A8 = 0;
    public static final int H1 = 63;

    private Square() {
    }

    public static boolean isValid(int index) {
        return index >= 0 && index < 64;
    }

    public static int fileOf(int index) {
        return index & 7;
    }

    public static int rankRowOf(int index) {
        return index >> 3;
    }

    public static int rankOf(int index) {
        return 8 - (index >> 3);
    }

    public static int of(int file, int row) {
        if (file < 0 || file > 7 || row < 0 || row > 7) {
            throw new IllegalArgumentException("Square out of range: file=" + file + " row=" + row);
        }
        return row << 3 | file;
    }

    public static int fromName(String name) {
        if (name == null || name.length() != 2) {
            throw new IllegalArgumentException("Bad square name: " + name);
        }
        char fileChar = Character.toLowerCase(name.charAt(0));
        if (fileChar < 'a' || fileChar > 'h') {
            throw new IllegalArgumentException("Bad file in square name: " + name);
        }
        int rank = name.charAt(1) - 48;
        if (rank < 1 || rank > 8) {
            throw new IllegalArgumentException("Bad rank in square name: " + name);
        }
        return Square.of(fileChar - 97, 8 - rank);
    }

    public static String nameOf(int index) {
        if (!Square.isValid(index)) {
            throw new IllegalArgumentException("Square out of range: " + index);
        }
        return "" + (char)(97 + Square.fileOf(index)) + Square.rankOf(index);
    }

    public static int rowLabel(int row) {
        return 8 - row;
    }

    public static char fileLabel(int file) {
        return (char)(97 + file);
    }
}

