import { ApiClient, type SessionUser } from './api';

export class AuthController {
  private readonly api = new ApiClient();
  private user: SessionUser | null = null;
  private registerMode = false;
  private readonly sessionListeners = new Set<(user: SessionUser | null) => void>();

  public onSessionChange(listener: (user: SessionUser | null) => void): () => void {
    this.sessionListeners.add(listener);
    listener(this.user);
    return () => this.sessionListeners.delete(listener);
  }

  public async init(): Promise<void> {
    document.getElementById('btn-account')!.onclick = () => this.open();
    document.getElementById('btn-close-auth')!.onclick = () => this.close();
    document.getElementById('btn-auth-mode')!.onclick = () => {
      this.registerMode = !this.registerMode;
      this.renderFormMode();
    };
    document.getElementById('btn-auth-submit')!.onclick = () => void this.submit();
    document.getElementById('btn-auth-logout')!.onclick = () => void this.logout();
    document.getElementById('auth-password')!.addEventListener('keydown', event => {
      if (event.key === 'Enter') void this.submit();
    });
    try {
      this.user = await this.api.currentUser();
    } catch {
      this.setMessage('账号服务暂时不可用，仍可离线游玩。');
    }
    this.render();
    this.notifySessionChange();
  }

  private open(): void {
    document.getElementById('auth-modal')!.classList.add('active');
    this.render();
  }

  private close(): void {
    document.getElementById('auth-modal')!.classList.remove('active');
  }

  private async submit(): Promise<void> {
    const email = (document.getElementById('auth-email') as HTMLInputElement).value;
    const displayName = (document.getElementById('auth-display-name') as HTMLInputElement).value;
    const password = (document.getElementById('auth-password') as HTMLInputElement).value;
    this.setMessage('请稍候…');
    try {
      this.user = this.registerMode
        ? await this.api.register(email, displayName, password)
        : await this.api.login(email, password);
      (document.getElementById('auth-password') as HTMLInputElement).value = '';
      this.render();
      this.notifySessionChange();
      this.setMessage('登录成功。成绩率达到 80% 后会自动计入榜单。');
    } catch (error) {
      this.setMessage((error as Error).message);
    }
  }

  private async logout(): Promise<void> {
    try { await this.api.logout(); } catch { /* Clear local presentation even if the session expired. */ }
    this.user = null;
    this.render();
    this.notifySessionChange();
    this.setMessage('已退出登录。');
  }

  private render(): void {
    const account = document.getElementById('btn-account')!;
    const form = document.getElementById('auth-form')!;
    const profile = document.getElementById('auth-profile')!;
    account.textContent = this.user ? this.user.displayName : '登录 / 注册';
    form.classList.toggle('hidden', Boolean(this.user));
    profile.classList.toggle('hidden', !this.user);
    if (this.user) {
      document.getElementById('auth-user-name')!.textContent = this.user.displayName;
      document.getElementById('auth-user-email')!.textContent = this.user.email;
      document.getElementById('auth-user-roles')!.textContent = this.user.roles.join(' · ');
    }
    this.renderFormMode();
  }

  private renderFormMode(): void {
    document.getElementById('auth-display-field')!.classList.toggle('hidden', !this.registerMode);
    document.getElementById('btn-auth-submit')!.textContent = this.registerMode ? '创建账号' : '登录';
    document.getElementById('btn-auth-mode')!.textContent = this.registerMode ? '已有账号？去登录' : '没有账号？去注册';
  }

  private setMessage(value: string): void {
    document.getElementById('auth-message')!.textContent = value;
  }

  private notifySessionChange(): void {
    for (const listener of this.sessionListeners) listener(this.user);
  }
}
