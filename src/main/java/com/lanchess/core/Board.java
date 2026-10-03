/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.core;

import com.lanchess.core.Piece;
import com.lanchess.core.PieceType;
import com.lanchess.core.Side;
import com.lanchess.core.Square;
import java.util.ArrayList;
import java.util.List;

public final class Board {
    private final Piece[] squares = new Piece[64];

    public Board() {
    }

    public Board(Board other) {
        System.arraycopy(other.squares, 0, this.squares, 0, 64);
    }

    public Piece get(int index) {
        return Board.isValid(index) ? this.squares[index] : null;
    }

    public void set(int index, Piece piece) {
        if (Board.isValid(index)) {
            this.squares[index] = piece;
        }
    }

    public void clear(int index) {
        if (Board.isValid(index)) {
            this.squares[index] = null;
        }
    }

    public boolean isEmpty(int index) {
        return this.get(index) == null;
    }

    public boolean contains(Side side, PieceType type) {
        for (Piece p : this.squares) {
            if (p == null || p.type() != type || p.side() != side) continue;
            return true;
        }
        return false;
    }

    public int countOf(Side side) {
        int n = 0;
        for (Piece p : this.squares) {
            if (p == null || p.side() != side) continue;
            ++n;
        }
        return n;
    }

    public List<Integer> squaresOf(Side side) {
        ArrayList<Integer> out = new ArrayList<Integer>();
        for (int i = 0; i < 64; ++i) {
            if (this.squares[i] == null || this.squares[i].side() != side) continue;
            out.add(i);
        }
        return out;
    }

    private static boolean isValid(int index) {
        return index >= 0 && index < 64;
    }

    public static Board starting() {
        return Board.fromFenPiecePlacement("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR");
    }

    public static Board fromFenPiecePlacement(String fen) {
        if (fen == null || fen.isEmpty()) {
            throw new IllegalArgumentException("Empty FEN");
        }
        String placement = fen.trim().split("\\s+")[0];
        String[] ranks = placement.split("/", -1);
        if (ranks.length != 8) {
            throw new IllegalArgumentException("FEN must describe 8 ranks, found " + ranks.length + ": " + fen);
        }
        Board b = new Board();
        for (int row = 0; row < 8; ++row) {
            int file = 0;
            for (int i = 0; i < ranks[row].length(); ++i) {
                char c = ranks[row].charAt(i);
                if (c >= '1' && c <= '8') {
                    file += c - 48;
                } else {
                    Side side = Character.isUpperCase(c) ? Side.WHITE : Side.BLACK;
                    PieceType type = PieceType.fromSymbol(c);
                    if (file > 7) {
                        throw new IllegalArgumentException("FEN rank overflows 8 files: " + fen);
                    }
                    b.set(Square.of(file, row), Piece.of(type, side));
                    ++file;
                }
                if (file <= 8) continue;
                throw new IllegalArgumentException("FEN rank overflows 8 files: " + fen);
            }
            if (file == 8) continue;
            throw new IllegalArgumentException("FEN rank " + (8 - row) + " fills " + file + " files instead of 8: " + fen);
        }
        return b;
    }

    public String toFenPiecePlacement() {
        StringBuilder sb = new StringBuilder(71);
        for (int row = 0; row < 8; ++row) {
            int run = 0;
            for (int file = 0; file < 8; ++file) {
                Piece p = this.get(Square.of(file, row));
                if (p == null) {
                    ++run;
                    continue;
                }
                Board.flushRun(sb, run);
                run = 0;
                sb.append(p.toFenChar());
            }
            Board.flushRun(sb, run);
            if (row >= 7) continue;
            sb.append('/');
        }
        return sb.toString();
    }

    private static void flushRun(StringBuilder sb, int run) {
        if (run > 0) {
            sb.append(run);
        }
    }

    public String toString() {
        return this.toFenPiecePlacement();
    }
}

