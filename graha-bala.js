
'use strict';

/*
 * RADHE ASTRO
 * Independent Graha Bala Engine
 * Version: 1.0.0
 *
 * Step 1:
 * Validate and normalize D1 planetary longitudes.
 *
 * No paid API dependency.
 * No changes to existing a.js.
 */

const PLANETS = [
    'Sun',
    'Moon',
    'Mars',
    'Mercury',
    'Jupiter',
    'Venus',
    'Saturn'
];

const SIGNS = [
    'Aries',
    'Taurus',
    'Gemini',
    'Cancer',
    'Leo',
    'Virgo',
    'Libra',
    'Scorpio',
    'Sagittarius',
    'Capricorn',
    'Aquarius',
    'Pisces'
];

function normalizeDegrees(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        throw new Error('Invalid planetary longitude.');
    }

    return ((number % 360) + 360) % 360;
}

function getSignDetails(longitude) {
    const normalized = normalizeDegrees(longitude);

    const signIndex = Math.floor(normalized / 30);

    const degreeInSign = normalized % 30;

    const degrees = Math.floor(degreeInSign);

    const minutesDecimal = (degreeInSign - degrees) * 60;

    const minutes = Math.floor(minutesDecimal);

    const seconds = (minutesDecimal - minutes) * 60;

    return {
        signIndex,
        sign: SIGNS[signIndex],
        longitude: Number(normalized.toFixed(6)),
        degrees,
        minutes,
        seconds: Number(seconds.toFixed(2))
    };
}

function findPlanetLongitude(d1Details, planetName) {
    if (!d1Details || typeof d1Details !== 'object') {
        return null;
    }

    const sources = [
        d1Details.longitudes,
        d1Details.planets
    ];

    const aliases = {
        Sun: ['sun'],
        Moon: ['moon'],
        Mars: ['mars'],
        Mercury: ['mercury'],
        Jupiter: ['jupiter'],
        Venus: ['venus'],
        Saturn: ['saturn']
    };

    for (const source of sources) {
        if (!source || typeof source !== 'object') {
            continue;
        }

        const key = Object.keys(source).find(
            item => aliases[planetName].includes(
                item.toLowerCase()
            )
        );

        if (!key) continue;

        const value = source[key];

        if (typeof value === 'number' ||
            typeof value === 'string') {
            const number = Number(value);

            if (Number.isFinite(number)) {
                return number;
            }
        }

        if (value && typeof value === 'object') {
            const candidates = [
                value.fullDegree,
                value.full_degree,
                value.longitude,
                value.siderealLongitude
            ];

            for (const candidate of candidates) {
                if (candidate !== undefined &&
                    Number.isFinite(Number(candidate))) {
                    return Number(candidate);
                }
            }
        }
    }

    return null;
}

function validateD1Positions(d1Details) {
    if (!d1Details || typeof d1Details !== 'object') {
        throw new Error('Valid D1 chart data is required.');
    }

    const result = {};
    const missing = [];

    for (const planet of PLANETS) {
        const longitude = findPlanetLongitude(
            d1Details,
            planet
        );

        if (longitude === null) {
            missing.push(planet);
            continue;
        }

        result[planet] = getSignDetails(longitude);
    }

    if (missing.length > 0) {
        throw new Error(
            'Missing D1 planetary longitudes: ' +
            missing.join(', ')
        );
    }

    return {
        success: true,
        engine: 'Radhe Astro Graha Bala Engine',
        version: '1.0.0',
        calculationBasis: 'Sidereal D1 longitudes',
        planets: result
    };
}

module.exports = {
    PLANETS,
    SIGNS,
    normalizeDegrees,
    getSignDetails,
    validateD1Positions
};
