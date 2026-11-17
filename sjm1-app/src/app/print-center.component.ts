import {
  ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild, ViewContainerRef,
} from '@angular/core';
import { Subject } from 'rxjs';
import { distinctUntilChanged, filter, map, switchMap, takeUntil } from 'rxjs/operators';
import { HostPatientService } from './services/host-patient.service';
import { formatShanghaiDateMinute } from './form-date.util';
import { PrintCenterService } from './print-center.service';
import { ArchiveService } from './archive.service';
import { isArchivable } from './archive.registry';
import { PRINT_FORMS, PRINT_GROUP_NAMES, VIEW_ONLY_FORMS } from './print-center.registry';
import { PrintGroupKey, PrintGroupView, PrintRow } from './print-center.models';
import { firstDiagnosisSegment, resolveDiagnosisDisplay } from './diagnosis-history.util';
import { DiagnosisHistoryService } from './diagnosis-history.service';

@Component({
  standalone: false,
  selector: 'app-print-center',
  templateUrl: './print-center.component.html',
  styleUrls: ['./print-center.component.css'],
})
export class PrintCenterComponent implements OnInit, OnDestroy {
  /** 离屏渲染舞台 */
  @ViewChild('stageHost', { read: ViewContainerRef, static: true })
  stageHost!: ViewContainerRef;
  @ViewChild('stageWrap', { static: true })
  stageWrap!: ElementRef<HTMLElement>;

  readonly viewOnlyForms = VIEW_ONLY_FORMS;
  /** 批量归档仅覆盖 archive.registry.ts 配置的表单（输血记录单等打印表单不参与） */
  private readonly archiveDefs = PRINT_FORMS.filter(def => isArchivable(def.key));

  patient: any = null;
  pid = '';
  age: number | null = null;
  diagnosisDisplay = '';

  rows: PrintRow[] = [];
  showEmpty = false;
  scanning = false;
  scanError = '';

  archiving = false;
  progressText = '';
  finishedSummary = '';

