/**
 * UI Renderer and DOM Component Manager for GIS Smart Evacuation Assistant.
 * Handles primary plan rendering, turn-by-turn directions, ranked alternatives,
 * weather widget, emergency numbers modal, toasts, and accessible theme switching.
 */

import { formatDistance, formatDuration } from './geo.js';

const EMERGENCY_NUMBERS_KEY = 'gis_custom_emergency_numbers';

export const DEFAULT_EMERGENCY_NUMBERS = [
    { number: '112', title: 'National Emergency', desc: 'Unified Police, Fire, Ambulance (India)' },
    { number: '100', title: 'Police Control', desc: 'Immediate civil safety & security' },
    { number: '101', title: 'Fire & Rescue', desc: 'Fire, flood rescue & trapped citizens' },
    { number: '108', title: 'Emergency Ambulance', desc: 'Medical emergency triage & transport' },
    { number: '1070', title: 'State Disaster Helpline', desc: 'State disaster response management' },
    { number: '1077', title: 'District Disaster Control', desc: 'Local district collectorate emergency' }
];

/**
 * Shows an accessible, auto-dismissing toast notification.
 * @param {string} message 
 * @param {'info'|'success'|'warning'|'danger'} type 
 * @param {number} durationMs 
 */
export function showToast(message, type = 'info', durationMs = 3500) {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        container.setAttribute('aria-live', 'polite');
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'status');

    const icon = type === 'danger' ? '⚠️' : type === 'success' ? '✅' : type === 'warning' ? '⚡' : 'ℹ️';
    toast.innerHTML = `<span style="margin-right: 6px;">${icon}</span><span>${escapeHtml(message)}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, durationMs);
}

/**
 * Updates the network connectivity badge in the app header.
 * @param {boolean} isOnline 
 */
export function updateNetworkStatusBadge(isOnline, usingBundledData = false) {
    const badge = document.getElementById('networkStatusBadge');
    if (!badge) return;

    if (isOnline && usingBundledData) {
        // Connected, but every OSM mirror failed: be honest that results come from the small bundled dataset.
        badge.className = 'status-badge offline';
        badge.innerHTML = '<span style="color:#f59e0b;">●</span> OSM unreachable (bundled data)';
    } else if (isOnline) {
        badge.className = 'status-badge online';
        badge.innerHTML = '<span style="color:#10b981;">●</span> Online (Live OSM)';
    } else {
        badge.className = 'status-badge offline';
        badge.innerHTML = '<span style="color:#ef4444;">●</span> Offline (Cached / GeoJSON)';
    }
}

/**
 * Renders the primary recommended evacuation facility card.
 * @param {object} params
 * @param {object} params.plan
 * @param {HTMLElement} params.container
 * @param {Function} params.onPrint
 * @param {Function} params.onShare
 */
export function renderPrimaryPlan({ plan, container, onPrint, onShare }) {
    if (!container) return;
    if (!plan || !plan.destination) {
        container.innerHTML = `
            <div class="ui-card" style="text-align: center; padding: 2rem 1rem;">
                <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">📍</div>
                <h3 style="font-size: 1.1rem; margin-bottom: 0.35rem;">Set Your Location to Find Safe Shelters</h3>
                <p style="font-size: 0.85rem; color: var(--text-muted);">
                    Use "Locate Me", search an address, or click anywhere on the map to calculate optimal evacuation routes.
                </p>
            </div>
        `;
        return;
    }

    const dest = plan.destination;
    const isFallback = Boolean(plan.isFallback);
    const routeCrossesHazard = Boolean(plan.routeCrossesHazard);
    const score = dest.totalScore ?? 90;
    const modeLabel = plan.profile === 'foot' ? 'Walking (Foot)' : 'Driving (Road)';

    let hazardAlertHtml = '';
    if (dest.isExcluded) {
        hazardAlertHtml = `
            <div class="alert-box hazard" role="alert">
                <span>⛔</span>
                <div>
                    <strong>CRITICAL HAZARD WARNING:</strong> This facility is inside an active hazard zone.
                    Immediate relocation recommended!
                </div>
            </div>
        `;
    } else if (routeCrossesHazard) {
        hazardAlertHtml = `
            <div class="alert-box hazard" role="alert">
                <span>⚠️</span>
                <div>
                    <strong>ROUTE INTERSECTS ACTIVE HAZARD:</strong> The road route traverses a mapped hazard zone.
                    Consider picking an alternative shelter below or avoid designated hazard corridors.
                </div>
            </div>
        `;
    } else if (isFallback) {
        hazardAlertHtml = `
            <div class="alert-box warning" role="alert">
                <span>⚠️</span>
                <div>
                    <strong>Approximate Straight-Line Route:</strong> Live road routing server was unreachable offline.
                    Distances and ETA are estimated. Follow local municipal signage.
                </div>
            </div>
        `;
    } else {
        hazardAlertHtml = `
            <div class="alert-box safe" role="alert">
                <span>🛡️</span>
                <div>
                    <strong>Route Clear:</strong> Navigable road path verified. Outside active hazard zones.
                </div>
            </div>
        `;
    }

    const typeClass = dest.type === 'hospital' ? 'hospital' : dest.type === 'school' ? 'school' : 'shelter';

    container.innerHTML = `
        <div class="ui-card primary-plan" aria-labelledby="primaryPlanTitle">
            <div class="card-header-flex">
                <div>
                    <span class="plan-type-badge ${typeClass}">${escapeHtml(formatFacilityType(dest.type))}</span>
                    <h2 id="primaryPlanTitle" class="plan-title" style="margin-top: 4px;">${escapeHtml(dest.name)}</h2>
                    ${dest.address ? `<div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 2px;">📍 ${escapeHtml(dest.address)}</div>` : ''}
                </div>
                <div class="plan-score-badge" title="Composite multi-criteria score based on travel time, facility suitability, and safety distance">
                    <div class="score-num">${score}</div>
                    <div class="score-max">SCORE / 100</div>
                </div>
            </div>

            <div class="metric-grid">
                <div class="metric-box">
                    <div class="metric-label">Road Distance</div>
                    <div class="metric-value">${formatDistance(plan.distanceMeters)}</div>
                </div>
                <div class="metric-box">
                    <div class="metric-label">Travel ETA (${plan.profile === 'foot' ? '🚶' : '🚗'})</div>
                    <div class="metric-value">${formatDuration(plan.durationSeconds)}</div>
                </div>
                <div class="metric-box">
                    <div class="metric-label">Listed Capacity</div>
                    <div class="metric-value">${dest.capacity ? dest.capacity + ' people' : 'Not listed'}</div>
                </div>
                <div class="metric-box">
                    <div class="metric-label">Travel Mode</div>
                    <div class="metric-value" style="font-size: 0.95rem;">${modeLabel}</div>
                </div>
            </div>

            ${hazardAlertHtml}

            <div style="margin-top: 0.85rem; font-size: 0.82rem; color: var(--text-secondary); line-height: 1.45;">
                <p><strong>Suitability:</strong> ${escapeHtml(dest.suitabilityReason || 'Standard shelter facility')}</p>
                ${dest.safetyStatus ? `<p style="margin-top: 4px;"><strong>Safety Evaluation:</strong> ${escapeHtml(dest.safetyStatus)}</p>` : ''}
                ${dest.phone ? `<p style="margin-top: 4px;"><strong>Facility Phone:</strong> <a href="tel:${escapeHtml(dest.phone)}" style="color: var(--accent-blue); font-weight: 600;">${escapeHtml(dest.phone)}</a></p>` : ''}
            </div>

            <div style="display: flex; gap: 0.5rem; margin-top: 1rem; flex-wrap: wrap;">
                <button type="button" id="btnSharePlan" class="btn-icon" style="flex: 1;" title="Share Plan Link">
                    🔗 Share Plan
                </button>
                <button type="button" id="btnPrintPlan" class="btn-icon" style="flex: 1;" title="Print or Save PDF">
                    🖨️ Print Plan
                </button>
            </div>
        </div>
    `;

    const shareBtn = container.querySelector('#btnSharePlan');
    if (shareBtn && typeof onShare === 'function') {
        shareBtn.addEventListener('click', onShare);
    }

    const printBtn = container.querySelector('#btnPrintPlan');
    if (printBtn && typeof onPrint === 'function') {
        printBtn.addEventListener('click', onPrint);
    }
}

/**
 * Renders turn-by-turn navigation steps in an accessible accordion.
 * @param {Array<object>} steps 
 * @param {HTMLElement} container 
 * @param {boolean} isFallback 
 */
export function renderRouteSteps(steps = [], container, isFallback = false) {
    if (!container) return;

    if (!steps || steps.length === 0) {
        container.innerHTML = '';
        return;
    }

    const count = steps.length;
    const title = isFallback ? 'Estimated Direct Steps (Road Routing Offline)' : `Turn-by-Turn Steps (${count})`;

    const stepRowsHtml = steps.map((step, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === count - 1;
        const cls = isFirst ? 'first' : isLast ? 'last' : '';

        return `
            <div class="step-row ${cls}">
                <div class="step-icon" aria-hidden="true">${step.icon || '⬆️'}</div>
                <div class="step-info">
                    <div>${step.instruction}</div>
                    ${step.distanceMeters > 0 ? `
                        <div class="step-distance">
                            ${formatDistance(step.distanceMeters)} · ~${formatDuration(step.durationSeconds)}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="steps-accordion">
            <div class="steps-header" id="stepsAccordionHeader" role="button" tabindex="0" aria-expanded="true" aria-controls="stepsAccordionList">
                <span>🗺️ ${escapeHtml(title)}</span>
                <span id="stepsChevron" style="font-size: 0.8rem; transition: transform 0.2s;">▼</span>
            </div>
            <div class="steps-list" id="stepsAccordionList" role="region" aria-labelledby="stepsAccordionHeader">
                ${stepRowsHtml}
            </div>
        </div>
    `;

    const header = container.querySelector('#stepsAccordionHeader');
    const list = container.querySelector('#stepsAccordionList');
    const chevron = container.querySelector('#stepsChevron');

    if (header && list) {
        const toggleAccordion = () => {
            const isClosed = list.style.display === 'none';
            list.style.display = isClosed ? 'flex' : 'none';
            if (chevron) {
                chevron.style.transform = isClosed ? 'rotate(0deg)' : 'rotate(-90deg)';
            }
            header.setAttribute('aria-expanded', isClosed ? 'true' : 'false');
        };

        header.addEventListener('click', toggleAccordion);
        header.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleAccordion();
            }
        });
    }
}

