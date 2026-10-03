/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.net;

import java.security.SecureRandom;
import java.util.Random;

public final class RoomCode {
    public static final int LENGTH = 4;
    public static final int MIN_VALUE = 0;
    public static final int MAX_VALUE = 9999;
    private static final SecureRandom RANDOM = new SecureRandom();
    private final int value;

    private RoomCode(int value) {
        this.value = value;
    }

    public static RoomCode of(int value) {
        if (value < 0 || value > 9999) {
            throw new IllegalArgumentException("Room code out of range: " + value);
        }
        return new RoomCode(value);
    }

    public static RoomCode parse(String input) {
        if (input == null) {
            return null;
        }
        String digits = input.replaceAll("[^0-9]", "");
        if (digits.isEmpty() || digits.length() > 4) {
            return null;
        }
        return RoomCode.of(Integer.parseInt(digits));
    }

    public static boolean isValid(String input) {
        return RoomCode.parse(input) != null;
    }

    public static RoomCode random() {
        return RoomCode.random(RANDOM);
    }

    public static RoomCode random(Random rng) {
        for (int attempt = 0; attempt < 1000; ++attempt) {
            int candidate = 1000 + rng.nextInt(9000);
            if (RoomCode.isReserved(candidate)) continue;
            return RoomCode.of(candidate);
        }
        return RoomCode.of(1000 + (int)(rng.nextDouble() * 8999.0));
    }

    /**
     * Repeated-digit codes such as 4444 are the hardest to read out loud and to
     * type correctly, so they are never handed out.
     */
    private static boolean isReserved(int v) {
        String text = String.format("%04d", v);
        for (int i = 1; i < text.length(); i++) {
            if (text.charAt(i) != text.charAt(0)) {
                return false;
            }
        }
        return true;
    }

    public int value() {
        return this.value;
    }

    public String text() {
        return String.format("%04d", this.value);
    }

    public boolean equals(Object o) {
        return o instanceof RoomCode && ((RoomCode)o).value == this.value;
    }

    public int hashCode() {
        return this.value;
    }

    public String toString() {
        return this.text();
    }
}

