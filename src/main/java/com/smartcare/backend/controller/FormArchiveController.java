package com.smartcare.backend.controller;

import com.smartcare.backend.dto.ArchiveCreateRequest;
import com.smartcare.backend.dto.ArchiveCreateResponse;
import com.smartcare.backend.entity.FormArchive;
import com.smartcare.backend.service.FormArchiveService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 无纸化归档接口（阶段一：仅保存归档）。
 *
 * <ul>
 *   <li>POST /api/v1/icu/archives —— 创建/重新归档（前端归档按钮统一入口）</li>
 *   <li>GET  /api/v1/icu/archives?pid=&amp;formKey= —— 查询归档记录（核对/后续回传用）</li>
 * </ul>
 *
 * 错误约定：参数错误返回 400 {"message":"..."}，渲染等内部错误由全局异常处理返回 500；
 * 前端 archive.service.ts 会把 message 展示在归档按钮上。
 */
@RestController
@RequestMapping("/api/v1/icu/archives")
@CrossOrigin(origins = "*")
public class FormArchiveController {

    private static final Logger log = LoggerFactory.getLogger(FormArchiveController.class);

    private final FormArchiveService service;

    public FormArchiveController(FormArchiveService service) {
        this.service = service;
    }

    @PostMapping
    public ResponseEntity<?> create(@RequestBody ArchiveCreateRequest req) {
        try {
            ArchiveCreateResponse res = service.create(req);
            return ResponseEntity.ok(res);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(message(e.getMessage()));
        } catch (RuntimeException | IOException e) {
            // iText/Chrome 渲染等业务可读异常 → 422，前端直接展示 message
            log.warn("[Archive] create failed: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(message(e.getMessage()));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                    .body(message("归档渲染被中断"));
        }
    }

    /** 查询归档记录：GET /api/v1/icu/archives?pid=xxx[&formKey=xxx] */
    @GetMapping
    public ResponseEntity<?> list(@RequestParam String pid,
                                  @RequestParam(required = false) String formKey) {
        if (pid == null || pid.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(message("缺少 pid"));
        }
        List<FormArchive> items = service.list(pid, formKey);
        return ResponseEntity.ok(items);
    }

    private Map<String, String> message(String text) {
        Map<String, String> body = new LinkedHashMap<>();
        body.put("message", text == null ? "归档失败" : text);
        return body;
    }
}