/**
 * Renders ranked alternatives list with score breakdown and selection triggers.
 * @param {object} params
 * @param {Array<object>} params.rankedFacilities
 * @param {string} params.activeFacilityId
 * @param {HTMLElement} params.container
 * @param {Function} params.onSelectFacility
 */
export function renderRankedList({ rankedFacilities = [], activeFacilityId, container, onSelectFacility }) {
    if (!container) return;

    if (!rankedFacilities || rankedFacilities.length === 0) {
        container.innerHTML = '';
        return;
    }

    const itemsHtml = rankedFacilities.map((fac) => {
        const isActive = fac.id === activeFacilityId;
        const isExcluded = Boolean(fac.isExcluded);
        const cardClass = `shelter-card ${isActive ? 'active' : ''} ${isExcluded ? 'excluded' : ''}`;
        const score = fac.totalScore ?? 0;

        const badgesHtml = (fac.badges || []).map(b => {
            const dangerCls = b.includes('Excluded') || b.includes('Hazard') ? 'danger' : '';
            return `<span class="mini-badge ${dangerCls}">${escapeHtml(b)}</span>`;
        }).join('');

        return `
            <div class="${cardClass}" data-facility-id="${fac.id}" role="button" tabindex="0"
                 aria-pressed="${isActive ? 'true' : 'false'}"
                 title="${isExcluded ? 'Hazard: Excluded from safe routing' : 'Click to route to this facility'}">
                <div class="shelter-card-top">
                    <div>
                        <div class="shelter-name">
                            ${fac.rank ? `<span style="color: var(--accent-blue); margin-right: 4px;">#${fac.rank}</span>` : ''}
                            ${escapeHtml(fac.name)}
                        </div>
                        <div class="shelter-meta-row">
                            <span>🏷️ ${escapeHtml(formatFacilityType(fac.type))}</span>
                            <span>⏱️ ${fac.formattedDuration || '--'}</span>
                            ${fac.straightDistance ? `<span>📏 ${formatDistance(fac.straightDistance)}</span>` : ''}
                        </div>
                    </div>
                    <div style="text-align: right; flex-shrink: 0;">
                        ${!isExcluded ? `
                            <div style="font-weight: 800; font-size: 1.1rem; color: ${score >= 80 ? 'var(--accent-green)' : 'var(--accent-amber)'};">
                                ${score}
                            </div>
                            <div style="font-size: 0.65rem; color: var(--text-muted);">SCORE</div>
                        ` : `
                            <span class="mini-badge danger" style="font-size: 0.7rem;">EXCLUDED</span>
                        `}
                    </div>
                </div>

                ${badgesHtml ? `<div class="shelter-badge-row">${badgesHtml}</div>` : ''}

                ${fac.breakdown ? `
                    <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 4px; display: flex; gap: 8px;">
                        <span>Time: <b>${fac.breakdown.timeScore}/${fac.breakdown.maxTimeScore}</b></span>
                        <span>Suitability: <b>${fac.breakdown.suitabilityScore}/${fac.breakdown.maxSuitabilityScore}</b></span>
                        <span>Safety: <b>${fac.breakdown.safetyScore}/${fac.breakdown.maxSafetyScore}</b></span>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="ranked-container">
            <div class="section-heading">
                <span>Ranked Evacuation Facilities (${rankedFacilities.length})</span>
                <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: none;">Click to switch route</span>
            </div>
            ${itemsHtml}
        </div>
    `;

    container.querySelectorAll('.shelter-card').forEach(card => {
        const id = card.getAttribute('data-facility-id');
        const fac = rankedFacilities.find(f => f.id === id);

        const selectHandler = () => {
            if (fac && !fac.isExcluded && typeof onSelectFacility === 'function') {
                onSelectFacility(fac);
            } else if (fac && fac.isExcluded) {
                showToast('This facility is inside an active hazard zone and cannot be selected.', 'danger');
            }
        };

        card.addEventListener('click', selectHandler);
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectHandler();
            }
        });
    });
}

