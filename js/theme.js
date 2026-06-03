export class ThemeManager {
    constructor(toggleElementId) {
        this.toggle = document.getElementById(toggleElementId);
        this.savedTheme = localStorage.getItem('theme') || 'dark';
        this.init();
    }

    init() {
        this.setTheme(this.savedTheme);
        this.toggle.addEventListener('click', () => this.toggleTheme());
    }

    setTheme(theme) {
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

    toggleTheme() {
        const isLight = document.body.classList.contains('light-mode');
        this.setTheme(isLight ? 'dark' : 'light');
    }
}
