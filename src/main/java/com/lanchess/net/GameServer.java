/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.net;

import com.lanchess.core.Side;
import com.lanchess.net.AbstractSocketTransport;
import com.lanchess.net.ConnectionInfo;
import com.lanchess.net.LocalAddress;
import com.lanchess.net.Message;
import com.lanchess.net.MessageType;
import com.lanchess.net.RoomAdvertiser;
import com.lanchess.net.RoomCode;
import com.lanchess.net.RoomHostListener;
import com.lanchess.net.TransportListener;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;

public final class GameServer
extends AbstractSocketTransport {
    private final RoomCode roomCode;
    private final Supplier<String> boardStateSupplier;
    private final int requestedPort;
    private final AtomicBoolean guestAccepted = new AtomicBoolean(false);
    private final AtomicBoolean advertising = new AtomicBoolean(false);
    private RoomHostListener roomListener;
    private RoomAdvertiser advertiser;
    private ServerSocket serverSocket;
    private Thread acceptThread;
    private Thread advertiseStopper;
    private String localIpAddress = "";
    private String currentState;

    public GameServer(String playerName, RoomCode roomCode, Supplier<String> boardStateSupplier) {
        this(playerName, roomCode, boardStateSupplier, 47890);
    }

    public GameServer(String playerName, RoomCode roomCode, Supplier<String> boardStateSupplier, int port) {
        super(Side.WHITE);
        this.localName = playerName == null ? "" : playerName;
        this.roomCode = roomCode;
        this.boardStateSupplier = boardStateSupplier == null ? () -> null : boardStateSupplier;
        this.requestedPort = port;
        this.setRoomCode(roomCode);
    }

    public void setRoomHostListener(RoomHostListener listener) {
        this.roomListener = listener;
    }

    public String localIpAddress() {
        return this.localIpAddress;
    }

    public int port() {
        ServerSocket s = this.serverSocket;
        return s == null ? this.requestedPort : s.getLocalPort();
    }

    @Override
    public RoomCode roomCode() {
        return this.roomCode;
    }

    @Override
    public void start(TransportListener listener) {
        this.setListener(listener);
        try {
            this.serverSocket = new ServerSocket(this.requestedPort, 1, InetAddress.getByName("0.0.0.0"));
        }
        catch (IOException e) {
            RoomHostListener rl = this.roomListener;
            String msg = "Could not open port " + this.requestedPort + ". " + e.getMessage();
            if (rl != null) {
                rl.onRoomOpenFailed(msg);
            } else {
                listener.onDisconnected(msg);
            }
            return;
        }
        this.localIpAddress = LocalAddress.primary();
        if (this.roomListener != null) {
            this.roomListener.onRoomOpened(this.localIpAddress, this.serverSocket.getLocalPort());
        }
        this.startAdvertising();
        this.acceptThread = new Thread(this::acceptLoop, "lanchess-accept");
        this.acceptThread.setDaemon(true);
        this.acceptThread.start();
    }

    private void startAdvertising() {
        this.advertiser = new RoomAdvertiser(this.roomCode, this.localName);
        this.advertiser.start();
        this.advertising.set(true);
        this.advertiseStopper = new Thread(() -> {
            try {
                Thread.sleep(3000L);
            }
            catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
            this.stopAdvertising();
        }, "lanchess-advertise-stop");
        this.advertiseStopper.setDaemon(true);
        this.advertiseStopper.start();
    }

    private void stopAdvertising() {
        if (!this.advertising.compareAndSet(true, false)) {
            return;
        }
        if (this.advertiser != null) {
            this.advertiser.close();
        }
        if (this.roomListener != null) {
            this.roomListener.onAdvertisingStopped();
        }
    }

    private void acceptLoop() {
        while (!this.isClosed()) {
            ServerSocket ss = this.serverSocket;
            if (ss == null) {
                return;
            }
            try {
                ss.setSoTimeout(1000);
                Socket socket = ss.accept();
                if (this.guestAccepted.get()) {
                    this.refuseExtraGuest(socket);
                    continue;
                }
                if (!this.handshake(socket)) continue;
                this.guestAccepted.set(true);
                this.notifyConnected(this.currentState);
            }
            catch (SocketTimeoutException socket) {
            }
            catch (IOException e) {
                if (!this.isClosed()) {
                    this.failQuietly("Host error: " + e.getMessage());
                }
                return;
            }
        }
    }

    private boolean handshake(Socket socket) {
        try {
            socket.setSoTimeout(8000);
            this.attach(socket, this.localName, "guest");
            Message join = this.readHandshakeMessage();
            if (join == null || join.type() != MessageType.JOIN) {
                GameServer.closeQuietly(socket);
                return false;
            }
            this.setRemoteName(join.playerName());
            this.currentState = this.boardStateSupplier.get();
            this.send(Message.welcome(Side.WHITE, this.currentState, this.localName, join.playerName(), this.roomCode));
            socket.setSoTimeout(0);
            this.beginSession(this::dispatch);
            return true;
        }
        catch (IOException e) {
            GameServer.closeQuietly(socket);
            return false;
        }
    }

    /*
     * WARNING - Removed try catching itself - possible behaviour change.
     */
    private void refuseExtraGuest(Socket socket) {
        try {
            socket.setSoTimeout(8000);
            BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            GameServer.drainOneLine(in);
            BufferedWriter out = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8));
            out.write(Message.error("This room already has a player.").encode());
            out.write(Message.bye("Room full.").encode());
            out.flush();
        }
        catch (IOException iOException) {
        }
        finally {
            GameServer.closeQuietly(socket);
        }
    }

    private static void drainOneLine(BufferedReader in) throws IOException {
        int c;
        while ((c = in.read()) != -1) {
            if (c != 10) continue;
            return;
        }
    }

    private static void closeQuietly(Socket socket) {
        try {
            socket.close();
        }
        catch (IOException iOException) {
            // empty catch block
        }
    }

    private void notifyConnected(String state) {
        TransportListener l = this.listener();
        if (l != null) {
            l.onConnected(new ConnectionInfo(Side.WHITE, this.localName, this.remoteName(), this.roomCode, state, this.peerLabel()));
        }
    }

    private void dispatch(Message message) {
        TransportListener l = this.listener();
        if (l != null) {
            l.onMessage(message);
        }
    }

    @Override
    public void close() {
        ServerSocket ss;
        this.stopAdvertising();
        if (this.advertiseStopper != null) {
            this.advertiseStopper.interrupt();
        }
        if ((ss = this.serverSocket) != null) {
            try {
                ss.close();
            }
            catch (IOException iOException) {
                // empty catch block
            }
        }
        if (this.acceptThread != null) {
            this.acceptThread.interrupt();
        }
        super.close();
    }
}

