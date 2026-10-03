/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.net;

import com.lanchess.core.Move;
import com.lanchess.core.PieceType;
import com.lanchess.core.Side;
import com.lanchess.core.Square;
import com.lanchess.net.MessageType;
import com.lanchess.net.RoomCode;
import java.util.ArrayList;
import java.util.List;

public final class Message {
    private static final char SEP = '|';
    private static final char END = '\n';
    private final MessageType type;
    private final List<String> args;

    private Message(MessageType type, List<String> args) {
        this.type = type;
        this.args = List.copyOf(args);
    }

    public static Message of(MessageType type, String ... args) {
        ArrayList<String> list = new ArrayList<String>();
        if (args != null) {
            for (String a : args) {
                list.add(a == null ? "" : a);
            }
        }
        return new Message(type, list);
    }

    public static Message join(String playerName) {
        return Message.of(MessageType.JOIN, Message.sanitize(playerName));
    }

    public static Message welcome(Side yourSide, String boardState, String hostName, String guestName, RoomCode code) {
        return Message.of(MessageType.WELCOME, yourSide.name(), boardState, Message.sanitize(hostName), Message.sanitize(guestName), code.text());
    }

    public static Message move(Move move) {
        String promo = move.promotion() == null ? "" : String.valueOf(Character.toLowerCase(move.promotion().symbol()));
        return Message.of(MessageType.MOVE, Square.nameOf(move.from()), Square.nameOf(move.to()), promo);
    }

    public static Message resign() {
        return Message.of(MessageType.RESIGN, new String[0]);
    }

    public static Message rematch() {
        return Message.of(MessageType.REMATCH, new String[0]);
    }

    public static Message ping() {
        return Message.of(MessageType.PING, new String[0]);
    }

    public static Message pong() {
        return Message.of(MessageType.PONG, new String[0]);
    }

    public static Message bye(String reason) {
        return Message.of(MessageType.BYE, Message.sanitize(reason));
    }

    public static Message error(String text) {
        return Message.of(MessageType.ERROR, Message.sanitize(text));
    }

    public MessageType type() {
        return this.type;
    }

    public String playerName() {
        return this.arg(0);
    }

    public Side yourSide() {
        String v = this.arg(0);
        return "BLACK".equalsIgnoreCase(v) ? Side.BLACK : Side.WHITE;
    }

    public String boardState() {
        return this.arg(1);
    }

    public String hostName() {
        return this.arg(2);
    }

    public String guestName() {
        return this.arg(3);
    }

    public RoomCode roomCode() {
        RoomCode c = RoomCode.parse(this.arg(4));
        return c == null ? RoomCode.of(0) : c;
    }

    public Move move() {
        String promo = this.arg(2);
        PieceType type = promo == null || promo.isEmpty() ? null : PieceType.fromSymbol(promo.charAt(0));
        return new Move(Square.fromName(this.arg(0)), Square.fromName(this.arg(1)), type);
    }

    public String text() {
        return this.arg(0);
    }

    private String arg(int i) {
        return i < this.args.size() ? this.args.get(i) : "";
    }

    public int argCount() {
        return this.args.size();
    }

    public String encode() {
        StringBuilder sb = new StringBuilder(48);
        sb.append(this.type.name());
        for (String a : this.args) {
            sb.append('|').append(Message.sanitize(a));
        }
        sb.append('\n');
        return sb.toString();
    }

    public static Message decode(String line) {
        if (line == null) {
            return null;
        }
        String trimmed = line.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        String[] parts = trimmed.split("\\|", -1);
        MessageType type = MessageType.parse(parts[0].trim());
        if (type == null) {
            return null;
        }
        ArrayList<String> args = new ArrayList<String>();
        for (int i = 1; i < parts.length; ++i) {
            args.add(parts[i]);
        }
        return new Message(type, args);
    }

    static String sanitize(String raw) {
        if (raw == null) {
            return "";
        }
        return raw.replace('|', ' ').replace('\n', ' ').replace('\r', ' ').trim();
    }

    public String toString() {
        return String.valueOf((Object)this.type) + " " + String.valueOf(this.args);
    }
}

