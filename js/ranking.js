/**
 * Multi-criteria ranking engine for disaster evacuation facilities.
 * Balances road travel time, disaster-specific facility suitability,
 * and hazard exposure with full score breakdown and exclusion logic.
 */

import { evaluateFacilityHazard } from './hazards.js';
import { formatDistance, formatDuration } from './geo.js';

export const DISASTER_WEIGHTS = {
    flood: { time: 0.35, suitability: 0.40, safety: 0.25 },
    cyclone: { time: 0.35, suitability: 0.40, safety: 0.25 },
    earthquake: { time: 0.40, suitability: 0.35, safety: 0.25 },
    fire: { time: 0.45, suitability: 0.30, safety: 0.25 },
    general: { time: 0.40, suitability: 0.35, safety: 0.25 }
};

export const BASE_SUITABILITY = {
    flood: {
        school: 95,
        college: 95,
        community_centre: 90,
        shelter: 90,
        hospital: 85,
        fire_station: 85,
        police: 75,
        clinic: 65,
        assembly_point: 45
    },
    cyclone: {
        community_centre: 100,
        school: 95,
        college: 95,
        shelter: 95,
        hospital: 90,
        fire_station: 85,
        police: 85,
        clinic: 65,
        assembly_point: 30
    },
    earthquake: {
        assembly_point: 100, // Open spaces free from collapse
        shelter: 90,
        hospital: 90,
        fire_station: 85,
        community_centre: 75,
        school: 70,
        college: 70,
        clinic: 70,
        police: 70
    },
    fire: {
        fire_station: 100,
        assembly_point: 95,
        hospital: 90,
        shelter: 80,
        community_centre: 75,
        school: 70,
        college: 70,
        police: 75,
        clinic: 70
    },
    general: {
        shelter: 100,
        hospital: 95,
        community_centre: 90,
        school: 85,
        college: 85,
        fire_station: 80,
        assembly_point: 75,
        police: 75,
        clinic: 70
    }
};

/**
 * Calculates facility suitability score (0-100) for a specific disaster.
 * @param {object} facility 
 * @param {string} disasterType 
 * @param {object} options 
 * @returns {{ score: number, reason: string }}
 */
export function calculateFacilitySuitability(facility, disasterType = 'general', options = {}) {
    const table = BASE_SUITABILITY[disasterType] || BASE_SUITABILITY.general;
    let score = table[facility.type] || 60;
    const reasons = [];

    // Disaster-specific architectural adjustments
    if (disasterType === 'flood') {
        if (facility.levels && facility.levels > 1) {
            score = Math.min(100, score + 10);
            reasons.push(`${facility.levels}-story structure allows vertical flood evacuation`);
        } else if (facility.type === 'assembly_point') {
            reasons.push('Open ground carries potential waterlogging risk');
        } else {
            reasons.push('Standard flood-resistant civic structure');
        }
    } else if (disasterType === 'cyclone') {
        if (facility.type === 'assembly_point') {
            reasons.push('Outdoor assembly point severely exposed to cyclone wind and debris');
        } else if (facility.type === 'community_centre' || facility.type === 'school') {
            reasons.push('Reinforced masonry structure with storm protection');
        } else {
            reasons.push('Enclosed emergency facility');
        }
    } else if (disasterType === 'earthquake') {
        if (facility.type === 'assembly_point') {
            reasons.push('Open space provides maximum safety from structural collapse');
        } else if (facility.levels && facility.levels > 3) {
            score = Math.max(20, score - 15);
            reasons.push('Multi-story structure carries elevated seismic risk');
        } else {
            reasons.push('Low-profile civic facility');
        }
    } else if (disasterType === 'fire') {
        if (facility.type === 'fire_station') {
            reasons.push('Direct emergency suppression base with active firefighting units');
        } else if (facility.type === 'assembly_point') {
            reasons.push('Open outdoor safety zone free of toxic smoke entrapment');
        } else {
            reasons.push('Designated refuge location');
        }
    } else {
        reasons.push('Designated municipal evacuation point');
    }

    // Capacity bonuses
    if (facility.capacity >= 800) {
        score = Math.min(100, score + 8);
        reasons.push(`High shelter capacity (${facility.capacity}+ persons)`);
    } else if (facility.capacity >= 400) {
        score = Math.min(100, score + 4);
    }

    // Special needs priority
    if (options.medicalPriority) {
        if (facility.type === 'hospital' || facility.type === 'clinic') {
            score = 100;
            reasons.push('Priority medical triage facility');
        } else {
            // Demote non-medical shelters during acute medical emergencies
            score = Math.min(60, score - 30);
            reasons.push('Non-medical facility (medical attention needed)');
        }
    }

    return {
        score: Math.min(100, Math.max(0, score)),
        reason: reasons.join('. ')
    };
}

/**
 * Calculates travel time score (0-100).
 * Lower duration produces higher score.
 * @param {number} durationSeconds 
 * @param {'driving'|'foot'} profile 
 * @returns {number}
 */
export function calculateTravelTimeScore(durationSeconds, profile = 'driving') {
    if (durationSeconds == null || isNaN(durationSeconds) || durationSeconds <= 0) return 100;

    // Decay rate: driving reaches 50 at ~25 min (1500s); foot reaches 50 at ~35 min (2100s)
    const tau = profile === 'foot' ? 2400 : 1800;
    const score = 100 * Math.exp(-durationSeconds / tau);
    return Math.min(100, Math.max(5, Math.round(score)));
}

