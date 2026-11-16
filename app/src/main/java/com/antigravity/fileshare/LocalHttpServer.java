package com.antigravity.fileshare;

import android.content.Context;
import android.os.Environment;
import android.webkit.MimeTypeMap;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.*;
import java.net.*;
import java.util.*;
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

    public LocalHttpServer(Context context, int port, File rootDir) {
        this.context = context;
        this.port = port;
        this.rootDir = (rootDir != null && rootDir.exists()) ? rootDir : Environment.getExternalStorageDirectory();
    }

    public synchronized void start() throws IOException {
        if (isRunning) return;
        serverSocket = new ServerSocket(port);
        isRunning = true;

        threadPool.execute(() -> {
            while (isRunning) {
                try {
                    Socket socket = serverSocket.accept();
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

    public int getClientCount() {
        return connectedClients.size();
    }

    private void handleClient(Socket socket) {
        try (InputStream in = socket.getInputStream();
             OutputStream out = socket.getOutputStream()) {

            BufferedReader reader = new BufferedReader(new InputStreamReader(in));
            String line = reader.readLine();
            if (line == null || line.trim().isEmpty()) return;

            String[] tokens = line.split(" ");
            if (tokens.length < 2) return;

            String method = tokens[0];
            String fullUri = tokens[1];
            String path = fullUri.contains("?") ? fullUri.substring(0, fullUri.indexOf("?")) : fullUri;
            Map<String, String> queryParams = parseQueryParams(fullUri);

            // Read request headers
            Map<String, String> headers = new HashMap<>();
            String headerLine;
            while ((headerLine = reader.readLine()) != null && !headerLine.isEmpty()) {
                int colon = headerLine.indexOf(':');
                if (colon > 0) {
                    headers.put(headerLine.substring(0, colon).trim().toLowerCase(), headerLine.substring(colon + 1).trim());
                }
            }

            // Route handler
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

    private void handleBrowse(OutputStream out, String relPath) throws Exception {
        File target = resolvePath(relPath);
        if (!target.exists() || !target.isDirectory()) {
            sendJson(out, 404, "{\"error\":\"Directory not found\"}");
            return;
        }

        File[] files = target.listFiles();
        JSONArray items = new JSONArray();

        if (files != null) {
            for (File f : files) {
                if (f.getName().startsWith(".")) continue; // hide hidden files
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

        // Breadcrumbs
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
            // HTTP 206 Partial Content (Range request for video/audio seek)
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
            // Full file transfer
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
        try (InputStream is = context.getAssets().open(assetPath)) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] data = new byte[16384];
            int n;
            while ((n = is.read(data, 0, data.length)) != -1) {
                buffer.write(data, 0, n);
            }
            byte[] bytes = buffer.toByteArray();

            String header = "HTTP/1.1 200 OK\r\n" +
                    "Content-Type: " + mime + "\r\n" +
                    "Content-Length: " + bytes.length + "\r\n" +
                    "Cache-Control: max-age=3600\r\n\r\n";
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
        if (name.endsWith(".txt") || name.endsWith(".json") || name.endsWith(".py") || name.endsWith(".log") || name.endsWith(".md")) return "code";
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
