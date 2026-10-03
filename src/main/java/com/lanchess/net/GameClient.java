/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.net;

import com.lanchess.core.Side;
import com.lanchess.net.AbstractSocketTransport;
import com.lanchess.net.ConnectionInfo;
import com.lanchess.net.Message;
import com.lanchess.net.MessageType;
import com.lanchess.net.RoomCode;
import com.lanchess.net.TransportListener;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;

public final class GameClient
extends AbstractSocketTransport {
    private final String host;
    private final int port;
    private String initialBoardState;

    public GameClient(String playerName, RoomCode roomCode, String host, int port) {
        super(Side.BLACK);
        this.localName = playerName == null ? "" : playerName;
        this.setRoomCode(roomCode);
        this.host = host;
        this.port = port <= 0 ? 47890 : port;
    }

    public GameClient(String playerName, RoomCode roomCode, InetSocketAddress address) {
        this(playerName, roomCode, address.getHostString(), address.getPort());
    }

    public String initialBoardState() {
        return this.initialBoardState;
    }

    @Override
    public void start(TransportListener listener) {
        this.setListener(listener);
        Socket socket = new Socket();
        try {
            socket.connect(new InetSocketAddress(this.host, this.port), 8000);
            this.attach(socket, this.localName, this.host + ":" + this.port);
            socket.setSoTimeout(8000);
            this.send(Message.join(this.localName));
            Message reply = this.readHandshakeMessage();
            if (reply == null) {
                this.failQuietly("The host closed the connection during setup.");
                return;
            }
            if (reply.type() == MessageType.ERROR) {
                this.failQuietly(reply.text());
                return;
            }
            if (reply.type() != MessageType.WELCOME) {
                this.failQuietly("Unexpected reply from the host.");
                return;
            }
            this.initialBoardState = reply.boardState();
            this.setRemoteName(reply.hostName());
            if (reply.roomCode().value() != 0) {
                this.setRoomCode(reply.roomCode());
            }
            socket.setSoTimeout(0);
            ConnectionInfo info = new ConnectionInfo(Side.BLACK, this.localName, reply.hostName(), this.roomCode(), this.initialBoardState, this.host + ":" + this.port);
            this.beginSession(this::dispatch);
            listener.onConnected(info);
        }
        catch (IOException e) {
            this.failQuietly("Could not reach " + this.host + ":" + this.port + ". " + e.getMessage());
        }
    }

    private void dispatch(Message message) {
        TransportListener l = this.listener();
        if (l != null) {
            l.onMessage(message);
        }
    }
}

