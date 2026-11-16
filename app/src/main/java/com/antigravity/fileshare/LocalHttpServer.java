package com.antigravity.fileshare;

import android.content.Context;
import android.graphics.Bitmap;
import android.os.Environment;
import android.webkit.MimeTypeMap;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LocalHttpServer {

    private final int port;
    private final Context context;
    private final File rootDir;
    private ServerSocket serverSocket;
    private boolean isRunning = false;
    private final ExecutorService threadPool = Executors.newCachedThreadPool();
    private final Set<String> connectedClients = Collections.synchronizedSet(new HashSet<>());
    private final Map<String, byte[]> assetCache = new ConcurrentHashMap<>();

    public LocalHttpServer(Context context, int port, File rootDir) {
        this.context = context;
        this.port = port;
        this.rootDir = (rootDir != null && rootDir.exists()) ? rootDir : Environment.getExternalStorageDirectory();
    }

    public synchronized void start() throws IOException {
        if (isRunning) return;
        serverSocket = new ServerSocket(port);
        serverSocket.setReuseAddress(true);
        isRunning = true;

        threadPool.execute(() -> {
            while (isRunning) {
                try {
                    Socket socket = serverSocket.accept();
                    socket.setSoTimeout(30000); // 30s timeout
                    String clientIp = socket.getInetAddress().getHostAddress();
                    connectedClients.add(clientIp);
                    threadPool.execute(() -> handleClient(socket));
                } catch (IOException e) {
                    if (!isRunning) break;
                }
            }
        });
    }

    public synchronized void stop() {
        isRunning = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {}
    }

    public boolean isRunning() {
        return isRunning;
    }

    private void handleClient(Socket socket) {
        try (InputStream rawIn = socket.getInputStream();
             OutputStream out = socket.getOutputStream()) {

            BufferedInputStream in = new BufferedInputStream(rawIn);

            // Read HTTP headers without consuming binary body
            ByteArrayOutputStream headerBaos = new ByteArrayOutputStream();
            int prev3 = -1, prev2 = -1, prev1 = -1, curr = -1;
            while ((curr = in.read()) != -1) {
                headerBaos.write(curr);
                if (prev3 == '\r' && prev2 == '\n' && prev1 == '\r' && curr == '\n') {
                    break;
                }
                prev3 = prev2;
                prev2 = prev1;
                prev1 = curr;
            }

            byte[] headerBytes = headerBaos.toByteArray();
            if (headerBytes.length == 0) return;

            String headerStr = new String(headerBytes, "ISO-8859-1");
            String[] lines = headerStr.split("\r\n");
            if (lines.length == 0) return;

            String[] requestLine = lines[0].split(" ");
            if (requestLine.length < 2) return;

            String method = requestLine[0];
            String fullUri = requestLine[1];
            String path = fullUri.contains("?") ? fullUri.substring(0, fullUri.indexOf("?")) : fullUri;
            Map<String, String> queryParams = parseQueryParams(fullUri);

            Map<String, String> headers = new HashMap<>();
            for (int i = 1; i < lines.length; i++) {
                int colon = lines[i].indexOf(':');
                if (colon > 0) {
                    headers.put(lines[i].substring(0, colon).trim().toLowerCase(), lines[i].substring(colon + 1).trim());
                }
            }

            // Route Requests
            if (path.equals("/") || path.equals("/index.html")) {
                serveAsset(out, "web/index.html", "text/html; charset=utf-8");
            } else if (path.startsWith("/static/")) {
                String assetPath = "web" + path;
                serveAsset(out, assetPath, getMimeType(path));
            } else if (path.equals("/api/browse")) {
                handleBrowse(out, queryParams.get("path"));
            } else if (path.equals("/api/stream") || path.equals("/api/download")) {
                boolean asAttachment = path.equals("/api/download");
                handleStreamOrDownload(out, queryParams.get("path"), headers.get("range"), asAttachment);
            } else if (path.equals("/api/qr")) {
                handleQr(out);
            } else if (path.equals("/api/upload") && method.equalsIgnoreCase("POST")) {
                handleUpload(in, out, queryParams.get("path"), headers);
            } else if (path.equals("/api/mkdir") && method.equalsIgnoreCase("POST")) {
                handleMkdir(in, out, headers);
            } else if (path.equals("/api/delete") && method.equalsIgnoreCase("DELETE")) {
                handleDelete(out, queryParams.get("path"));
            } else if (path.equals("/api/edit") && method.equalsIgnoreCase("POST")) {
                handleEdit(in, out, headers);
            } else if (path.equals("/api/storage")) {
                handleStorage(out);
            } else if (path.equals("/api/clients")) {
                handleClients(out);
            } else {
                sendNotFound(out);
            }

        } catch (Exception ignored) {
        } finally {
            try { socket.close(); } catch (IOException ignored) {}
        }
    }

    private void handleQr(OutputStream out) throws Exception {
        String serverUrl = "http://" + NetworkUtils.getLocalIpAddress() + ":" + port;
        Bitmap qrBitmap = NetworkUtils.generateQrBitmap(serverUrl, 350, 350);
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        qrBitmap.compress(Bitmap.CompressFormat.PNG, 100, baos);
        byte[] pngBytes = baos.toByteArray();

        String header = "HTTP/1.1 200 OK\r\n" +
                "Content-Type: image/png\r\n" +
                "Content-Length: " + pngBytes.length + "\r\n" +
                "Cache-Control: public, max-age=86400\r\n\r\n";
        out.write(header.getBytes());
        out.write(pngBytes);
    }

    private void handleUpload(InputStream in, OutputStream out, String relPath, Map<String, String> headers) throws Exception {
        String contentType = headers.get("content-type");
        if (contentType == null || !contentType.contains("boundary=")) {
            sendJson(out, 400, "{\"error\":\"Missing boundary in multipart request\"}");
            return;
        }

        String boundary = contentType.substring(contentType.indexOf("boundary=") + 9).trim();
        if (boundary.startsWith("\"") && boundary.endsWith("\"")) {
            boundary = boundary.substring(1, boundary.length() - 1);
        }
        byte[] delimiter = ("\r\n--" + boundary).getBytes("ISO-8859-1");

        File targetDir = resolvePath(relPath);
        if (!targetDir.exists()) targetDir.mkdirs();

        // 1. Skip up to first boundary line
        readLine(in);

        // 2. Read headers for the file part
        String filename = "uploaded_file";
        String line;
        while ((line = readLine(in)) != null && !line.isEmpty()) {
            if (line.toLowerCase().startsWith("content-disposition:")) {
                int fnIdx = line.indexOf("filename=\"");
                if (fnIdx > 0) {
                    filename = line.substring(fnIdx + 10);
                    int endIdx = filename.indexOf("\"");
                    if (endIdx > 0) filename = filename.substring(0, endIdx);
                }
            }
        }

        // Clean filename of path traversal
        filename = new File(filename).getName();
        File dest = new File(targetDir, filename);

        // Handle duplicate names with (1), (2)
        if (dest.exists()) {
            String stem = filename;
            String ext = "";
            int dot = filename.lastIndexOf('.');
            if (dot > 0) {
                stem = filename.substring(0, dot);
                ext = filename.substring(dot);
            }
            int counter = 1;
            while (dest.exists()) {
                dest = new File(targetDir, stem + " (" + counter + ")" + ext);
                counter++;
            }
        }

        // 3. Stream file contents until delimiter
        try (FileOutputStream fos = new FileOutputStream(dest)) {
            copyUntilBoundary(in, fos, delimiter);
        }

        long size = dest.length();
        JSONArray uploaded = new JSONArray();
        JSONObject item = new JSONObject();
        item.put("name", dest.getName());
        item.put("size", size);
        item.put("size_str", NetworkUtils.formatBytes(size));
        uploaded.put(item);

        JSONObject response = new JSONObject();
        response.put("uploaded", uploaded);
        response.put("errors", new JSONArray());
        sendJson(out, 200, response.toString());
    }

    private static void copyUntilBoundary(InputStream in, OutputStream fileOut, byte[] delimiter) throws IOException {
        int delimLen = delimiter.length;
        byte[] window = new byte[delimLen];
        int windowFilled = 0;

        for (int i = 0; i < delimLen; i++) {
            int c = in.read();
            if (c == -1) break;
            window[i] = (byte) c;
            windowFilled++;
        }

        while (windowFilled == delimLen) {
            boolean match = true;
            for (int i = 0; i < delimLen; i++) {
                if (window[i] != delimiter[i]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                return; // Reached boundary
            }

            fileOut.write(window[0]);
            System.arraycopy(window, 1, window, 0, delimLen - 1);

            int nextByte = in.read();
            if (nextByte == -1) {
                windowFilled--;
                break;
            }
            window[delimLen - 1] = (byte) nextByte;
        }

        for (int i = 0; i < windowFilled; i++) {
            fileOut.write(window[i]);
        }
    }

    private String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') baos.write(c);
        }
        return baos.toString("ISO-8859-1");
    }

    private void handleMkdir(InputStream in, OutputStream out, Map<String, String> headers) throws Exception {
        int len = Integer.parseInt(headers.getOrDefault("content-length", "0"));
        byte[] body = new byte[len];
        int read = 0;
        while (read < len) {
            int r = in.read(body, read, len - read);
            if (r == -1) break;
            read += r;
        }
        JSONObject json = new JSONObject(new String(body, "UTF-8"));
        String parentRel = json.optString("path", "");
        String name = json.optString("name", "");

        File parent = resolvePath(parentRel);
        File newDir = new File(parent, new File(name).getName());
        boolean success = newDir.mkdirs();
        sendJson(out, success ? 200 : 500, "{\"success\":" + success + "}");
    }

    private void handleDelete(OutputStream out, String relPath) throws Exception {
        File target = resolvePath(relPath);
        if (!target.exists() || target.equals(rootDir)) {
            sendJson(out, 400, "{\"error\":\"Cannot delete path\"}");
            return;
        }
        boolean ok = deleteRecursive(target);
        sendJson(out, ok ? 200 : 500, "{\"success\":" + ok + "}");
    }

    private boolean deleteRecursive(File f) {
        if (f.isDirectory()) {
            File[] children = f.listFiles();
            if (children != null) {
                for (File c : children) deleteRecursive(c);
            }
        }
        return f.delete();
    }

    private void handleEdit(InputStream in, OutputStream out, Map<String, String> headers) throws Exception {
        int len = Integer.parseInt(headers.getOrDefault("content-length", "0"));
        byte[] body = new byte[len];
        int read = 0;
        while (read < len) {
            int r = in.read(body, read, len - read);
            if (r == -1) break;
            read += r;
        }
        JSONObject json = new JSONObject(new String(body, "UTF-8"));
        String relPath = json.optString("path", "");
        String content = json.optString("content", "");

        File target = resolvePath(relPath);
        if (!target.exists() || target.isDirectory()) {
            sendJson(out, 404, "{\"error\":\"File not found\"}");
            return;
        }

        try (FileOutputStream fos = new FileOutputStream(target, false)) {
            fos.write(content.getBytes("UTF-8"));
        }
        sendJson(out, 200, "{\"success\":true,\"size\":" + target.length() + ",\"size_str\":\"" + NetworkUtils.formatBytes(target.length()) + "\"}");
    }

    private void handleBrowse(OutputStream out, String relPath) throws Exception {
        File target = resolvePath(relPath);
        if (!target.exists() || !target.isDirectory()) {
            sendJson(out, 404, "{\"error\":\"Directory not found\"}");
            return;
        }

        File[] files = target.listFiles();
        JSONArray items = new JSONArray();

        if (files != null) {
            Arrays.sort(files, (a, b) -> {
                if (a.isDirectory() != b.isDirectory()) return a.isDirectory() ? -1 : 1;
                return a.getName().compareToIgnoreCase(b.getName());
            });

            for (File f : files) {
                if (f.getName().startsWith(".")) continue;
                JSONObject item = new JSONObject();
                item.put("name", f.getName());
                item.put("path", getRelativePath(f));
                item.put("is_dir", f.isDirectory());
                item.put("type", getFileType(f));
                item.put("size", f.length());
                item.put("size_str", f.isDirectory() ? "" : NetworkUtils.formatBytes(f.length()));
                items.put(item);
            }
        }

        JSONArray breadcrumbs = new JSONArray();
        String currentRel = getRelativePath(target);
        if (!currentRel.isEmpty()) {
            String[] parts = currentRel.split("/");
            StringBuilder builtPath = new StringBuilder();
            for (String part : parts) {
                if (builtPath.length() > 0) builtPath.append("/");
                builtPath.append(part);
                JSONObject crumb = new JSONObject();
                crumb.put("name", part);
                crumb.put("path", builtPath.toString());
                breadcrumbs.put(crumb);
            }
        }

        JSONObject response = new JSONObject();
        response.put("path", currentRel);
        response.put("items", items);
        response.put("breadcrumb", breadcrumbs);
        response.put("read_only", false);

        sendJson(out, 200, response.toString());
    }

    private void handleStreamOrDownload(OutputStream out, String relPath, String rangeHeader, boolean download) throws Exception {
        File target = resolvePath(relPath);
        if (!target.exists() || !target.isFile()) {
            sendNotFound(out);
            return;
        }

        long fileLen = target.length();
        String mime = getMimeType(target.getName());

        if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
            String[] ranges = rangeHeader.substring(6).split("-");
            long start = Long.parseLong(ranges[0]);
            long end = ranges.length > 1 && !ranges[1].isEmpty() ? Long.parseLong(ranges[1]) : fileLen - 1;
            end = Math.min(end, fileLen - 1);
            long contentLength = end - start + 1;

            String header = "HTTP/1.1 206 Partial Content\r\n" +
                    "Content-Type: " + mime + "\r\n" +
                    "Content-Range: bytes " + start + "-" + end + "/" + fileLen + "\r\n" +
                    "Content-Length: " + contentLength + "\r\n" +
                    "Accept-Ranges: bytes\r\n\r\n";
            out.write(header.getBytes());

            try (RandomAccessFile raf = new RandomAccessFile(target, "r")) {
                raf.seek(start);
                byte[] buffer = new byte[65536];
                long remaining = contentLength;
                while (remaining > 0) {
                    int read = raf.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                    if (read == -1) break;
                    out.write(buffer, 0, read);
                    remaining -= read;
                }
            }
        } else {
            String header = "HTTP/1.1 200 OK\r\n" +
                    "Content-Type: " + mime + "\r\n" +
                    "Content-Length: " + fileLen + "\r\n" +
                    (download ? ("Content-Disposition: attachment; filename=\"" + target.getName() + "\"\r\n") : "") +
                    "Accept-Ranges: bytes\r\n\r\n";
            out.write(header.getBytes());

            try (FileInputStream fis = new FileInputStream(target)) {
                byte[] buffer = new byte[65536];
                int read;
                while ((read = fis.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                }
            }
        }
    }

    private void handleStorage(OutputStream out) throws Exception {
        long total = rootDir.getTotalSpace();
        long free = rootDir.getFreeSpace();
        long used = total - free;
        double percent = total > 0 ? ((double) used / total) * 100 : 0;

        JSONObject res = new JSONObject();
        res.put("total", total);
        res.put("used", used);
        res.put("free", free);
        res.put("total_str", NetworkUtils.formatBytes(total));
        res.put("used_str", NetworkUtils.formatBytes(used));
        res.put("free_str", NetworkUtils.formatBytes(free));
        res.put("used_percent", Math.round(percent * 10.0) / 10.0);
        sendJson(out, 200, res.toString());
    }

    private void handleClients(OutputStream out) throws Exception {
        JSONArray arr = new JSONArray();
        for (String ip : connectedClients) {
            JSONObject c = new JSONObject();
            c.put("ip", ip);
            c.put("device_name", "📱 Connected Device");
            arr.put(c);
        }
        JSONObject res = new JSONObject();
        res.put("clients", arr);
        sendJson(out, 200, res.toString());
    }

    private void serveAsset(OutputStream out, String assetPath, String mime) {
        try {
            byte[] bytes = assetCache.get(assetPath);
            if (bytes == null) {
                try (InputStream is = context.getAssets().open(assetPath)) {
                    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                    byte[] data = new byte[16384];
                    int n;
                    while ((n = is.read(data, 0, data.length)) != -1) {
                        buffer.write(data, 0, n);
                    }
                    bytes = buffer.toByteArray();
                    assetCache.put(assetPath, bytes);
                }
            }

            String header = "HTTP/1.1 200 OK\r\n" +
                    "Content-Type: " + mime + "\r\n" +
                    "Content-Length: " + bytes.length + "\r\n" +
                    "Cache-Control: public, max-age=86400\r\n\r\n";
            out.write(header.getBytes());
            out.write(bytes);
        } catch (IOException e) {
            sendNotFound(out);
        }
    }

    private File resolvePath(String rel) {
        if (rel == null || rel.isEmpty() || rel.equals("/")) return rootDir;
        return new File(rootDir, rel);
    }

    private String getRelativePath(File file) {
        String rootPath = rootDir.getAbsolutePath();
        String filePath = file.getAbsolutePath();
        if (filePath.startsWith(rootPath)) {
            String sub = filePath.substring(rootPath.length()).replace('\\', '/');
            return sub.startsWith("/") ? sub.substring(1) : sub;
        }
        return file.getName();
    }

    private String getFileType(File f) {
        if (f.isDirectory()) return "folder";
        String name = f.getName().toLowerCase();
        if (name.endsWith(".mp4") || name.endsWith(".mkv") || name.endsWith(".webm") || name.endsWith(".avi") || name.endsWith(".mov")) return "video";
        if (name.endsWith(".mp3") || name.endsWith(".wav") || name.endsWith(".ogg") || name.endsWith(".m4a") || name.endsWith(".flac")) return "audio";
        if (name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png") || name.endsWith(".webp") || name.endsWith(".gif")) return "image";
        if (name.endsWith(".pdf")) return "pdf";
        if (name.endsWith(".txt") || name.endsWith(".json") || name.endsWith(".py") || name.endsWith(".log") || name.endsWith(".md") || name.endsWith(".js") || name.endsWith(".html") || name.endsWith(".css")) return "code";
        if (name.endsWith(".zip") || name.endsWith(".tar") || name.endsWith(".rar") || name.endsWith(".7z")) return "archive";
        return "file";
    }

    private String getMimeType(String name) {
        String ext = MimeTypeMap.getFileExtensionFromUrl(name);
        if (ext != null) {
            String type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.toLowerCase());
            if (type != null) return type;
        }
        if (name.endsWith(".js")) return "application/javascript";
        if (name.endsWith(".css")) return "text/css";
        if (name.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    private void sendJson(OutputStream out, int code, String json) throws IOException {
        byte[] bytes = json.getBytes("UTF-8");
        String header = "HTTP/1.1 " + code + " OK\r\n" +
                "Content-Type: application/json; charset=utf-8\r\n" +
                "Content-Length: " + bytes.length + "\r\n\r\n";
        out.write(header.getBytes());
        out.write(bytes);
    }

    private void sendNotFound(OutputStream out) {
        try {
            String res = "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: 9\r\n\r\nNot Found";
            out.write(res.getBytes());
        } catch (IOException ignored) {}
    }

    private Map<String, String> parseQueryParams(String uri) {
        Map<String, String> map = new HashMap<>();
        if (!uri.contains("?")) return map;
        String query = uri.substring(uri.indexOf("?") + 1);
        String[] pairs = query.split("&");
        for (String pair : pairs) {
            int idx = pair.indexOf("=");
            if (idx > 0) {
                try {
                    map.put(URLDecoder.decode(pair.substring(0, idx), "UTF-8"),
                            URLDecoder.decode(pair.substring(idx + 1), "UTF-8"));
                } catch (Exception ignored) {}
            }
        }
        return map;
    }
}
