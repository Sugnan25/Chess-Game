/*
 * Decompiled with CFR 0.152.
 */
package com.lanchess.net;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.util.Collections;

public final class LocalAddress {
    private LocalAddress() {
    }

    public static String primary() {
        InetAddress best = LocalAddress.bestAddress();
        return best == null ? "127.0.0.1" : best.getHostAddress();
    }

    public static InetAddress bestAddress() {
        InetAddress fallback = null;
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (ni.isLoopback() || !ni.isUp()) continue;
                for (InetAddress address : Collections.list(ni.getInetAddresses())) {
                    if (!(address instanceof Inet4Address) || address.isLoopbackAddress()) continue;
                    if (address.isLinkLocalAddress()) {
                        if (fallback != null) continue;
                        fallback = address;
                        continue;
                    }
                    return address;
                }
            }
        }
        catch (SocketException socketException) {
            // empty catch block
        }
        return fallback;
    }

    public static String describeNetwork() {
        InetAddress a = LocalAddress.bestAddress();
        if (a == null) {
            return "No network detected - connect to Wi-Fi or a hotspot.";
        }
        return "Local address " + a.getHostAddress();
    }
}

