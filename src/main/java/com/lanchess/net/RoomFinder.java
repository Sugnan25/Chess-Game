/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.net;

import com.lanchess.net.RoomCode;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.Set;

public final class RoomFinder
implements AutoCloseable {
    private final RoomCode roomCode;
    private final Set<InetAddress> found = new LinkedHashSet<InetAddress>();
    private DatagramSocket socket;
    private volatile boolean cancelled;

    public RoomFinder(RoomCode roomCode) {
        this.roomCode = roomCode;
    }

    public InetAddress awaitHost(long timeoutMillis) throws IOException {
        this.socket = this.createSocket();
        this.found.clear();
        byte[] buffer = new byte[512];
        long deadline = System.currentTimeMillis() + timeoutMillis;
        while (!this.cancelled && System.currentTimeMillis() < deadline) {
            InetAddress source;
            this.socket.setSoTimeout((int)Math.max(200L, Math.min(1000L, deadline - System.currentTimeMillis())));
            DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
            try {
                this.socket.receive(packet);
            }
            catch (SocketTimeoutException ignored) {
                continue;
            }
            Announce announce = RoomFinder.parse(packet);
            if (announce == null || !announce.code.equals(this.roomCode) || (source = packet.getAddress()) == null || source.isLoopbackAddress() && !RoomFinder.isSameMachineTesting()) continue;
            this.found.add(source);
            return source;
        }
        return null;
    }

    private DatagramSocket createSocket() throws SocketException {
        DatagramSocket s = new DatagramSocket(null);
        s.setReuseAddress(true);
        try {
            s.bind(new InetSocketAddress(47891));
        }
        catch (SocketException e) {
            s.close();
            throw new SocketException("Could not listen for rooms on UDP port 47891. Another app may already be using it. (" + e.getMessage() + ")");
        }
        s.setBroadcast(true);
        return s;
    }

    private static boolean isSameMachineTesting() {
        return Boolean.getBoolean("lanchess.allowSelfDiscovery");
    }

    static Announce parse(DatagramPacket packet) {
        int version;
        String raw = new String(packet.getData(), packet.getOffset(), packet.getLength(), StandardCharsets.UTF_8);
        String[] parts = raw.split("\\|", -1);
        if (parts.length < 3 || !Protocol.DISCOVERY_MAGIC.equals(parts[0])) {
            return null;
        }
        try {
            version = Integer.parseInt(parts[1].trim());
        }
        catch (NumberFormatException e) {
            return null;
        }
        if (version != 1) {
            return null;
        }
        RoomCode code = RoomCode.parse(parts[2]);
        if (code == null) {
            return null;
        }
        String name = parts.length > 3 ? parts[3] : "";
        int port = 47890;
        if (parts.length > 4) {
            try {
                port = Integer.parseInt(parts[4].trim());
            }
            catch (NumberFormatException numberFormatException) {
                // empty catch block
            }
        }
        return new Announce(code, name, port);
    }

    public Set<InetAddress> hostsSeen() {
        return new LinkedHashSet<InetAddress>(this.found);
    }

    @Override
    public void close() {
        this.cancelled = true;
        DatagramSocket s = this.socket;
        if (s != null) {
            s.close();
        }
    }

    public static final class Announce {
        public final RoomCode code;
        public final String hostName;
        public final int port;

        Announce(RoomCode code, String hostName, int port) {
            this.code = code;
            this.hostName = hostName;
            this.port = port;
        }
    }
}

