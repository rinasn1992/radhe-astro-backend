
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

// ==========================================
// SAPTAVARGAJA BALA - BPHS CHAPTER 27
// ==========================================

const VARGA_SIGN_LORDS = [
    'Mars', 'Venus', 'Mercury', 'Moon',
    'Sun', 'Mercury', 'Venus', 'Mars',
    'Jupiter', 'Saturn', 'Saturn', 'Jupiter'
];

const OWN_SIGNS = {
    Sun: [4],
    Moon: [3],
    Mars: [0, 7],
    Mercury: [2, 5],
    Jupiter: [8, 11],
    Venus: [1, 6],
    Saturn: [9, 10]
};

const MOOLATRIKONA = {
    Sun: { sign: 4, start: 0, end: 20 },
    Moon: { sign: 1, start: 3, end: 30 },
    Mars: { sign: 0, start: 0, end: 12 },
    Mercury: { sign: 5, start: 15, end: 20 },
    Jupiter: { sign: 8, start: 0, end: 10 },
    Venus: { sign: 6, start: 0, end: 15 },
    Saturn: { sign: 10, start: 0, end: 20 }
};

const NATURAL_RELATIONSHIPS = {
    Sun: {
        friend: ['Moon', 'Mars', 'Jupiter'],
        neutral: ['Mercury'],
        enemy: ['Venus', 'Saturn']
    },
    Moon: {
        friend: ['Sun', 'Mercury'],
        neutral: ['Mars', 'Jupiter', 'Venus', 'Saturn'],
        enemy: []
    },
    Mars: {
        friend: ['Sun', 'Moon', 'Jupiter'],
        neutral: ['Venus', 'Saturn'],
        enemy: ['Mercury']
    },
    Mercury: {
        friend: ['Sun', 'Venus'],
        neutral: ['Mars', 'Jupiter', 'Saturn'],
        enemy: ['Moon']
    },
    Jupiter: {
        friend: ['Sun', 'Moon', 'Mars'],
        neutral: ['Saturn'],
        enemy: ['Mercury', 'Venus']
    },
    Venus: {
        friend: ['Mercury', 'Saturn'],
        neutral: ['Mars', 'Jupiter'],
        enemy: ['Sun', 'Moon']
    },
    Saturn: {
        friend: ['Mercury', 'Venus'],
        neutral: ['Jupiter'],
        enemy: ['Sun', 'Moon', 'Mars']
    }
};

const SAPTAVARGA_POINTS = {
    adhimitra: 20,
    mitra: 15,
    sama: 10,
    shatru: 4,
    adhishatru: 2
};

// Seven divisional sign positions from D1 longitude
function calculateSevenVargaSigns(longitude) {
    const pos = normalizeDegrees(longitude);
    const sign = Math.floor(pos / 30);
    const degree = pos % 30;

    const part3 = Math.min(2, Math.floor(degree / 10));
    const part7 = Math.min(6, Math.floor(degree / (30 / 7)));
    const part9 = Math.min(8, Math.floor(degree / (30 / 9)));
    const part12 = Math.min(11, Math.floor(degree / 2.5));

    // D2 Hora
    const hora = sign % 2 === 0
        ? (degree < 15 ? 4 : 3)
        : (degree < 15 ? 3 : 4);

    // D3 Drekkana - BPHS Correct Rule
const drekkana = sign % 2 === 0
    ? (sign + part3 * 4) % 12
    : (sign + (2 - part3) * 4) % 12;

    // D7 Saptamsa
    const saptamsa = (
        sign + (sign % 2 === 0 ? 0 : 6) + part7
    ) % 12;

    // D9 Navamsa
    const modalityOffset = sign % 3 === 0
        ? 0
        : sign % 3 === 1 ? 8 : 4;

    const navamsa = (
        sign + modalityOffset + part9
    ) % 12;

    // D12 Dvadasamsa
    const dvadasamsa = (sign + part12) % 12;

    // D30 Trimsamsa
    let trimsamsa;

    if (sign % 2 === 0) {
        if (degree < 5) trimsamsa = 0;
        else if (degree < 10) trimsamsa = 10;
        else if (degree < 18) trimsamsa = 8;
        else if (degree < 25) trimsamsa = 2;
        else trimsamsa = 6;
    } else {
        if (degree < 5) trimsamsa = 1;
        else if (degree < 12) trimsamsa = 5;
        else if (degree < 20) trimsamsa = 11;
        else if (degree < 25) trimsamsa = 9;
        else trimsamsa = 7;
    }

    return {
        D1: sign,
        D2: hora,
        D3: drekkana,
        D7: saptamsa,
        D9: navamsa,
        D12: dvadasamsa,
        D30: trimsamsa
    };
}

