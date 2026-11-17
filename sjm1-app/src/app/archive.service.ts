import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  ArchivableFormDef, ArchiveOrientation, getArchivable,
} from './archive.registry';
import { getSmartCarePatientPid } from './models/smartcare-host-message.model';
import { HostPatientService } from './services/host-patient.service';

/** 归档接口返回（契约以后端实现为准，字段缺失时前端做兜底） */
export interface ArchiveResult {
  archiveId?: string;
  version?: number;
  status?: string;
  filePath?: string;
  pageCount?: number;
  message?: string;
}

export interface ArchiveCreateRequest {
  pid: string;
  mrn?: string;
  hospitalNumber?: string;
  patientName?: string;
  admissionTime?: string;
  formKey: string;
  formTitle: string;
  orientation: ArchiveOrientation;
  /** html = 前端送打印 HTML；hljld = 后端自行生成 PDF */
  source: 'html' | 'hljld';
  /** source=html 时的完整打印文档 */
  html?: string;
  /** source=hljld 时的归档范围（护理记录单默认全量） */
  scope?: 'ALL' | 'DAY';
  /** source=hljld 且 scope=DAY 时的日期 yyyy-MM-dd */
  period?: string;
  archivedBy?: string;
  archivedByName?: string;
  archivedAt?: string;
}

/**
 * 无纸化归档服务（阶段一：仅保存归档）。
 *
 * 点击归档后的逻辑：
 *   1. 采集当前页面（或打印中心已渲染）的 .sheet 打印 HTML + 文档样式
 *   2. 组装患者快照与操作者元数据
 *   3. POST /api/v1/icu/archives —— 后端 headless Chrome 转 PDF 落盘 + 写 form_archive
 *      （护理记录单 source=hljld，后端直接用 iText 生成）
 *   4. 返回 archiveId/version，按钮展示归档结果
 *
 * 重新归档 = 再次 POST，后端生成新版本并将旧版本置为 superseded。
 */
@Injectable({ providedIn: 'root' })
export class ArchiveService {
  private readonly API = '/api/v1/icu/archives';

  constructor(
    private readonly http: HttpClient,
    private readonly hostPatient: HostPatientService,
  ) {}

  /* ============================ 对外入口 ============================ */

  /** 归档当前打开的表单页（采集页面 .sheet） */
  async archivePage(formKey: string): Promise<ArchiveResult> {
    const def = this.requireDef(formKey);
    const req = this.buildMeta(def);
    if (def.source === 'hljld') {
      req.source = 'hljld';
      req.scope = 'ALL';
      return this.post(req);
    }
    const sheets = harvestPageSheets();
    if (!sheets.length) {
      throw new Error('未找到可归档的表单内容，请先加载数据');
    }
    req.source = 'html';
    req.html = buildArchiveHtml(sheets, def.orientation, collectDocumentStyles(), def.title);
    return this.post(req);
  }

  /**
   * 归档打印中心已渲染的 sheets（批量用）。
   * @param sheets     预检阶段 harvest 到的 .sheet outerHTML 列表
   * @param scopedStyles 打印中心离屏容器中提取的 scoped 样式
   */
  async archiveSheets(
    formKey: string,
    sheets: string[],
    scopedStyles: string,
  ): Promise<ArchiveResult> {
    const def = this.requireDef(formKey);
    const req = this.buildMeta(def);
    if (def.source === 'hljld') {
      req.source = 'hljld';
      req.scope = 'ALL';
      return this.post(req);
    }
    if (!sheets.length) {
      throw new Error('未渲染出可归档内容');
    }
    req.source = 'html';
    req.html = buildArchiveHtml(sheets, def.orientation, scopedStyles, def.title);
    return this.post(req);
  }

  /* ============================ 内部 ============================ */

  private requireDef(formKey: string): ArchivableFormDef {
    const def = getArchivable(formKey);
    if (!def) {
      throw new Error(`表单 ${formKey} 未配置归档（archive.registry.ts）`);
    }
    return def;
  }

  private buildMeta(def: ArchivableFormDef): ArchiveCreateRequest {
    const p = this.hostPatient.getPatient() || {};
    const acc = this.hostPatient.getAccount() || {};
    return {
      pid: getSmartCarePatientPid(p),
      mrn: String(p.mrn ?? p.hospitalNo ?? '').trim(),
      hospitalNumber: String(p.hospitalNo ?? p.admissionNo ?? p.visitId ?? p.mrn ?? '').trim(),
      patientName: String(p.name ?? p.patientName ?? '').trim(),
      admissionTime: String(p.admissionTime ?? p.icuAdmissionTime ?? p.inTime ?? '').trim(),
      formKey: def.key,
      formTitle: def.title,
      orientation: def.orientation,
      source: def.source === 'hljld' ? 'hljld' : 'html',
      archivedBy: String(acc.username ?? acc.id ?? '').trim(),
      archivedByName: String(acc.trueName ?? acc.username ?? '').trim(),
      archivedAt: new Date().toISOString(),
    };
  }

