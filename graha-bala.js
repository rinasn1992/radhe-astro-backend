
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

const DEBILITATION_POINTS = {
    Sun: 190,
    Moon: 213,
    Mars: 118,
    Mercury: 345,
    Jupiter: 275,
    Venus: 177,
    Saturn: 20
};

const PLANET_GENDER = {
    Sun: 'male',
    Moon: 'female',
    Mars: 'male',
    Mercury: 'neutral',
    Jupiter: 'male',
    Venus: 'female',
    Saturn: 'neutral'
};

// BPHS: Uchcha Bala
function calculateUchchaBala(planet, longitude) {
    if (!(planet in DEBILITATION_POINTS)) {
        throw new Error('Invalid planet for Uchcha Bala.');
    }

    const pos = normalizeDegrees(longitude);
    const deb = DEBILITATION_POINTS[planet];

    let distance = normalizeDegrees(pos - deb);

    if (distance > 180) {
        distance = 360 - distance;
    }

    return Number((distance / 3).toFixed(4));
}

// BPHS: Navamsa sign from sidereal longitude
function getNavamsaSignIndex(longitude) {
    const pos = normalizeDegrees(longitude);
    const signIndex = Math.floor(pos / 30);
    const degreeInSign = pos % 30;

    const navamsaPart = Math.floor(
        degreeInSign / (30 / 9)
    );

    return (signIndex * 9 + navamsaPart) % 12;
}

// BPHS: Ojhayugma Rasi-Amsha Bala
function calculateOjhayugmaBala(planet, longitude) {
    const pos = normalizeDegrees(longitude);
    const signIndex = Math.floor(pos / 30);
    const navamsaSignIndex = getNavamsaSignIndex(pos);

    const rasiIsOdd = signIndex % 2 === 0;
    const navamsaIsOdd = navamsaSignIndex % 2 === 0;

    const gender = PLANET_GENDER[planet];

    const requiredOdd = gender !== 'female';

    let bala = 0;

    if (rasiIsOdd === requiredOdd) {
        bala += 15;
    }

    if (navamsaIsOdd === requiredOdd) {
        bala += 15;
    }

    return {
        rasiBala: rasiIsOdd === requiredOdd ? 15 : 0,
        navamsaBala: navamsaIsOdd === requiredOdd ? 15 : 0,
        total: bala,
        navamsaSignIndex
    };
}

// BPHS: Kendradi Bala
function calculateKendradiBala(houseNumber) {
    const house = Number(houseNumber);

    if (!Number.isInteger(house) || house < 1 || house > 12) {
        throw new Error('Valid bhava number (1-12) required.');
    }

    if ([1, 4, 7, 10].includes(house)) return 60;
    if ([2, 5, 8, 11].includes(house)) return 30;

    return 15;
}

// BPHS: Drekkana Bala
function calculateDrekkanaBala(planet, longitude) {
    const pos = normalizeDegrees(longitude);
    const degreeInSign = pos % 30;

    const drekkana = Math.floor(degreeInSign / 10) + 1;
    const gender = PLANET_GENDER[planet];

    const requiredDrekkana = {
        male: 1,
        female: 2,
        neutral: 3
    }[gender];

    return {
        drekkana,
        bala: drekkana === requiredDrekkana ? 15 : 0
    };
}

// Four verified components; Saptavargaja is pending.
function calculatePartialSthanaBala(planet, longitude, houseNumber) {
    const uchcha = calculateUchchaBala(planet, longitude);
    const ojhayugma = calculateOjhayugmaBala(planet, longitude);
    const kendradi = calculateKendradiBala(houseNumber);
    const drekkana = calculateDrekkanaBala(planet, longitude);

    const partialTotal =
        uchcha +
        ojhayugma.total +
        kendradi +
        drekkana.bala;

    return {
        planet,
        uchchaBala: uchcha,
        ojhayugmaBala: ojhayugma,
        kendradiBala: kendradi,
        drekkanaBala: drekkana,
        partialTotalVirupa: Number(partialTotal.toFixed(4)),
        status: 'INCOMPLETE_SAPTAVARGAJA_PENDING'
    };
}

module.exports = {
    PLANETS,
    SIGNS,
    normalizeDegrees,
    getSignDetails,
    validateD1Positions,
    calculateUchchaBala,
    getNavamsaSignIndex,
    calculateOjhayugmaBala,
    calculateKendradiBala,
    calculateDrekkanaBala,
    calculatePartialSthanaBala
};
