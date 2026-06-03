export class Navigation {
    constructor() {
        this.currentRequest = 0;
    }

    selectRequest(idx, dumpIdx, callback) {
        this.currentRequest = idx;

        const buttons = document.querySelectorAll(`#nav-${dumpIdx} .req-btn`);
        buttons.forEach((btn, i) => {
            btn.classList.toggle('active', i === idx);
        });

        if (callback) {
            callback(dumpIdx, idx);
        }
    }

    renderNav(dumpIdx, requestCount) {
        const nav = document.getElementById(`nav-${dumpIdx}`);
        if (!nav) return;

        nav.innerHTML = Array.from({ length: requestCount }, (_, i) => `
            <button class="req-btn ${i === 0 ? 'active' : ''}" onclick="window.app.selectRequest(${i}, ${dumpIdx})">R${i + 1}</button>
        `).join('');
    }
}
