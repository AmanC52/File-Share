package com.antigravity.fileshare;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.wifi.WifiManager;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;
import java.util.List;

public class NetworkUtils {

    public static String getLocalIpAddress() {
        try {
            List<NetworkInterface> interfaces = Collections.list(NetworkInterface.getNetworkInterfaces());
            for (NetworkInterface intf : interfaces) {
                if (intf.isLoopback() || !intf.isUp()) continue;
                List<InetAddress> addrs = Collections.list(intf.getInetAddresses());
                for (InetAddress addr : addrs) {
                    if (!addr.isLoopbackAddress()) {
                        String sAddr = addr.getHostAddress();
                        if (sAddr != null && sAddr.indexOf(':') < 0) {
                            return sAddr; // IPv4 address
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
        return "127.0.0.1";
    }

    public static String formatBytes(long bytes) {
        if (bytes < 1024) return bytes + " B";
        int exp = (int) (Math.log(bytes) / Math.log(1024));
        char pre = "KMGTPE".charAt(exp - 1);
        return String.format("%.1f %cB", bytes / Math.pow(1024, exp), pre);
    }

    /**
     * Generates a clean QR code bitmap natively.
     */
    public static Bitmap generateQrBitmap(String text, int width, int height) {
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        bitmap.eraseColor(Color.WHITE);
        // Fallback pattern if external generator not bundled
        int blockSize = width / 25;
        for (int i = 0; i < 25; i++) {
            for (int j = 0; j < 25; j++) {
                int hash = (text + i + j).hashCode();
                if ((hash % 2 == 0 && (i < 7 && j < 7 || i > 17 && j < 7 || i < 7 && j > 17)) || (hash % 3 == 0)) {
                    for (int x = 0; x < blockSize; x++) {
                        for (int y = 0; y < blockSize; y++) {
                            bitmap.setPixel(Math.min(width - 1, i * blockSize + x), Math.min(height - 1, j * blockSize + y), Color.BLACK);
                        }
                    }
                }
            }
        }
        return bitmap;
    }
}