  private async post(req: ArchiveCreateRequest): Promise<ArchiveResult> {
    try {
      return await firstValueFrom(this.http.post<ArchiveResult>(this.API, req));
    } catch (error: any) {
      const status = error?.status;
      const msg = error?.error?.message || error?.error?.error || error?.message;
      if (status === 404) {
        throw new Error('归档接口未部署（/api/v1/icu/archives）');
      }
      throw new Error(msg || `归档失败（HTTP ${status ?? '网络错误'}）`);
    }
  }
}

/* ============================ HTML 组装 ============================ */

/**
 * 采集当前文档中全部 .sheet（含未勾选打印页），克隆后去掉界面元素并固化控件值。
 * 归档是整表快照，不跟随打印页码勾选。
 */
function harvestPageSheets(): string[] {
  const sources = Array.from(document.querySelectorAll<HTMLElement>('.sheet'));
  return sources.map(source => {
    const clone = source.cloneNode(true) as HTMLElement;
    clone.classList.remove('sheet-hidden', 'print-hidden');
    clone.style.zoom = '1';
    clone.style.transform = 'none';
    clone.style.margin = '0';
    clone.style.boxShadow = 'none';
    clone.querySelectorAll('.no-print, .toolbar').forEach(node => node.remove());
    freezeControls(source, clone);
    return clone.outerHTML;
  });
}

/** 把表单控件的运行时值固化到 clone 上，否则归档稿会丢失勾选与手填内容 */
function freezeControls(source: HTMLElement, clone: HTMLElement): void {
  const selector = 'input, textarea, select';
  const from = Array.from(source.querySelectorAll<HTMLElement>(selector));
  const to = Array.from(clone.querySelectorAll<HTMLElement>(selector));
  from.forEach((origin, index) => {
    const target = to[index];
    if (!target) { return; }
    if (origin instanceof HTMLInputElement && target instanceof HTMLInputElement) {
      if (origin.type === 'checkbox' || origin.type === 'radio') {
        if (origin.checked) { target.setAttribute('checked', 'checked'); }
        else { target.removeAttribute('checked'); }
      } else {
        target.setAttribute('value', origin.value ?? '');
      }
    } else if (origin instanceof HTMLTextAreaElement && target instanceof HTMLTextAreaElement) {
      target.textContent = origin.value ?? '';
    } else if (origin instanceof HTMLSelectElement && target instanceof HTMLSelectElement) {
      Array.from(target.options).forEach((option, i) => {
        if (i === origin.selectedIndex) { option.setAttribute('selected', 'selected'); }
        else { option.removeAttribute('selected'); }
      });
    }
  });
}

/** 收集当前文档全部样式表（style 标签 + 同源 link），供后端 Chrome 离线渲染 */
function collectDocumentStyles(): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = (sheet as CSSStyleSheet).cssRules;
      for (const rule of Array.from(rules)) {
        const text = rule.cssText;
        if (text && !seen.has(text)) {
          seen.add(text);
          parts.push(text);
        }
      }
    } catch {
      // 跨域样式表读不到规则，忽略（本项目静态资源同源，正常不会走到）
    }
  }
  return parts.join('\n');
}

/** 打印覆盖样式：按方向强制 A4 分页与 sheet 尺寸 */
function overrideCss(orientation: ArchiveOrientation): string {
  const width = orientation === 'landscape' ? '297mm' : '210mm';
  const minHeight = orientation === 'landscape' ? '210mm' : '297mm';
  return `
    @page { size: A4 ${orientation}; margin: 0; }
    html, body { margin:0; padding:0; background:#fff;
                 color:#000; font-family:'SimSun','宋体',serif; }
    .no-print, .toolbar { display:none !important; }
    .print-page { box-sizing:border-box; width:${width}; min-height:${minHeight}; margin:0;
                  break-after:page; page-break-after:always; background:#fff; }
    .print-page:last-child { break-after:auto; page-break-after:auto; }
    .print-page > .sheet { box-sizing:border-box; width:${width} !important;
                  min-height:${minHeight} !important; max-width:${width} !important;
                  margin:0 !important; box-shadow:none !important;
                  transform:none !important; zoom:1 !important; filter:none !important; }
    .sheet-hidden, .print-hidden { display:block !important; }
  `;
}

/** 组装自包含打印文档（后端 headless Chrome 直接吃这个 HTML） */
export function buildArchiveHtml(
  sheets: string[],
  orientation: ArchiveOrientation,
  scopedStyles: string,
  title: string,
): string {
  const body = sheets
    .map((html, index) => `<div class="print-page" data-page-index="${index + 1}">${html}</div>`)
    .join('');
  const safeTitle = (title || '归档').replace(/[<>&"]/g, '');
  return (
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    `<title>${safeTitle}</title>` +
    `<style>${overrideCss(orientation)}</style>` +
    (scopedStyles ? `<style>${scopedStyles}</style>` : '') +
    `</head><body>${body}</body></html>`
  );
}