  private cancelled = false;
  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly hostPatient: HostPatientService,
    private readonly service: PrintCenterService,
    private readonly cdr: ChangeDetectorRef,
    private readonly diagHistory: DiagnosisHistoryService,
    private readonly archive: ArchiveService,
  ) {
    this.rows = this.archiveDefs.map(def => ({
      def, selected: false, hasData: false, count: 0,
      estimatedPages: 0, renderedPages: 0, selectedPages: [],
      sheets: [], state: 'idle', errorText: '',
    }));
  }

  ngOnInit(): void {
    this.hostPatient.patient$.pipe(
      filter(Boolean),
      map(p => ({ p, pid: String((p as any).id ?? '').trim() })),
      filter(x => !!x.pid),
      distinctUntilChanged((a, b) => a.pid === b.pid),
      switchMap(({ p, pid }) => this.diagHistory.ensurePatient(p).pipe(map(ep => ({ p: ep, pid })))),
      takeUntil(this.destroy$),
    ).subscribe(({ p, pid }) => {
      this.patient = p;
      this.pid = pid;
      this.age = this.calcAge((p as any).birthday);
      // 打印中心无数据行：queryTime = 当前时刻
      this.diagnosisDisplay = resolveDiagnosisDisplay(
        p, Date.now(), this.formatDiagnosis((p as any).clinicalDiagnosis));
      this.resetRows();
      this.refresh();
    });
  }

  ngOnDestroy(): void {
    this.cancelled = true;
    this.destroy$.next();
    this.destroy$.complete();
  }

  /* ------------------------------ 视图数据 ------------------------------ */

  get groups(): PrintGroupView[] {
    const keys: PrintGroupKey[] = ['tube', 'risk', 'therapy', 'nursing'];
    return keys
      .map(key => ({
        key,
        name: PRINT_GROUP_NAMES[key],
        rows: this.rows.filter(r => r.def.group === key && (this.showEmpty || r.hasData)),
      }))
      .filter(group => group.rows.length > 0);
  }

  get busy(): boolean { return this.scanning || this.archiving; }
  get selectedRows(): PrintRow[] { return this.rows.filter(r => r.selected && r.hasData); }
  get dataCount(): number { return this.rows.filter(r => r.hasData).length; }

  /** 所选行中配置了归档的表单（archive.registry.ts 白名单，输血记录单等被排除） */
  get archiveTargets(): PrintRow[] { return this.selectedRows.filter(r => isArchivable(r.def.key)); }
  get canArchive(): boolean { return !!this.pid && !this.busy && this.archiveTargets.length > 0; }

  groupSelectedCount(group: PrintGroupView): number {
    return group.rows.filter(r => r.selected).length;
  }
  groupDataCount(group: PrintGroupView): number {
    return group.rows.filter(r => r.hasData).length;
  }
  isGroupAllSelected(group: PrintGroupView): boolean {
    const selectable = group.rows.filter(r => r.hasData);
    return selectable.length > 0 && selectable.every(r => r.selected);
  }
  isGroupIndeterminate(group: PrintGroupView): boolean {
    const selectable = group.rows.filter(r => r.hasData);
    const picked = selectable.filter(r => r.selected).length;
    return picked > 0 && picked < selectable.length;
  }

  statusText(row: PrintRow): string {
    if (this.scanning) { return '检测中…'; }
    if (!row.hasData) { return '无数据'; }
    return `有数据 ${row.count} 条`;
  }
  latestText(row: PrintRow): string {
    return row.latestTime ? `最近 ${formatShanghaiDateMinute(row.latestTime)}` : '';
  }
  pageText(row: PrintRow): string {
    if (row.renderedPages > 0) { return `${row.renderedPages} 页`; }
    return row.estimatedPages > 0 ? `约 ${row.estimatedPages} 页` : '—';
  }

  /* ------------------------------ 交互 ------------------------------ */

  refresh(): void {
    if (!this.pid) { return; }
    this.scanning = true;
    this.scanError = '';
    this.finishedSummary = '';
    this.service.loadAvailability(this.pid, this.archiveDefs)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: table => {
          this.rows.forEach(row => {
            const item = table.get(row.def.key);
            row.hasData = !!item?.hasData;
            row.count = item?.count ?? 0;
            row.latestTime = item?.latestTime;
            row.estimatedPages = item?.estimatedPages ?? (row.hasData ? 1 : 0);
            row.selected = row.hasData;              // 默认勾选有数据的表单
            row.renderedPages = 0;
            row.selectedPages = [];
            row.sheets = [];
            row.state = 'idle';
            row.errorText = '';
          });
          this.scanning = false;
          this.cdr.detectChanges();
        },
        error: () => {
          this.scanning = false;
          this.scanError = '表单数据检测失败，请点击「重新检测」重试';
          this.cdr.detectChanges();
        },
      });
  }

  selectAllWithData(): void { this.rows.forEach(r => { if (r.hasData) { r.selected = true; } }); }
  clearSelection(): void { this.rows.forEach(r => { r.selected = false; }); }

  toggleGroup(group: PrintGroupView, checked: boolean): void {
    group.rows.forEach(row => { if (row.hasData) { row.selected = checked; } });
  }

  cancel(): void { this.cancelled = true; }

  /**
   * 批量归档：离屏渲染所选表单 → 逐表 POST /api/v1/icu/archives。
   * 归档是整表快照（不按打印页码勾选过滤）。
   */
  async startArchive(): Promise<void> {
    if (!this.canArchive) { return; }

    // 设置离屏舞台引用，用于提取 scoped 样式
    if (this.stageWrap) {
      this.service.setStageElement(this.stageWrap.nativeElement);
    }

    this.archiving = true;
    this.cancelled = false;
    this.finishedSummary = '';
    this.cdr.detectChanges();
    try {
      // 1. 渲染并采集（仅所选且配置了归档的表单）
      await this.service.collect(
        this.archiveTargets,
        this.stageHost,
        row => {
          this.progressText = `正在渲染：${row.def.title}`;
          this.cdr.detectChanges();
        },
        () => this.cancelled,
      );
      if (this.cancelled) {
        this.finishedSummary = '已取消归档。';
        return;
      }

      // 2. 逐表提交归档（共享同一份离屏 scoped 样式）
      const scopedStyles = this.service.collectScopedStyles();
      const ready = this.archiveTargets.filter(r => r.state === 'ready');
      let ok = 0;
      const failNames: string[] = [];
      for (let i = 0; i < ready.length; i++) {
        if (this.cancelled) { break; }
        const row = ready[i];
        this.progressText = `正在归档（${i + 1}/${ready.length}）：${row.def.title}`;
        this.cdr.detectChanges();
        try {
          await this.archive.archiveSheets(row.def.key, row.sheets, scopedStyles);
          ok++;
        } catch (error) {
          failNames.push(`${row.def.title}（${error instanceof Error ? error.message : '失败'}）`);
        }
      }

      // 3. 汇总结果
      const skipped = this.archiveTargets.length - ready.length;
      const parts = [`已归档 ${ok} 份`];
      if (failNames.length) { parts.push(`失败 ${failNames.length} 份：${failNames.join('、')}`); }
      if (skipped > 0) { parts.push(`${skipped} 份渲染失败未归档`); }
      if (this.cancelled && ok + failNames.length < ready.length) { parts.push('（已手动停止）'); }
      this.finishedSummary = parts.join('；') + '。';
    } catch (error) {
      this.finishedSummary = error instanceof Error ? error.message : '归档失败';
    } finally {
      this.archiving = false;
      this.progressText = '';
      // 清空不再使用的 sheets HTML，释放内存
      this.service.clearSheetCache(this.archiveTargets);
      this.cdr.detectChanges();
    }
  }

  formUrl(route: string): string { return `/form/${route}`; }
  trackRow(_: number, row: PrintRow): string { return row.def.key; }

  /* ------------------------------ 工具 ------------------------------ */

  private resetRows(): void {
    this.rows.forEach(row => {
      row.selected = false; row.hasData = false; row.count = 0;
      row.latestTime = undefined; row.estimatedPages = 0; row.renderedPages = 0;
      row.selectedPages = []; row.sheets = []; row.state = 'idle'; row.errorText = '';
    });
  }

  get bedText(): string {
    const bed = String(this.patient?.hisBed ?? '').trim();
    if (!bed) { return ''; }
    return bed.endsWith('床') ? bed : `${bed}床`;
  }

  genderText(g?: string | number): string {
    const v = String(g ?? '').trim();
    if (['Male', 'M', '男', '1'].includes(v)) { return '男'; }
    if (['Female', 'F', '女', '2'].includes(v)) { return '女'; }
    return v;
  }

  private calcAge(birthday?: string): number | null {
    if (!birthday) { return null; }
    const b = new Date(birthday);
    if (Number.isNaN(b.getTime())) { return null; }
    const n = new Date();
    let age = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) { age--; }
    return age >= 0 ? age : null;
  }

  private formatDiagnosis(diagnosis?: string): string {
    return firstDiagnosisSegment(diagnosis, 'legacy');
  }
}
