import { ChangeDetectorRef, Component, Input, OnDestroy } from '@angular/core';
import { ArchiveService } from './archive.service';
import { isArchivable } from './archive.registry';

type ArchiveButtonState = 'idle' | 'busy' | 'ok' | 'error';

/**
 * 通用「归档」按钮。
 *
 * 用法（各表单工具栏打印按钮旁加一行）：
 *   <app-archive-button formKey="bradenForm" [disabled]="loading"></app-archive-button>
 *
 * - 是否显示由 archive.registry.ts 配置决定：未配置的 formKey 渲染为空
 * - 点击后采集当前页打印 HTML → POST /api/v1/icu/archives
 * - 结果就地反馈：归档中… / 已归档 v2 / 失败原因（3s 后复位）
 */
@Component({
  standalone: false,
  selector: 'app-archive-button',
  template: `
    <button
      *ngIf="visible"
      type="button"
      class="arch-btn"
      [class.arch-btn--busy]="state === 'busy'"
      [class.arch-btn--ok]="state === 'ok'"
      [class.arch-btn--error]="state === 'error'"
      [disabled]="disabled || state === 'busy'"
      [title]="message"
      (click)="archive()">
      {{ label }}
    </button>
    <span *ngIf="visible && message && state !== 'idle'" class="arch-msg"
          [class.arch-msg--error]="state === 'error'">{{ message }}</span>
  `,
  styles: [`
    :host { display:inline-flex; align-items:center; gap:8px; }
    .arch-btn {
      padding:5px 16px; border:1px solid #1890ff; background:#fff; color:#1890ff;
      border-radius:4px; cursor:pointer; font:inherit; white-space:nowrap;
    }
    .arch-btn:hover:not(:disabled) { background:#e6f7ff; }
    .arch-btn:disabled { opacity:.6; cursor:not-allowed; }
    .arch-btn--busy { border-color:#91caff; color:#1677ff; background:#e6f7ff; }
    .arch-btn--ok { border-color:#52c41a; color:#fff; background:#52c41a; }
    .arch-btn--error { border-color:#ff4d4f; color:#fff; background:#ff4d4f; }
    .arch-msg { font-size:12px; color:#666; white-space:nowrap; }
    .arch-msg--error { color:#cf1322; }
  `],
})
export class ArchiveButtonComponent implements OnDestroy {
  /** 表单键，需在 archive.registry.ts 中配置才会显示 */
  @Input() formKey = '';
  /** 外部禁用（如数据加载中） */
  @Input() disabled = false;

  state: ArchiveButtonState = 'idle';
  message = '';

  private resetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly archiveSvc: ArchiveService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  get visible(): boolean {
    return isArchivable(this.formKey);
  }

  get label(): string {
    switch (this.state) {
      case 'busy': return '归档中…';
      case 'ok': return '已归档';
      case 'error': return '归档失败';
      default: return '归档';
    }
  }

  async archive(): Promise<void> {
    if (!this.visible || this.disabled || this.state === 'busy') { return; }
    this.clearReset();
    this.state = 'busy';
    this.message = '';
    this.cdr.detectChanges();
    try {
      const res = await this.archiveSvc.archivePage(this.formKey);
      this.state = 'ok';
      this.message = res?.version
        ? `已归档 v${res.version}`
        : (res?.archiveId ? '归档成功' : '已归档');
    } catch (error) {
      this.state = 'error';
      this.message = error instanceof Error ? error.message : '归档失败';
      console.error('[Archive] failed:', this.formKey, error);
    } finally {
      this.cdr.detectChanges();
      // 成功 3s 后复位；失败保持展示，便于阅读原因（再次点击重试）
      if (this.state === 'ok') {
        this.resetTimer = setTimeout(() => {
          this.state = 'idle';
          this.message = '';
          this.cdr.detectChanges();
        }, 3000);
      }
    }
  }

  ngOnDestroy(): void {
    this.clearReset();
  }

  private clearReset(): void {
    if (this.resetTimer !== null) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }
}
