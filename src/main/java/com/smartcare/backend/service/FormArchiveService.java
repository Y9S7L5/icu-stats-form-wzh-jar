package com.smartcare.backend.service;

import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.kernel.pdf.PdfReader;
import com.smartcare.backend.dto.ArchiveCreateRequest;
import com.smartcare.backend.dto.ArchiveCreateResponse;
import com.smartcare.backend.entity.FormArchive;
import com.smartcare.backend.repository.FormArchiveRepository;
import org.bson.types.ObjectId;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.List;

/**
 * 无纸化归档服务（阶段一：仅保存归档，回传同步为后续独立接口）。
 *
 * <p>流程：
 * <ol>
 *   <li>按 source 生成 PDF：html → headless Chrome；hljld → 后端 iText（全量/按护理日）</li>
 *   <li>落盘 {icu.archive.root}/{pid}/{formKey}/{yyyyMMdd}/{archiveId}.pdf</li>
 *   <li>写 form_archive 映射：版本号递增，旧 active 版本置为 superseded（文件保留）</li>
 * </ol>
 *
 * <p>配置：
 * <ul>
 *   <li>{@code icu.archive.root} —— 归档根目录，默认 ./archive（麒麟环境用 ARCHIVE_ROOT 指到数据盘）</li>
 *   <li>{@code icu.archive.chrome-path} —— headless 浏览器路径（source=html 时必配）</li>
 * </ul>
 */
@Service
public class FormArchiveService {
    private static final Logger log = LoggerFactory.getLogger(FormArchiveService.class);
    private static final DateTimeFormatter DAY_FMT = DateTimeFormatter.ofPattern("yyyyMMdd");

    private final FormArchiveRepository repository;
    private final HeadlessPdfRenderer renderer;
    private final HljldFlowPdfService hljldPdfService;          // /form/hljldFormPDF（旧版）
    private final HljldFlowPdfServiceNew hljldPdfServiceNew;    // /form/hljldFormPDFNew（新版）

    @Value("${icu.archive.root:./archive}")
    private Path archiveRoot;

    public FormArchiveService(FormArchiveRepository repository,
                              HeadlessPdfRenderer renderer,
                              HljldFlowPdfService hljldPdfService,
                              HljldFlowPdfServiceNew hljldPdfServiceNew) {
        this.repository = repository;
        this.renderer = renderer;
        this.hljldPdfService = hljldPdfService;
        this.hljldPdfServiceNew = hljldPdfServiceNew;
    }

    /* ============================ 创建归档 ============================ */

    /**
     * 创建（或重新创建）一份归档。同一 pid+formKey 重复调用生成新版本。
     * synchronized：同一患者同表单的版本递增不并发冲突（量级极低）。
     */
    public synchronized ArchiveCreateResponse create(ArchiveCreateRequest req)
            throws IOException, InterruptedException {
        validate(req);
        String pid = req.getPid().trim();
        String formKey = req.getFormKey().trim();
        String source = (req.getSource() == null || req.getSource().trim().isEmpty())
                ? "html" : req.getSource().trim();

        // 1. 生成 PDF
        byte[] pdf;
        if ("hljld".equals(source)) {
            pdf = renderHljld(req, pid);
        } else {
            pdf = renderer.render(req.getHtml());
        }

        // 2. 落盘
        String archiveId = new ObjectId().toHexString();
        String day = LocalDate.now().format(DAY_FMT);
        String relativePath = pid + "/" + formKey + "/" + day + "/" + archiveId + ".pdf";
        Path target = archiveRoot.resolve(relativePath);
        Files.createDirectories(target.getParent());
        Files.write(target, pdf);

        // 3+4. 写映射、旧版本置 superseded；任一步失败则删除刚落盘的文件，避免孤儿 PDF
        List<FormArchive> previous = repository.findByPidAndFormKeyOrderByVersionDesc(pid, formKey);
        int version = previous.isEmpty()
                ? 1
                : previous.get(0).getVersion() + 1;
        FormArchive doc = new FormArchive();
        doc.setId(archiveId);
        doc.setPid(pid);
        doc.setMrn(trim(req.getMrn()));
        doc.setHospitalNumber(trim(req.getHospitalNumber()));
        doc.setPatientName(trim(req.getPatientName()));
        doc.setAdmissionTime(trim(req.getAdmissionTime()));
        doc.setFormKey(formKey);
        doc.setFormTitle(trim(req.getFormTitle()));
        doc.setOrientation(trim(req.getOrientation()));
        doc.setSource(source);
        doc.setScope(trim(req.getScope()));
        doc.setPeriod(trim(req.getPeriod()));
        doc.setFilePath(relativePath);
        doc.setFileSize((long) pdf.length);
        doc.setSha256(sha256Hex(pdf));
        doc.setPageCount(countPages(pdf));
        doc.setVersion(version);
        doc.setStatus("active");
        doc.setArchivedBy(trim(req.getArchivedBy()));
        doc.setArchivedByName(trim(req.getArchivedByName()));
        doc.setArchivedAt(parseInstant(req.getArchivedAt()));

        try {
            // 先写新版本（保证“当前有效版本”始终存在），再翻旧版本状态
            repository.save(doc);

            for (FormArchive old : previous) {
                if (!"superseded".equals(old.getStatus())) {
                    old.setStatus("superseded");
                    repository.save(old);
                }
            }
        } catch (RuntimeException e) {
            try {
                Files.deleteIfExists(target);
            } catch (IOException ignore) {
                log.warn("[Archive] 回滚孤儿文件失败: {}", target);
            }
            throw e;
        }

        log.info("[Archive] created: pid={}, formKey={}, v{}, pages={}, file={}",
                pid, formKey, version, doc.getPageCount(), relativePath);

        ArchiveCreateResponse res = new ArchiveCreateResponse();
        res.setArchiveId(archiveId);
        res.setVersion(version);
        res.setStatus("active");
        res.setFilePath(relativePath);
        res.setPageCount(doc.getPageCount());
        res.setMessage("归档成功 v" + version);
        return res;
    }

