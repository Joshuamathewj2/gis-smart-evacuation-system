/**
 * Progressive Web App (PWA) Controller:
 * Service Worker registration, Offline detection, Installation prompt,
 * and Evacuation Plan Sharing.
 */

let deferredInstallPrompt = null;

/**
 * Initializes Service Worker and online/offline event listeners.
 * @param {object} callbacks 
 * @param {Function} callbacks.onOnline 
 * @param {Function} callbacks.onOffline 
 */
export function initPWA({ onOnline, onOffline } = {}) {
    if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => {
                    console.log('[PWA] Service Worker registered:', reg.scope);
                })
                .catch(err => {
                    console.warn('[PWA] Service Worker registration failed:', err);
                });
        });
    }

    window.addEventListener('online', () => {
        if (typeof onOnline === 'function') onOnline();
    });

    window.addEventListener('offline', () => {
        if (typeof onOffline === 'function') onOffline();
    });

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        const installBtn = document.getElementById('pwaInstallBtn');
        if (installBtn) {
            installBtn.style.display = 'inline-flex';
        }
    });

    const installBtn = document.getElementById('pwaInstallBtn');
    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (deferredInstallPrompt) {
                deferredInstallPrompt.prompt();
                const choice = await deferredInstallPrompt.userChoice;
                if (choice.outcome === 'accepted') {
                    installBtn.style.display = 'none';
                }
                deferredInstallPrompt = null;
            }
        });
    }
}

/**
 * Encodes plan details into a shareable URL string.
 * @param {object} plan 
 * @returns {string} full shareable URL
 */
export function encodePlanUrl(plan) {
    if (!plan || !plan.destination || !plan.origin) return window.location.href;

    const payload = {
        lat: Number(plan.origin.lat.toFixed(5)),
        lon: Number(plan.origin.lon.toFixed(5)),
        destLat: Number(plan.destination.lat.toFixed(5)),
        destLon: Number(plan.destination.lon.toFixed(5)),
        destName: plan.destination.name,
        destType: plan.destination.type,
        disaster: plan.disasterType || 'general',
        mode: plan.profile || 'driving',
        ts: Date.now()
    };

    const encoded = encodeURIComponent(JSON.stringify(payload));
    const url = new URL(window.location.href);
    url.hash = `plan=${encoded}`;
    return url.toString();
}

/**
 * Decodes plan from current URL hash or search params.
 * @returns {object|null}
 */
export function decodePlanFromUrl() {
    try {
        const hash = window.location.hash.substring(1);
        const search = window.location.search.substring(1);
        const params = new URLSearchParams(hash || search);
        const raw = params.get('plan');

        if (raw) {
            return JSON.parse(decodeURIComponent(raw));
        }

        // Support legacy params: ?lat=..&lon=..&type=..
        const legacyLat = parseFloat(params.get('lat'));
        const legacyLon = parseFloat(params.get('lon'));
        const legacyType = params.get('type');
        if (!isNaN(legacyLat) && !isNaN(legacyLon)) {
            return {
                lat: legacyLat,
                lon: legacyLon,
                destType: legacyType || 'school',
                disaster: 'general',
                mode: 'driving'
            };
        }
    } catch (e) {
        console.warn('Failed to decode plan from URL', e);
    }
    return null;
}

/**
 * Shares evacuation plan using Web Share API or falls back to clipboard.
 * @param {object} plan 
 * @param {Function} showToast 
 */
export async function sharePlan(plan, showToast) {
    const url = encodePlanUrl(plan);
    const destName = plan?.destination?.name || 'Emergency Evacuation Facility';
    const text = `🚨 Emergency Evacuation Plan: Head to ${destName}. Click to open full navigation and route.`;

    if (navigator.share) {
        try {
            await navigator.share({
                title: 'Emergency Evacuation Plan',
                text,
                url
            });
            if (showToast) showToast('Plan shared successfully!');
            return;
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.warn('navigator.share failed, falling back to clipboard', err);
            } else {
                return; // User cancelled share sheet
            }
        }
    }

    // Clipboard fallback
    try {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        if (showToast) showToast('📋 Evacuation plan link copied to clipboard!');
    } catch (err) {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = `${text}\n${url}`;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        if (showToast) showToast('📋 Link copied to clipboard!');
    }
}
