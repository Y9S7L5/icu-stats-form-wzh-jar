package com.smartcare.backend.entity;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/**
 * 无纸化归档记录 —— PDF 文件与数据库的映射。
 *
 * <p>PDF 落盘于 {icu.archive.root}/{pid}/{formKey}/{yyyyMMdd}/{archiveId}.pdf，
 * 本集合保存映射与患者/表单元数据快照，供后续回传无纸化系统时识别文件。
 * 重新归档生成新版本（version+1），旧版本置为 superseded，文件不删除。</p>
 */
@Data
@Document(collection = "form_archive")
@CompoundIndex(name = "idx_form_archive_pid_form_version",
               def = "{'pid':1,'formKey':1,'version':-1}")
public class FormArchive {
    @Id private String id;

    /* ---------- 患者快照（归档时刻，不随患者信息变更） ---------- */
    private String pid;
    private String mrn;
    private String hospitalNumber;
    private String patientName;
    private String admissionTime;

    /* ---------- 表单标识 ---------- */
    private String formKey;
    private String formTitle;
    /** landscape | portrait */
    private String orientation;
    /** html | hljld */
    private String source;
    /** ALL | DAY（hljld 单按护理日归档时用） */
    private String scope;
    /** scope=DAY 时的日期 yyyy-MM-dd */
    private String period;

    /* ---------- 文件映射 ---------- */
    /** 相对 icu.archive.root 的路径 */
    private String filePath;
    private Long fileSize;
    private String sha256;
    private Integer pageCount;

    /* ---------- 版本与状态 ---------- */
    private Integer version;
    /** active = 当前有效版本；superseded = 已被新版本取代 */
    private String status;

    /* ---------- 归档操作 ---------- */
    private String archivedBy;
    private String archivedByName;
    private Instant archivedAt;
}