/**
 * Calculates safety and hazard exposure score (0-100) or disqualification.
 * @param {object} facility 
 * @param {Array<object>} hazards 
 * @param {boolean} routeCrossesHazard 
 * @returns {{ score: number, isExcluded: boolean, status: string }}
 */
export function calculateSafetyScore(facility, hazards = [], routeCrossesHazard = false) {
    if (!hazards || hazards.length === 0) {
        return {
            score: 100,
            isExcluded: false,
            status: 'Optimal (No active hazard zones detected nearby)'
        };
    }

    const hazardEval = evaluateFacilityHazard(facility, hazards);

    if (hazardEval.inHazard) {
        return {
            score: 0,
            isExcluded: true,
            status: `DANGER: Facility is located directly inside active hazard zone (${hazardEval.activeHazard?.name || 'Hazard Zone'})!`
        };
    }

    let score = 100;
    const notes = [];

    // Buffer proximity penalties
    if (hazardEval.nearestHazardDistance < 300) {
        score -= 50;
        notes.push('Critical proximity: <300m from active hazard perimeter');
    } else if (hazardEval.nearestHazardDistance < 800) {
        score -= 25;
        notes.push('Caution: within 800m of hazard zone');
    } else if (hazardEval.nearestHazardDistance < 1500) {
        score -= 10;
        notes.push('Fair distance from active hazards');
    } else {
        notes.push('Safe perimeter from mapped hazards');
    }

    // Route intersection penalty
    if (routeCrossesHazard) {
        score -= 30;
        notes.push('Warning: Direct access route traverses hazard zone');
    }

    return {
        score: Math.min(100, Math.max(5, score)),
        isExcluded: false,
        status: notes.join('. ')
    };
}

/**
 * Ranks all candidate facilities using weighted multi-criteria score.
 * @param {object} params
 * @param {{lat: number, lon: number}} params.userLocation
 * @param {Array<object>} params.facilities
 * @param {Array<number>} params.travelDurations Array of duration in seconds matching facilities
 * @param {string} params.disasterType 'flood'|'cyclone'|'earthquake'|'fire'|'general'
 * @param {Array<object>} params.hazards User-drawn and live hazard zones
 * @param {'driving'|'foot'} params.profile
 * @param {object} params.options Optional flags (e.g. medicalPriority)
 * @returns {Array<object>} Ranked list of facilities with full score breakdowns
 */
export function rankFacilities({
    userLocation,
    facilities = [],
    travelDurations = [],
    disasterType = 'general',
    hazards = [],
    profile = 'driving',
    options = {}
}) {
    if (!facilities || facilities.length === 0) return [];

    const weights = DISASTER_WEIGHTS[disasterType] || DISASTER_WEIGHTS.general;

    const scoredList = facilities.map((facility, index) => {
        const durationSec = travelDurations[index] ?? 99999;

        // 1. Travel time score
        const timeScore = calculateTravelTimeScore(durationSec, profile);

        // 2. Suitability score
        const { score: suitScore, reason: suitReason } = calculateFacilitySuitability(facility, disasterType, options);

        // 3. Safety score
        const safetyResult = calculateSafetyScore(facility, hazards, false);

        // 4. Composite score
        let composite = 0;
        if (!safetyResult.isExcluded) {
            composite = Math.round(
                (timeScore * weights.time) +
                (suitScore * weights.suitability) +
                (safetyResult.score * weights.safety)
            );
        }

        // Badges
        const badges = [];
        if (safetyResult.isExcluded) {
            badges.push('Excluded: Inside Hazard');
        } else {
            if (suitScore >= 95) badges.push('Top Suitability');
            if (timeScore >= 85) badges.push(profile === 'foot' ? 'Quick Walk' : 'Fast Drive');
            if (facility.capacity >= 800) badges.push('High Capacity');
            if (facility.type === 'hospital') badges.push('Medical Emergency');
        }

        return {
            ...facility,
            rank: 0, // Assigned after sorting
            totalScore: composite,
            isExcluded: safetyResult.isExcluded,
            durationSeconds: durationSec,
            formattedDuration: formatDuration(durationSec),
            breakdown: {
                timeScore: Math.round(timeScore * weights.time),
                maxTimeScore: Math.round(100 * weights.time),
                suitabilityScore: Math.round(suitScore * weights.suitability),
                maxSuitabilityScore: Math.round(100 * weights.suitability),
                safetyScore: Math.round(safetyResult.score * weights.safety),
                maxSafetyScore: Math.round(100 * weights.safety),
                rawTimeScore: timeScore,
                rawSuitScore: suitScore,
                rawSafetyScore: safetyResult.score
            },
            disasterType,
            suitabilityReason: suitReason,
            safetyStatus: safetyResult.status,
            badges
        };
    });

    // Sort: Non-excluded facilities first by totalScore desc, then duration asc; excluded facilities at the end
    scoredList.sort((a, b) => {
        if (a.isExcluded && !b.isExcluded) return 1;
        if (!a.isExcluded && b.isExcluded) return -1;
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        return a.durationSeconds - b.durationSeconds;
    });

    // Assign final rank numbers to non-excluded facilities
    let activeRank = 1;
    for (const item of scoredList) {
        if (!item.isExcluded) {
            item.rank = activeRank++;
            if (item.rank === 1 && !item.badges.includes('Primary Safe Recommendation')) {
                item.badges.unshift('Primary Recommendation');
            }
        } else {
            item.rank = null;
        }
    }

    return scoredList;
}
