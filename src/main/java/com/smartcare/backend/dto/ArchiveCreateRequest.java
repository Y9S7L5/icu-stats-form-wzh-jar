package com.smartcare.backend.dto;

import lombok.Data;

/**
 * 无纸化归档创建请求（与前端 archive.service.ts 的 ArchiveCreateRequest 契约一致）。
 *
 * <p>source=html 时携带完整打印 HTML，后端 headless Chrome 转 PDF；
 * source=hljld 时仅携带元数据，后端用 iText 生成护理记录单 PDF。</p>
 */
@Data
public class ArchiveCreateRequest {
    /** 患者ID（必填） */
    private String pid;
    /** 病案号/门诊号快照 */
    private String mrn;
    /** 住院号快照 */
    private String hospitalNumber;
    /** 患者姓名快照 */
    private String patientName;
    /** 入科时间快照 */
    private String admissionTime;

    /** 表单键（必填，如 bradenForm、hljldFormPDFNew） */
    private String formKey;
    /** 表单标题 */
    private String formTitle;
    /** 纸张方向 landscape | portrait */
    private String orientation;

    /** html = 前端送打印文档；hljld = 后端自行生成 */
    private String source;
    /** source=html 时的完整打印文档 */
    private String html;
    /** source=hljld 时的归档范围：ALL（默认，全量）| DAY（按护理日） */
    private String scope;
    /** scope=DAY 时的日期 yyyy-MM-dd */
    private String period;

    /** 归档操作者账号 */
    private String archivedBy;
    /** 归档操作者姓名 */
    private String archivedByName;
    /** 归档时间（ISO 字符串，缺省用服务端当前时间） */
    private String archivedAt;
}