// Natural relationship
function getNaturalRelationship(planet, otherPlanet) {
    const relation = NATURAL_RELATIONSHIPS[planet];

    if (relation.friend.includes(otherPlanet)) return 'friend';
    if (relation.enemy.includes(otherPlanet)) return 'enemy';

    return 'neutral';
}

// Temporary relationship from D1 Rasi chart
function getTemporaryRelationship(
    planetSign,
    otherPlanetSign
) {
    const distance = (
        otherPlanetSign - planetSign + 12
    ) % 12;

    return [1, 2, 3, 9, 10, 11].includes(distance)
        ? 'friend'
        : 'enemy';
}

// Panchadha Maitri
function getCompoundRelationship(natural, temporary) {
    if (natural === 'friend' && temporary === 'friend') {
        return 'adhimitra';
    }

    if (natural === 'enemy' && temporary === 'enemy') {
        return 'adhishatru';
    }

    if (natural === 'neutral' && temporary === 'friend') {
        return 'mitra';
    }

    if (natural === 'neutral' && temporary === 'enemy') {
        return 'shatru';
    }

    if (
        (natural === 'friend' && temporary === 'enemy') ||
        (natural === 'enemy' && temporary === 'friend')
    ) {
        return 'sama';
    }

    throw new Error('Invalid planetary relationship.');
}

// Dignity score for one varga
function calculateVargaDignity(
    planet,
    vargaSign,
    d1Sign,
    d1Degree,
    vargaName,
    allD1Signs
) {
    const mt = MOOLATRIKONA[planet];

    // D1 Moolatrikona uses its exact degree range.
    // Other vargas use the corresponding Moolatrikona sign.
    if (
        vargaSign === mt.sign &&
        (
            vargaName !== 'D1' ||
            (
                d1Degree >= mt.start &&
                d1Degree < mt.end
            )
        )
    ) {
        return { dignity: 'moolatrikona', points: 45 };
    }

    if (OWN_SIGNS[planet].includes(vargaSign)) {
        return { dignity: 'own', points: 30 };
    }

    const signLord = VARGA_SIGN_LORDS[vargaSign];

    const natural = getNaturalRelationship(
        planet,
        signLord
    );

    const temporary = getTemporaryRelationship(
        allD1Signs[planet],
        allD1Signs[signLord]
    );

    const compound = getCompoundRelationship(
        natural,
        temporary
    );

    return {
        dignity: compound,
        points: SAPTAVARGA_POINTS[compound],
        signLord,
        naturalRelationship: natural,
        temporaryRelationship: temporary
    };
}

// Complete Saptavargaja Bala for one planet
function calculateSaptavargajaBala(planet, d1Details) {
    if (!PLANETS.includes(planet)) {
        throw new Error('Invalid planet for Saptavargaja Bala.');
    }

    const allD1Signs = {};
    const allLongitudes = {};

    for (const name of PLANETS) {
        const longitude = findPlanetLongitude(d1Details, name);

        if (longitude === null) {
            throw new Error(
                'Missing D1 longitude for ' + name
            );
        }

        allLongitudes[name] = longitude;
        allD1Signs[name] = Math.floor(
            normalizeDegrees(longitude) / 30
        );
    }

    const longitude = allLongitudes[planet];
    const degree = normalizeDegrees(longitude) % 30;

    const vargas = calculateSevenVargaSigns(longitude);

    const details = {};
    let total = 0;

    for (const name of Object.keys(vargas)) {
        const result = calculateVargaDignity(
            planet,
            vargas[name],
            allD1Signs[planet],
            degree,
            name,
            allD1Signs
        );

        details[name] = {
            signIndex: vargas[name],
            sign: SIGNS[vargas[name]],
            ...result
        };

        total += result.points;
    }

    return {
        planet,
        vargas: details,
        totalVirupa: Number(total.toFixed(4)),
        totalRupa: Number((total / 60).toFixed(4)),
        method: 'BPHS Chapter 27 - Saptavargaja Bala'
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
    calculatePartialSthanaBala,
    calculateSevenVargaSigns,
    calculateSaptavargajaBala
};
