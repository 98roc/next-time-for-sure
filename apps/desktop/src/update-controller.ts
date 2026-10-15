/** 更新组件适配契约；安装只允许在下载完成且用户明确确认后调用。 */
export interface UpdateDriver {
  check(): Promise<string | undefined>;
  download(): Promise<void>;
  install(): void;
}

/** 更新界面使用原生对话框，不向业务网页暴露安装能力。 */
export interface UpdateInteraction {
  confirm(message: string, action: string): Promise<boolean>;
  inform(message: string): Promise<void>;
  status(message: string, progress?: number): void;
}

/** 管理检查、下载与安装，串行执行并保持“稍后安装”状态。 */
export class UpdateController {
  private busy = false;
  private downloaded = false;
  private version = '';

  constructor(private readonly driver: UpdateDriver | undefined, private readonly ui: UpdateInteraction, private readonly unavailable: string) {}

  /** 配置变更需重启，更新操作或确认框未结束时禁止重启。 */
  get isBusy(): boolean { return this.busy; }

  /** 下载进度只更新本地菜单和任务栏，不干扰用户正在编辑的网页。 */
  progress(percent: number): void {
    if (!this.busy || !Number.isFinite(percent)) return;
    const bounded = Math.max(0, Math.min(100, percent));
    this.ui.status(`正在下载更新 ${Math.floor(bounded)}%`, bounded / 100);
  }

  /** 启动检查无新版本时保持安静；手动检查始终给出结果。 */
  async check(manual: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (!this.driver) {
        if (manual) await this.ui.inform(this.unavailable);
        return;
      }
      if (!this.downloaded) {
        this.ui.status('正在检查更新…');
        const version = await this.driver.check();
        if (!version) {
          this.ui.status('检查更新');
          if (manual) await this.ui.inform('当前已是最新版本。');
          return;
        }
        this.version = version;
        this.ui.status(`发现新版 ${version}`);
        if (!await this.ui.confirm(`发现客户端新版本 ${version}，是否下载？下载期间可以继续使用。`, '下载更新')) return;

        // 禁止组件自行下载或退出安装，整个流程由本控制器及用户确认驱动。
        this.ui.status('正在下载更新 0%', 0);
        await this.driver.download();
        this.downloaded = true;
      }
      this.ui.status(`重启安装 ${this.version}`);
      if (await this.ui.confirm(`新版本 ${this.version} 已下载。请先保存正在编辑的内容，再重启安装。`, '重启安装')) {
        this.driver.install();
      }
    } catch {
      this.ui.status(this.downloaded ? `重启安装 ${this.version}` : '更新失败，点击重试');
      await this.ui.inform('客户端更新失败。请检查网络、更新地址和安装包是否完整，再重试。当前版本仍可继续使用。');
    } finally {
      this.busy = false;
    }
  }
}