/**
 * Renders the live weather and hazard indicator widget.
 * @param {object} weather 
 * @param {HTMLElement} container 
 */
export function renderWeatherWidget(weather, container) {
    if (!container) return;

    if (!weather) {
        container.innerHTML = `
            <div class="weather-widget">
                <div class="weather-main">
                    <div class="weather-icon-lg">🌦️</div>
                    <div>
                        <div class="weather-condition">Live Weather</div>
                        <div style="font-size: 0.8rem; color: var(--text-muted);">Acquiring local conditions...</div>
                    </div>
                </div>
            </div>
        `;
        return;
    }

    const alertsHtml = (weather.alerts || []).map(a => `
        <div class="alert-box ${a.severity === 'critical' ? 'hazard' : 'warning'}" style="margin-top: 6px;" role="alert">
            <span>⚡</span>
            <div><strong>${escapeHtml(a.message)}</strong></div>
        </div>
    `).join('');

    container.innerHTML = `
        <div>
            <div class="weather-widget">
                <div class="weather-main">
                    <div class="weather-icon-lg">${weather.icon || '🌤️'}</div>
                    <div>
                        <div class="weather-temp">${weather.temperature}°C</div>
                        <div class="weather-condition">${escapeHtml(weather.condition)} · Feels like ${weather.apparentTemperature}°C</div>
                    </div>
                </div>
                <div class="weather-sub">
                    <div>💨 Wind: <b>${weather.windSpeed} km/h</b> (Gusts ${weather.windGusts})</div>
                    <div>💧 Rain: <b>${weather.precipitation} mm/h</b> · Humidity ${weather.humidity}%</div>
                </div>
            </div>
            ${alertsHtml}
        </div>
    `;
}

