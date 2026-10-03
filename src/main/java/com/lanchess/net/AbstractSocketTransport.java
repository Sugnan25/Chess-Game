/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.net;

import com.lanchess.core.Side;
import com.lanchess.net.Message;
import com.lanchess.net.MessageType;
import com.lanchess.net.RoomCode;
import com.lanchess.net.Transport;
import com.lanchess.net.TransportListener;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

abstract class AbstractSocketTransport
implements Transport {
    private Socket socket;
    private BufferedReader reader;
    private BufferedWriter writer;
    private final Object writeLock = new Object();
    private TransportListener listener;
    private Thread readerThread;
    private Thread keepAliveThread;
    private final AtomicBoolean sessionLive = new AtomicBoolean(false);
    private volatile boolean closed;
    private volatile long lastInboundAt;
    private volatile String closeReason;
    protected volatile String localName = "";
    protected volatile String remoteName = "";
    protected volatile RoomCode roomCode = RoomCode.of(0);
    protected final Side localSide;

    AbstractSocketTransport(Side localSide) {
        this.localSide = localSide;
    }

    @Override
    public Side localSide() {
        return this.localSide;
    }

    @Override
    public String localName() {
        return this.localName;
    }

    @Override
    public String remoteName() {
        return this.remoteName;
    }

    @Override
    public RoomCode roomCode() {
        return this.roomCode;
    }

    @Override
    public boolean isConnected() {
        return this.sessionLive.get() && !this.closed;
    }

    protected void setRemoteName(String name) {
        this.remoteName = name == null ? "" : name;
    }

    protected void setRoomCode(RoomCode code) {
        if (code != null) {
            this.roomCode = code;
        }
    }

    protected void attach(Socket socket, String localName, String peerLabel) throws IOException {
        this.socket = socket;
        this.localName = localName == null ? "" : localName;
        try {
            socket.setTcpNoDelay(true);
            socket.setKeepAlive(true);
            socket.setSoTimeout(0);
        }
        catch (IOException iOException) {
            // empty catch block
        }
        this.reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8), 8192);
        this.writer = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8), 8192);
        this.lastInboundAt = System.currentTimeMillis();
    }

    protected Socket socket() {
        return this.socket;
    }

    protected Message readHandshakeMessage() throws IOException {
        String line = this.readLine();
        if (line == null) {
            return null;
        }
        Message m = Message.decode(line);
        if (m == null) {
            throw new IOException("Unrecognised frame from " + this.peerLabel() + ": " + line);
        }
        return m;
    }

    private String readLine() throws IOException {
        int c;
        StringBuilder sb = new StringBuilder(128);
        while ((c = this.reader.read()) != -1) {
            if (c == 10) {
                return sb.toString();
            }
            sb.append((char)c);
            if (sb.length() <= 8192) continue;
            throw new IOException("Frame exceeded 8192 bytes");
        }
        return sb.length() == 0 ? null : sb.toString();
    }

    protected String peerLabel() {
        Socket s = this.socket;
        return s == null || s.getRemoteSocketAddress() == null ? "peer" : s.getRemoteSocketAddress().toString();
    }

    /*
     * WARNING - Removed try catching itself - possible behaviour change.
     */
    @Override
    public void send(Message message) {
        if (message == null || this.closed) {
            return;
        }
        Object object = this.writeLock;
        synchronized (object) {
            try {
                this.writer.write(message.encode());
                this.writer.flush();
            }
            catch (IOException e) {
                this.failQuietly("Connection lost: " + e.getMessage());
            }
        }
    }

    protected void beginSession(Consumer<Message> onMessage) {
        if (!this.sessionLive.compareAndSet(false, true)) {
            return;
        }
        this.lastInboundAt = System.currentTimeMillis();
        this.readerThread = new Thread(() -> this.readLoop(onMessage), "lanchess-reader");
        this.readerThread.setDaemon(true);
        this.readerThread.start();
        this.keepAliveThread = new Thread(this::keepAliveLoop, "lanchess-keepalive");
        this.keepAliveThread.setDaemon(true);
        this.keepAliveThread.start();
    }

    private void readLoop(Consumer<Message> onMessage) {
        try {
            while (!this.closed) {
                String line;
                try {
                    line = this.readLine();
                }
                catch (SocketTimeoutException e) {
                    continue;
                }
                if (line == null) {
                    this.failQuietly("Opponent closed the connection.");
                    return;
                }
                if (line.isEmpty()) continue;
                this.lastInboundAt = System.currentTimeMillis();
                Message message = Message.decode(line);
                if (message == null) {
                    this.report("Skipped an unrecognised frame from the opponent.");
                    continue;
                }
                if (message.type() == MessageType.PING) {
                    this.send(Message.pong());
                    continue;
                }
                if (message.type() == MessageType.PONG) continue;
                onMessage.accept(message);
            }
        }
        catch (IOException e) {
            this.failQuietly("Connection lost: " + e.getMessage());
        }
    }

    private void keepAliveLoop() {
        while (!this.closed) {
            try {
                Thread.sleep(5000L);
            }
            catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
            if (this.closed) {
                return;
            }
            long idle = System.currentTimeMillis() - this.lastInboundAt;
            if (idle > 20000L) {
                this.failQuietly("Opponent stopped responding.");
                return;
            }
            if (idle < 5000L) continue;
            this.send(Message.ping());
        }
    }

    private void report(String detail) {
        TransportListener l = this.listener;
        if (l != null) {
            l.onProtocolError(detail);
        }
    }

    protected void failQuietly(String reason) {
        if (this.closeReason != null) {
            return;
        }
        this.closeReason = reason == null ? "Disconnected." : reason;
        this.close();
    }

    @Override
    public void close() {
        TransportListener l;
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.sessionLive.set(false);
        Socket s = this.socket;
        if (s != null) {
            try {
                s.close();
            }
            catch (IOException iOException) {
                // empty catch block
            }
        }
        if (this.readerThread != null) {
            this.readerThread.interrupt();
        }
        if (this.keepAliveThread != null) {
            this.keepAliveThread.interrupt();
        }
        if ((l = this.listener) != null && this.closeReason != null) {
            l.onDisconnected(this.closeReason);
        }
    }

    protected void setListener(TransportListener listener) {
        this.listener = listener;
    }

    protected TransportListener listener() {
        return this.listener;
    }

    protected boolean isClosed() {
        return this.closed;
    }
}

