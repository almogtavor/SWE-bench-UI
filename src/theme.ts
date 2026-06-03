export class ThemeManager {
    private toggle: HTMLElement;
    private savedTheme: 'light' | 'dark';

    constructor(toggleElementId: string) {
        const el = document.getElementById(toggleElementId);
        if (!el) throw new Error(`Element with id ${toggleElementId} not found`);

        this.toggle = el;
        const stored = localStorage.getItem('theme');
        this.savedTheme = (stored === 'light' ? 'light' : 'dark');
        this.init();
    }

    private init(): void {
        this.setTheme(this.savedTheme);
        this.toggle.addEventListener('click', () => this.toggleTheme());
    }

    setTheme(theme: 'light' | 'dark'): void {
        if (theme === 'light') {
            document.body.classList.add('light-mode');
            this.toggle.textContent = '🌞';
            localStorage.setItem('theme', 'light');
        } else {
            document.body.classList.remove('light-mode');
            this.toggle.textContent = '🌙';
            localStorage.setItem('theme', 'dark');
        }
    }

    toggleTheme(): void {
        const isLight = document.body.classList.contains('light-mode');
        this.setTheme(isLight ? 'dark' : 'light');
    }
}