/**
 * Sets up the emergency telephone directory modal with custom contact additions.
 */
export function setupEmergencyNumbersModal() {
    const modal = document.getElementById('emergencyModal');
    const openBtn = document.getElementById('btnEmergencyNumbers');
    const closeBtn = document.getElementById('modalCloseBtn');
    const grid = document.getElementById('emergencyPhoneGrid');
    const addForm = document.getElementById('customNumberForm');

    if (!modal) return;

    const renderNumbers = () => {
        if (!grid) return;

        let customNumbers = [];
        try {
            const raw = localStorage.getItem(EMERGENCY_NUMBERS_KEY);
            if (raw) customNumbers = JSON.parse(raw);
        } catch (e) {
            console.warn('Error reading custom emergency numbers', e);
        }

        const allNumbers = [...DEFAULT_EMERGENCY_NUMBERS, ...customNumbers];

        grid.innerHTML = allNumbers.map((item, idx) => `
            <a href="tel:${escapeHtml(item.number)}" class="phone-card" title="Call ${escapeHtml(item.number)} directly">
                <div class="phone-card-number">📞 ${escapeHtml(item.number)}</div>
                <div class="phone-card-label">${escapeHtml(item.title)}</div>
                <div class="phone-card-desc">${escapeHtml(item.desc)}</div>
                ${idx >= DEFAULT_EMERGENCY_NUMBERS.length ? `
                    <button type="button" class="btn-delete-contact" data-idx="${idx - DEFAULT_EMERGENCY_NUMBERS.length}" 
                            style="margin-top: 4px; font-size: 0.7rem; color: #ef4444; background: none; border: none; cursor: pointer; text-align: left;"
                            title="Remove custom contact">
                        ✕ Remove
                    </button>
                ` : ''}
            </a>
        `).join('');

        // Attach delete events
        grid.querySelectorAll('.btn-delete-contact').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const index = parseInt(btn.getAttribute('data-idx'), 10);
                let current = [];
                try {
                    current = JSON.parse(localStorage.getItem(EMERGENCY_NUMBERS_KEY) || '[]');
                } catch (err) {}
                current.splice(index, 1);
                localStorage.setItem(EMERGENCY_NUMBERS_KEY, JSON.stringify(current));
                renderNumbers();
                showToast('Emergency contact removed', 'info');
            });
        });
    };

    if (openBtn) {
        openBtn.addEventListener('click', () => {
            renderNumbers();
            modal.style.display = 'flex';
            modal.setAttribute('aria-hidden', 'false');
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
        });
    }

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
        }
    });

    if (addForm) {
        addForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const titleInput = document.getElementById('customContactTitle');
            const numInput = document.getElementById('customContactNumber');
            const descInput = document.getElementById('customContactDesc');

            if (!titleInput || !numInput) return;

            const newContact = {
                title: titleInput.value.trim(),
                number: numInput.value.trim(),
                desc: descInput ? descInput.value.trim() : 'Custom Contact'
            };

            if (newContact.title && newContact.number) {
                let current = [];
                try {
                    current = JSON.parse(localStorage.getItem(EMERGENCY_NUMBERS_KEY) || '[]');
                } catch (err) {}
                current.push(newContact);
                localStorage.setItem(EMERGENCY_NUMBERS_KEY, JSON.stringify(current));

                titleInput.value = '';
                numInput.value = '';
                if (descInput) descInput.value = '';

                renderNumbers();
                showToast('Custom emergency contact added!', 'success');
            }
        });
    }
}

/**
 * Initializes Dark / Light theme toggle with persistence in localStorage.
 */
export function setupThemeToggle() {
    const toggleBtn = document.getElementById('btnThemeToggle');
    const THEME_KEY = 'gis_app_theme';

    const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    const updateIcon = (theme) => {
        if (toggleBtn) {
            toggleBtn.innerHTML = theme === 'light' ? '🌙' : '☀️';
            toggleBtn.title = theme === 'light' ? 'Switch to Dark Theme' : 'Switch to High-Contrast Light Theme';
        }
    };

    updateIcon(savedTheme);

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') || 'dark';
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem(THEME_KEY, next);
            updateIcon(next);
        });
    }
}

function formatFacilityType(type) {
    if (!type) return 'Shelter';
    return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
