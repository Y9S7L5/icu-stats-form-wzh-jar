/**
 * 归档表单配置（唯一事实来源）。
 *
 * 在此清单内的表单会显示「归档」按钮（表单工具栏 + 打印中心批量归档）。
 * 不在清单内的表单不显示归档按钮 —— 新增/停用归档只改本文件即可。
 *
 * 明确排除（不配置即无按钮）：
 *   - transfusionForm      输血记录单（第三方输血系统调阅）
 *   - bedsideRiskCardForm  床头卡
 *   - handoverReport       病室交班报告
 *   - bloodSugar / temperatureRecord  第三方调阅页（无本地打印内容）
 *   - printCenter / getIcuForm        工具页与调阅容器
 *
 * source 说明：
 *   - html   前端采集页面打印 HTML → 后端 headless Chrome 转 PDF（默认）
 *   - hljld  前端不产 HTML，后端直接用 iText 生成护理记录单 PDF（PRINT_ALL）
 *
 * orientation 必须与组件自身 @page 声明一致。
 */

export type ArchiveSource = 'html' | 'hljld';
export type ArchiveOrientation = 'landscape' | 'portrait';

export interface ArchivableFormDef {
  /** 表单键，与路由/PRINT_FORMS.key/后端 availability key 一致 */
  key: string;
  /** 归档记录中显示的表单名称 */
  title: string;
  /** 纸张方向 */
  orientation: ArchiveOrientation;
  /** PDF 生成方式 */
  source: ArchiveSource;
}

export const ARCHIVABLE_FORMS: ArchivableFormDef[] = [
  /* ── 风险与评分 ── */
  { key: 'patientFallDangerForm', title: '跌倒/坠床风险评估及预防措施记录单', orientation: 'landscape', source: 'html' },
  { key: 'bradenForm', title: '住院患者压力性损伤评估及措施记录单（Braden）', orientation: 'landscape', source: 'html' },
  { key: 'unPlannedCGZYYForm', title: '非计划拔管风险评估及护理措施记录单', orientation: 'landscape', source: 'html' },
  { key: 'baetheiForm', title: '住院患者日常生活能力评估单（Barthel）', orientation: 'landscape', source: 'html' },
  { key: 'IADForm', title: '失禁相关性皮炎（IAD）评估记录单', orientation: 'landscape', source: 'html' },
  { key: 'toleranceForm', title: '肠内营养耐受性评分表', orientation: 'landscape', source: 'html' },
  { key: 'commitSuicideForm', title: '自杀风险评估表（NGASR）', orientation: 'landscape', source: 'html' },

  /* ── 专科治疗 ── */
  { key: 'ecmoForm', title: 'ECMO 运行护理记录单', orientation: 'portrait', source: 'html' },
  { key: 'crrtForm', title: 'CRRT 护理记录单', orientation: 'portrait', source: 'html' },
  { key: 'crrtOrderForm', title: 'CRRT 治疗医嘱单', orientation: 'portrait', source: 'html' },
  { key: 'piccoForm', title: 'PiCCO 监测记录单', orientation: 'portrait', source: 'html' },
  { key: 'hlmbForm', title: '重症患者护理目标管理', orientation: 'portrait', source: 'html' },
  { key: 'iabpForm', title: 'IABP 护理记录单', orientation: 'portrait', source: 'html' },
  { key: 'ydwzlForm', title: '亚低温治疗体温记录单', orientation: 'landscape', source: 'html' },

  /* ── 护理记录 ── */
  { key: 'jkjyForm', title: '健康教育记录单', orientation: 'portrait', source: 'html' },
  { key: 'wpgmForm', title: '住院患者物品管理表', orientation: 'portrait', source: 'html' },
  { key: 'sggrfkcsForm', title: '三管感染防控护理记录单', orientation: 'landscape', source: 'html' },

  /* ── 护理记录单（后端 iText 直接出 PDF） ── */
  { key: 'hljldFormPDFNew', title: '重症医学科护理记录单', orientation: 'landscape', source: 'hljld' },
  // { key: 'hljldFormPDF', title: '护理记录单（旧版）', orientation: 'landscape', source: 'hljld' },
];

const BY_KEY = new Map<string, ArchivableFormDef>(ARCHIVABLE_FORMS.map(def => [def.key, def]));

/** 该表单是否配置了归档按钮 */
export function isArchivable(formKey: string): boolean {
  return BY_KEY.has(formKey);
}

/** 取归档配置；未配置返回 undefined */
export function getArchivable(formKey: string): ArchivableFormDef | undefined {
  return BY_KEY.get(formKey);
}