    /* ============================ 查询（供核对/后续回传用） ============================ */

    public List<FormArchive> list(String pid, String formKey) {
        if (formKey != null && !formKey.trim().isEmpty()) {
            return repository.findByPidAndFormKeyOrderByVersionDesc(pid.trim(), formKey.trim());
        }
        return repository.findByPidOrderByArchivedAtDesc(pid.trim());
    }

    /* ============================ 内部 ============================ */

    private void validate(ArchiveCreateRequest req) {
        if (req == null) { throw new IllegalArgumentException("请求体为空"); }
        if (trim(req.getPid()).isEmpty()) { throw new IllegalArgumentException("缺少 pid"); }
        if (trim(req.getFormKey()).isEmpty()) { throw new IllegalArgumentException("缺少 formKey"); }
        String source = trim(req.getSource());
        if (source.isEmpty()) { source = "html"; }
        if (!"html".equals(source) && !"hljld".equals(source)) {
            throw new IllegalArgumentException("不支持的 source：" + source + "（仅支持 html / hljld）");
        }
        if ("html".equals(source) && (req.getHtml() == null || req.getHtml().trim().isEmpty())) {
            throw new IllegalArgumentException("source=html 时 html 不能为空");
        }
        if ("hljld".equals(source)) {
            String formKey = trim(req.getFormKey());
            if (!"hljldFormPDF".equals(formKey) && !"hljldFormPDFNew".equals(formKey)) {
                throw new IllegalArgumentException("source=hljld 仅支持护理记录单（hljldFormPDF / hljldFormPDFNew）");
            }
            if ("DAY".equalsIgnoreCase(trim(req.getScope())) && trim(req.getPeriod()).isEmpty()) {
                throw new IllegalArgumentException("scope=DAY 时 period（yyyy-MM-dd）不能为空");
            }
        }
    }

    /** 护理记录单：后端 iText 直接生成（不经过浏览器） */
    private byte[] renderHljld(ArchiveCreateRequest req, String pid) {
        boolean daily = "DAY".equalsIgnoreCase(trim(req.getScope()));
        boolean isNewForm = "hljldFormPDFNew".equals(trim(req.getFormKey()));
        if (daily) {
            String period = trim(req.getPeriod());
            try {
                LocalDate.parse(period, DateTimeFormatter.ISO_LOCAL_DATE);
            } catch (DateTimeParseException e) {
                throw new IllegalArgumentException("period 格式须为 yyyy-MM-dd：" + period);
            }
            log.info("[Archive] hljld DAY: pid={}, date={}, new={}", pid, period, isNewForm);
            return isNewForm
                    // 归档等同纸质打印：单日用 PRINT_DAY（备注/审核签名始终显示）
                    ? hljldPdfServiceNew.generateDailyPdf(pid, period, null,
                            com.smartcare.backend.hljld.HljldPdfRenderPurposeNew.PRINT_DAY)
                    : hljldPdfService.generateDailyPdf(pid, period, null);
        }
        log.info("[Archive] hljld ALL: pid={}, new={}", pid, isNewForm);
        return isNewForm
                ? hljldPdfServiceNew.generateAllPagesPdf(pid, null)
                : hljldPdfService.generateAllPagesPdf(pid, null);
    }

    /** iText 读取页数 */
    private int countPages(byte[] pdf) {
        try (PdfDocument doc = new PdfDocument(new PdfReader(new ByteArrayInputStream(pdf)))) {
            return doc.getNumberOfPages();
        } catch (IOException e) {
            log.warn("[Archive] 页数读取失败: {}", e.getMessage());
            return 0;
        }
    }

    private String sha256Hex(byte[] data) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(data);
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16))
                  .append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 不可用", e);
        }
    }

    private Instant parseInstant(String value) {
        String v = trim(value);
        if (!v.isEmpty()) {
            try {
                return Instant.parse(v);
            } catch (DateTimeParseException ignore) {
                // 前端传来非法时间时用服务端时间兜底
            }
        }
        return Instant.now();
    }

    private String trim(String v) { return v == null ? "" : v.trim(); }
}
