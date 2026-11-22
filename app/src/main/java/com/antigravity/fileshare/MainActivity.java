package com.antigravity.fileshare;

import android.Manifest;
import android.animation.ObjectAnimator;
import android.animation.PropertyValuesHolder;
import android.animation.ValueAnimator;
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
import android.widget.FrameLayout;
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

    private FrameLayout btnToggleServer;
    private ImageView ivHeroIcon;
    private View viewHeroHalo;
    private TextView tvHeroTitle;
    private TextView tvToggleHint;
    private TextView tvStatusBadge;
    private TextView tvNetworkInfo;
    private LinearLayout layoutServerInfo;
    private LinearLayout layoutOfflineFeatures;
    private TextView tvServerUrl;
    private ImageView ivQrCode;
    private View btnCopyUrl;
    private View btnOpenWeb;
    private View btnShareUrl;

    private boolean isServerRunning = false;
    private String currentServerUrl = "";
    private ObjectAnimator haloPulseAnimator;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        initViews();
        refreshNetworkInfo();
        checkAndRequestStoragePermissions();
        setupListeners();
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshNetworkInfo();
    }

    private void initViews() {
        btnToggleServer = findViewById(R.id.btn_toggle_server);
        ivHeroIcon = findViewById(R.id.iv_hero_icon);
        viewHeroHalo = findViewById(R.id.view_hero_halo);
        tvHeroTitle = findViewById(R.id.tv_hero_title);
        tvToggleHint = findViewById(R.id.tv_toggle_hint);
        tvStatusBadge = findViewById(R.id.tv_status_badge);
        tvNetworkInfo = findViewById(R.id.tv_network_info);
        layoutServerInfo = findViewById(R.id.layout_server_info);
        layoutOfflineFeatures = findViewById(R.id.layout_offline_features);
        tvServerUrl = findViewById(R.id.tv_server_url);
        ivQrCode = findViewById(R.id.iv_qr_code);
        btnCopyUrl = findViewById(R.id.btn_copy_url);
        btnOpenWeb = findViewById(R.id.btn_open_web);
        btnShareUrl = findViewById(R.id.btn_share_url);
    }

    private void refreshNetworkInfo() {
        String ip = NetworkUtils.getLocalIpAddress();
        if ("127.0.0.1".equals(ip)) {
            tvNetworkInfo.setText("Connect phone to Wi-Fi or Hotspot");
        } else {
            tvNetworkInfo.setText("Local Wi-Fi IP: " + ip);
        }
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

        btnShareUrl.setOnClickListener(v -> {
            if (!currentServerUrl.isEmpty()) {
                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType("text/plain");
                shareIntent.putExtra(Intent.EXTRA_SUBJECT, "FileShare Connection Link");
                shareIntent.putExtra(Intent.EXTRA_TEXT, "Open files on my phone using this link:\n" + currentServerUrl);
                startActivity(Intent.createChooser(shareIntent, "Share FileShare Link via"));
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
            btnToggleServer.setBackgroundResource(R.drawable.bg_hero_button_online);
            ivHeroIcon.setImageResource(R.drawable.ic_stop_symbol);
            viewHeroHalo.setBackgroundResource(R.drawable.bg_hero_halo_online);

            tvHeroTitle.setText("Sharing Active");
            tvToggleHint.setText("Tap above to stop server • Active on Wi-Fi");

            tvStatusBadge.setText("🟢 LIVE");
            tvStatusBadge.setTextColor(ContextCompat.getColor(this, R.color.status_green));
            tvStatusBadge.setBackgroundResource(R.drawable.bg_status_badge_online);

            tvServerUrl.setText(currentServerUrl);
            layoutServerInfo.setVisibility(View.VISIBLE);
            layoutOfflineFeatures.setVisibility(View.GONE);

            // Generate high-resolution QR code (400x400)
            Bitmap qr = NetworkUtils.generateQrBitmap(currentServerUrl, 400, 400);
            ivQrCode.setImageBitmap(qr);

            startHaloPulse();
        } else {
            btnToggleServer.setBackgroundResource(R.drawable.bg_hero_button_offline);
            ivHeroIcon.setImageResource(R.drawable.ic_power_symbol);
            viewHeroHalo.setBackgroundResource(R.drawable.bg_hero_halo);

            tvHeroTitle.setText("Start File Sharing");
            tvToggleHint.setText("Tap above to make your phone discoverable");

            tvStatusBadge.setText("⚪ IDLE");
            tvStatusBadge.setTextColor(ContextCompat.getColor(this, R.color.text_muted));
            tvStatusBadge.setBackgroundResource(R.drawable.bg_status_badge_offline);

            layoutServerInfo.setVisibility(View.GONE);
            layoutOfflineFeatures.setVisibility(View.VISIBLE);

            stopHaloPulse();
        }
    }

    private void startHaloPulse() {
        stopHaloPulse();
        PropertyValuesHolder scaleX = PropertyValuesHolder.ofFloat(View.SCALE_X, 1.0f, 1.10f);
        PropertyValuesHolder scaleY = PropertyValuesHolder.ofFloat(View.SCALE_Y, 1.0f, 1.10f);
        PropertyValuesHolder alpha = PropertyValuesHolder.ofFloat(View.ALPHA, 0.9f, 0.35f);

        haloPulseAnimator = ObjectAnimator.ofPropertyValuesHolder(viewHeroHalo, scaleX, scaleY, alpha);
        haloPulseAnimator.setDuration(1200);
        haloPulseAnimator.setRepeatCount(ValueAnimator.INFINITE);
        haloPulseAnimator.setRepeatMode(ValueAnimator.REVERSE);
        haloPulseAnimator.start();
    }

    private void stopHaloPulse() {
        if (haloPulseAnimator != null) {
            haloPulseAnimator.cancel();
            haloPulseAnimator = null;
        }
        viewHeroHalo.setScaleX(1.0f);
        viewHeroHalo.setScaleY(1.0f);
        viewHeroHalo.setAlpha(1.0f);
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

    @Override
    protected void onDestroy() {
        stopHaloPulse();
        super.onDestroy();
    }
}
