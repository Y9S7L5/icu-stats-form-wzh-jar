package com.smartcare.backend.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * headless Chrome 打印 HTML → PDF。
 *
 * <p>配置：
 * <ul>
 *   <li>{@code icu.archive.chrome-path} —— 浏览器可执行文件路径，默认取 PATH 上的
 *       chrome-headless-shell；麒麟V11 离线环境为 /usr/local/bin/chrome-headless-archive</li>
 *   <li>{@code icu.archive.render-timeout-seconds} —— 单次渲染超时，默认 60s</li>
 * </ul>
 *
 * <p>页面方向由 HTML 内的 {@code @page { size: A4 landscape/portrait }} 决定，
 * 浏览器参数只负责输出 PDF；{@code --no-pdf-header-footer} 去掉页眉页脚网址。</p>
 */
@Component
public class HeadlessPdfRenderer {
    private static final Logger log = LoggerFactory.getLogger(HeadlessPdfRenderer.class);

    @Value("${icu.archive.chrome-path:chrome-headless-shell}")
    private String chromePath;

    @Value("${icu.archive.render-timeout-seconds:60}")
    private long timeoutSeconds;

    /**
     * 渲染自包含打印文档为 PDF。
     *
     * @param html 完整 HTML 文档（含 @page 分页样式）
     * @return PDF 字节
     */
    public byte[] render(String html) throws IOException, InterruptedException {
        if (html == null || html.trim().isEmpty()) {
            throw new IllegalArgumentException("html 为空，无法渲染 PDF");
        }
        Path tmpHtml = Files.createTempFile("icu-archive-", ".html");
        Path tmpPdf = Files.createTempFile("icu-archive-", ".pdf");
        Path tmpLog = Files.createTempFile("icu-archive-chrome-", ".log");
        try {
            Files.write(tmpHtml, html.getBytes(StandardCharsets.UTF_8));

            List<String> cmd = new ArrayList<>();
            cmd.add(chromePath);
            cmd.add("--headless");
            cmd.add("--disable-gpu");
            // 内网服务器常以 root 运行，禁用沙箱避免启动失败（仅归档渲染用途）
            cmd.add("--no-sandbox");
            cmd.add("--disable-dev-shm-usage");
            cmd.add("--no-pdf-header-footer");      // 新版参数：不打印页眉页脚
            cmd.add("--print-to-pdf-no-header");    // 旧版参数兜底，未知参数浏览器自动忽略
            cmd.add("--virtual-time-budget=10000"); // 等字体与布局稳定
            cmd.add("--print-to-pdf=" + tmpPdf.toAbsolutePath());
            cmd.add(tmpHtml.toUri().toString());

            log.info("[Archive] chrome render: {} (timeout {}s)", chromePath, timeoutSeconds);
            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.redirectErrorStream(true);
            // 输出重定向到文件：避免子进程写满管道缓冲区而阻塞，也保证超时可控
            pb.redirectOutput(tmpLog.toFile());
            Process process = pb.start();

            boolean finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                throw new IOException("PDF 渲染超时（" + timeoutSeconds + "s），请检查 icu.archive.chrome-path 配置");
            }
            if (!Files.exists(tmpPdf) || Files.size(tmpPdf) == 0) {
                String detail = readTail(tmpLog);
                throw new IOException("PDF 渲染失败（exit=" + process.exitValue() + "）"
                        + (detail.isEmpty() ? "" : "：" + detail));
            }
            return Files.readAllBytes(tmpPdf);
        } finally {
            deleteQuietly(tmpHtml);
            deleteQuietly(tmpPdf);
            deleteQuietly(tmpLog);
        }
    }

    /**
     * 尽力删除临时文件。Windows 上进程刚退出时句柄可能尚未释放，
     * 短暂重试后仍失败则忽略——临时目录由系统回收，不能影响归档结果。
     */
    private void deleteQuietly(Path file) {
        for (int i = 0; i < 3; i++) {
            try {
                Files.deleteIfExists(file);
                return;
            } catch (IOException e) {
                try {
                    Thread.sleep(100);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
        log.debug("[Archive] 临时文件清理失败（忽略）: {}", file);
    }

    /** 读取渲染日志末尾（截断到 500 字符），用于错误提示 */
    private String readTail(Path logFile) {
        try {
            String text = new String(Files.readAllBytes(logFile), StandardCharsets.UTF_8).trim();
            return text.length() > 500 ? text.substring(text.length() - 500) : text;
        } catch (IOException ignore) {
            return "";
        }
    }
}
