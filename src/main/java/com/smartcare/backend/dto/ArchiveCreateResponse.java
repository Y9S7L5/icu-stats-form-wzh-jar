package com.smartcare.backend.dto;

import lombok.Data;

/**
 * 无纸化归档创建响应（与前端 archive.service.ts 的 ArchiveResult 契约一致）。
 */
@Data
public class ArchiveCreateResponse {
    private String archiveId;
    /** 同一 pid+formKey 下的版本号，从 1 开始；重新归档递增 */
    private Integer version;
    /** active | superseded */
    private String status;
    /** 相对 icu.archive.root 的存储路径：{pid}/{formKey}/{yyyyMMdd}/{archiveId}.pdf */
    private String filePath;
    private Integer pageCount;
    private String message;
}
