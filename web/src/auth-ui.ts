import { ApiClient, type SessionUser } from './api';

const LAST_USER_KEY = 'meowcan.lastSessionUser.v1';

function rememberUser(user: SessionUser | null): void {
  try {
    if (user) localStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(LAST_USER_KEY);
  } catch { /* Storage is optional for account display. */ }
}

function cachedUser(): SessionUser | null {
  try {
    const user = JSON.parse(localStorage.getItem(LAST_USER_KEY) || 'null') as SessionUser | null;
    return user && Number.isSafeInteger(user.id) ? user : null;
  } catch {
    return null;
  }
}

export class AuthController {
  private readonly api = new ApiClient();
  private user: SessionUser | null = null;
  private registerMode = false;
  private changingPassword = false;
  private readonly sessionListeners = new Set<(user: SessionUser | null) => void>();

  public onSessionChange(listener: (user: SessionUser | null) => void): () => void {
    this.sessionListeners.add(listener);
    listener(this.user);
    return () => this.sessionListeners.delete(listener);
  }

  public async init(): Promise<void> {
    window.addEventListener('online', () => void this.restoreSession());
    document.getElementById('btn-account')!.onclick = () => this.open();
    document.getElementById('btn-close-auth')!.onclick = () => this.close();
    document.getElementById('btn-auth-mode')!.onclick = () => {
      this.registerMode = !this.registerMode;
      this.renderFormMode();
    };
    document.getElementById('btn-auth-submit')!.onclick = () => void this.submit();
    document.getElementById('btn-auth-logout')!.onclick = () => void this.logout();
    document.getElementById('btn-change-password')!.onclick = () => {
      this.changingPassword = !this.changingPassword;
      if (!this.changingPassword) this.clearPasswordFields();
      this.setMessage('');
      this.renderPasswordForm();
    };
    document.getElementById('btn-save-password')!.onclick = () => void this.changePassword();
    document.getElementById('confirm-password')!.addEventListener('keydown', event => {
      if (event.key === 'Enter') void this.changePassword();
    });
    document.getElementById('auth-password')!.addEventListener('keydown', event => {
      if (event.key === 'Enter') void this.submit();
    });
    try {
      this.user = await this.api.currentUser();
      rememberUser(this.user);
    } catch {
      this.user = cachedUser();
      this.setMessage('账号服务暂时不可用，仍可离线游玩。');
    }
    this.render();
    this.notifySessionChange();
  }

  private async restoreSession(): Promise<void> {
    try {
      const user = await this.api.currentUser();
      if (user?.id === this.user?.id) return;
      this.user = user;
      rememberUser(user);
      this.render();
      this.notifySessionChange();
    } catch {
      // The next connection or login will retry session recovery.
    }
  }

  private open(): void {
    document.getElementById('auth-modal')!.classList.add('active');
    this.render();
  }

  private close(): void {
    document.getElementById('auth-modal')!.classList.remove('active');
    this.changingPassword = false;
    this.clearPasswordFields();
    this.renderPasswordForm();
  }

  private async submit(): Promise<void> {
    const identifier = (document.getElementById('auth-email') as HTMLInputElement).value;
    const displayName = (document.getElementById('auth-display-name') as HTMLInputElement).value;
    const password = (document.getElementById('auth-password') as HTMLInputElement).value;
    this.setMessage('请稍候…');
    try {
      this.user = this.registerMode
        ? await this.api.register(identifier, displayName, password)
        : await this.api.login(identifier, password);
      rememberUser(this.user);
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
    rememberUser(null);
    this.changingPassword = false;
    this.clearPasswordFields();
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
    this.renderPasswordForm();
  }

  private async changePassword(): Promise<void> {
    const currentPassword = (document.getElementById('current-password') as HTMLInputElement).value;
    const newPassword = (document.getElementById('new-password') as HTMLInputElement).value;
    const confirmPassword = (document.getElementById('confirm-password') as HTMLInputElement).value;
    if (newPassword !== confirmPassword) {
      this.setMessage('两次输入的新密码不一致。');
      return;
    }
    if (Array.from(newPassword).length < 8 || Array.from(newPassword).length > 30) {
      this.setMessage('新密码需 8–30 位。');
      return;
    }
    const saveButton = document.getElementById('btn-save-password') as HTMLButtonElement;
    saveButton.disabled = true;
    this.setMessage('请稍候…');
    try {
      await this.api.changePassword(currentPassword, newPassword);
      this.changingPassword = false;
      this.clearPasswordFields();
      this.renderPasswordForm();
      this.setMessage('密码已修改，其他设备需要重新登录。');
    } catch (error) {
      this.setMessage((error as Error).message);
    } finally {
      saveButton.disabled = false;
    }
  }

  private clearPasswordFields(): void {
    for (const id of ['current-password', 'new-password', 'confirm-password']) {
      (document.getElementById(id) as HTMLInputElement).value = '';
    }
  }

  private renderPasswordForm(): void {
    document.getElementById('change-password-form')!.classList.toggle('hidden', !this.user || !this.changingPassword);
    document.getElementById('btn-change-password')!.textContent = this.changingPassword ? '取消修改' : '修改密码';
  }

  private renderFormMode(): void {
    document.getElementById('auth-identifier-label')!.textContent = this.registerMode ? '邮箱' : '昵称或邮箱';
    const identifier = document.getElementById('auth-email') as HTMLInputElement;
    identifier.type = this.registerMode ? 'email' : 'text';
    identifier.autocomplete = this.registerMode ? 'email' : 'username';
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
