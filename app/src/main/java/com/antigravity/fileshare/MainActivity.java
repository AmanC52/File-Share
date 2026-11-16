package com.antigravity.fileshare;

import android.Manifest;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends AppCompatActivity {

    private static final int PERMISSION_REQ_CODE = 2001;

    private Button btnToggleServer;
    private TextView tvStatusBadge;
    private TextView tvToggleHint;
    private LinearLayout layoutServerInfo;
    private TextView tvServerUrl;
    private ImageView ivQrCode;
    private Button btnCopyUrl;
    private Button btnOpenWeb;

    private boolean isServerRunning = false;
    private String currentServerUrl = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        initViews();
        checkAndRequestStoragePermissions();
        setupListeners();
    }

    private void initViews() {
        btnToggleServer = findViewById(R.id.btn_toggle_server);
        tvStatusBadge = findViewById(R.id.tv_status_badge);
        tvToggleHint = findViewById(R.id.tv_toggle_hint);
        layoutServerInfo = findViewById(R.id.layout_server_info);
        tvServerUrl = findViewById(R.id.tv_server_url);
        ivQrCode = findViewById(R.id.iv_qr_code);
        btnCopyUrl = findViewById(R.id.btn_copy_url);
        btnOpenWeb = findViewById(R.id.btn_open_web);
    }

    private void setupListeners() {
        btnToggleServer.setOnClickListener(v -> {
            if (!hasStoragePermission()) {
                requestStoragePermission();
                return;
            }

            if (isServerRunning) {
                stopServer();
            } else {
                startServer();
            }
        });

        btnCopyUrl.setOnClickListener(v -> {
            if (!currentServerUrl.isEmpty()) {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                ClipData clip = ClipData.newPlainText("FileShare URL", currentServerUrl);
                if (clipboard != null) {
                    clipboard.setPrimaryClip(clip);
                    Toast.makeText(this, "Copied link to clipboard!", Toast.LENGTH_SHORT).show();
                }
            }
        });

        btnOpenWeb.setOnClickListener(v -> {
            if (!currentServerUrl.isEmpty()) {
                Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(currentServerUrl));
                startActivity(browserIntent);
            }
        });
    }

    private void startServer() {
        String ip = NetworkUtils.getLocalIpAddress();
        currentServerUrl = "http://" + ip + ":8080";

        Intent serviceIntent = new Intent(this, FileServerService.class);
        serviceIntent.setAction(FileServerService.ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }

        isServerRunning = true;
        updateUI(true);
    }

    private void stopServer() {
        Intent serviceIntent = new Intent(this, FileServerService.class);
        serviceIntent.setAction(FileServerService.ACTION_STOP);
        startService(serviceIntent);

        isServerRunning = false;
        updateUI(false);
    }

    private void updateUI(boolean running) {
        if (running) {
            btnToggleServer.setText("STOP");
            btnToggleServer.setBackgroundResource(R.drawable.bg_power_button);
            tvStatusBadge.setText("ONLINE");
            tvStatusBadge.setTextColor(ContextCompat.getColor(this, R.color.status_green));
            tvToggleHint.setText("Server is actively running in background");

            tvServerUrl.setText(currentServerUrl);
            layoutServerInfo.setVisibility(View.VISIBLE);

            // Generate QR Code bitmap
            Bitmap qr = NetworkUtils.generateQrBitmap(currentServerUrl, 400, 400);
            ivQrCode.setImageBitmap(qr);
        } else {
            btnToggleServer.setText("START");
            tvStatusBadge.setText("OFFLINE");
            tvStatusBadge.setTextColor(ContextCompat.getColor(this, R.color.status_red));
            tvToggleHint.setText("Tap START to turn phone into Wi-Fi Server");
            layoutServerInfo.setVisibility(View.GONE);
        }
    }

    private boolean hasStoragePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        } else {
            return ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
        }
    }

    private void requestStoragePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                intent.addCategory("android.intent.category.DEFAULT");
                intent.setData(Uri.parse(String.format("package:%s", getApplicationContext().getPackageName())));
                startActivity(intent);
            } catch (Exception e) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                startActivity(intent);
            }
        } else {
            ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE},
                    PERMISSION_REQ_CODE);
        }
    }

    private void checkAndRequestStoragePermissions() {
        if (!hasStoragePermission()) {
            Toast.makeText(this, "Please grant storage access to share files", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQ_CODE && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "Storage access granted!", Toast.LENGTH_SHORT).show();
        }
    }
}
