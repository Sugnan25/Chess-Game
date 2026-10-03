/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.net;

import com.lanchess.net.Message;
import com.lanchess.net.RoomCode;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

public final class RoomAdvertiser
implements AutoCloseable {
    private final RoomCode roomCode;
    private final String hostName;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private Thread thread;
    private DatagramSocket socket;

    public RoomAdvertiser(RoomCode roomCode, String hostName) {
        this.roomCode = roomCode;
        this.hostName = Message.sanitize(hostName);
    }

    public void run() throws IOException {
        this.socket = new DatagramSocket();
        this.socket.setBroadcast(true);
        byte[] payload = this.buildPayload();
        List<InetAddress> targets = RoomAdvertiser.broadcastTargets();
        this.running.set(true);
        while (this.running.get() && !Thread.currentThread().isInterrupted()) {
            for (InetAddress target : targets) {
                try {
                    DatagramPacket packet = new DatagramPacket(payload, payload.length, target, 47891);
                    this.socket.send(packet);
                }
                catch (IOException iOException) {}
            }
            try {
                Thread.sleep(1000L);
            }
            catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    public void start() {
        if (!this.running.compareAndSet(false, true)) {
            return;
        }
        this.thread = new Thread(() -> {
            try {
                this.run();
            }
            catch (IOException e) {
                this.running.set(false);
            }
        }, "lanchess-advertiser");
        this.thread.setDaemon(true);
        this.thread.start();
    }

    private byte[] buildPayload() {
        String packet = Protocol.DISCOVERY_MAGIC + "|1|" + this.roomCode.text()
                + "|" + this.hostName + "|" + Protocol.GAME_PORT;
        return packet.getBytes(StandardCharsets.UTF_8);
    }

    static List<InetAddress> broadcastTargets() {
        ArrayList<InetAddress> out = new ArrayList<InetAddress>();
        try {
            out.add(InetAddress.getByName("255.255.255.255"));
        }
        catch (IOException iOException) {
            // empty catch block
        }
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (ni.isLoopback() || !ni.isUp()) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    InetAddress b = ia.getBroadcast();
                    if (!(b instanceof Inet4Address)) continue;
                    out.add(b);
                }
            }
        }
        catch (SocketException socketException) {
            // empty catch block
        }
        return out;
    }

    @Override
    public void close() {
        this.running.set(false);
        DatagramSocket s = this.socket;
        if (s != null) {
            s.close();
        }
        if (this.thread != null) {
            this.thread.interrupt();
        }
    }

    public boolean isRunning() {
        return this.running.get();
    }
}

