const express = require('express');
const cors = require('cors');
const { find } = require('geo-tz');

const app = express();

app.use(cors({
    origin: process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',').map(x => x.trim())
        : true
}));

app.use(express.json({ limit: '32kb' }));

// ==========================================
// RADHE ASTRO - KUNDALI MATCHMAKING BACKEND
// ==========================================

let ephemeraPromise = null;

async function getEphemera() {
    if (!ephemeraPromise) {
        ephemeraPromise = import('@astrologer/ephemera')
            .then(async mod => ({
                eph: await mod.createEphemera(),
                Body: mod.Body,
                Ayanamsa: mod.Ayanamsa
            }))
            .catch(error => {
                ephemeraPromise = null;
                throw error;
            });
    }

    return ephemeraPromise;
}

// ------------------------------------------
// CONSTANTS
// ------------------------------------------

const RASHIS = [
    'मेष', 'वृषभ', 'मिथुन', 'कर्क',
    'सिंह', 'कन्या', 'तुला', 'वृश्चिक',
    'धनु', 'मकर', 'कुंभ', 'मीन'
];

const NAKSHATRAS = [
    'अश्विनी', 'भरणी', 'कृत्तिका',
    'रोहिणी', 'मृगशिरा', 'आर्द्रा',
    'पुनर्वसु', 'पुष्य', 'आश्लेषा',
    'मघा', 'पूर्वा फाल्गुनी', 'उत्तरा फाल्गुनी',
    'हस्त', 'चित्रा', 'स्वाती',
    'विशाखा', 'अनुराधा', 'ज्येष्ठा',
    'मूल', 'पूर्वाषाढ़ा', 'उत्तराषाढ़ा',
    'श्रवण', 'धनिष्ठा', 'शतभिषा',
    'पूर्वाभाद्रपद', 'उत्तराभाद्रपद', 'रेवती'
];

const NAKSHATRA_SIZE = 360 / 27;
const PADA_SIZE = NAKSHATRA_SIZE / 4;

// ------------------------------------------
// INPUT VALIDATION
// ------------------------------------------

function parseDate(value) {
    if (typeof value !== 'string') return null;

    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!m) return null;

    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);

    const test = new Date(Date.UTC(year, month - 1, day));

    if (
        year < 1 ||
        test.getUTCFullYear() !== year ||
        test.getUTCMonth() !== month - 1 ||
        test.getUTCDate() !== day
    ) {
        return null;
    }

    return { year, month, day };
}

function parseTime(value) {
    if (typeof value !== 'string') return null;

    const m = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);

    if (!m) return null;

    return {
        hour: Number(m[1]),
        minute: Number(m[2])
    };
}

function normalize(value) {
    return ((value % 360) + 360) % 360;
}

// ------------------------------------------
// LOCAL BIRTH TIME TO UTC
// ------------------------------------------

function getTimezoneOffset(timeZone, utcMs) {
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    });

    const parts = formatter.formatToParts(new Date(utcMs));
    const data = {};

    for (const part of parts) {
        if (part.type !== 'literal') {
            data[part.type] = Number(part.value);
        }
    }

    const localAsUTC = Date.UTC(
        data.year,
        data.month - 1,
        data.day,
        data.hour,
        data.minute,
        data.second
    );

    return localAsUTC - utcMs;
}

function localBirthToUTC(dateParts, timeParts, timeZone) {
    const localAsUTC = Date.UTC(
        dateParts.year,
        dateParts.month - 1,
        dateParts.day,
        timeParts.hour,
        timeParts.minute
    );

    let utcMs = localAsUTC;

    // Iterate to account for the birth-date-specific UTC offset.
    for (let i = 0; i < 4; i++) {
        const offset = getTimezoneOffset(timeZone, utcMs);
        utcMs = localAsUTC - offset;
    }

    // Reject ambiguous or nonexistent local times.
    const checkOffset = getTimezoneOffset(timeZone, utcMs);

    if (utcMs + checkOffset !== localAsUTC) {
        throw new Error(
            'Birth time is ambiguous or invalid in the selected timezone.'
        );
    }

    return new Date(utcMs);
}

// ------------------------------------------
// JULIAN DATE
// ------------------------------------------

function getDecimalYear(date) {
    const year = date.getUTCFullYear();

    const start = Date.UTC(year, 0, 1);
    const end = Date.UTC(year + 1, 0, 1);

    return year + (date.getTime() - start) / (end - start);
}

function getJulianDate(eph, date) {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;

    const day =
        date.getUTCDate() +
        (
            date.getUTCHours() * 3600 +
            date.getUTCMinutes() * 60 +
            date.getUTCSeconds() +
            date.getUTCMilliseconds() / 1000
        ) / 86400;

    return eph.julianDate(year, month, day);
}

// ------------------------------------------
// MOON SIDEREAL POSITION - LAHIRI
// ------------------------------------------


function getMoonDetails(eph, Body, Ayanamsa, birthUTC) {
    const jd = getJulianDate(eph, birthUTC);

    const tt = eph.utToTt(
        jd,
        getDecimalYear(birthUTC)
    );

    const moon = eph.position(Body.Moon, jd);

    const ayanamsha = eph.ayanamsa(
        Ayanamsa.Lahiri,
        tt
    );

    const longitude = normalize(
        moon.longitude - ayanamsha
    );

    const rashiIndex = Math.floor(longitude / 30);

    const rashiDegree = longitude - rashiIndex * 30;

    const nakshatraIndex = Math.floor(
        longitude / NAKSHATRA_SIZE
    );

    const nakshatraStart =
        nakshatraIndex * NAKSHATRA_SIZE;

    const pada = Math.floor(
        (longitude - nakshatraStart) / PADA_SIZE
    ) + 1;

    // D-9 Navamsha calculation
    const navamshaPart = Math.min(
        8,
        Math.floor(rashiDegree / (30 / 9))
    );

    let navamshaStart;

    if (rashiIndex % 3 === 0) {
        // Movable signs
        navamshaStart = rashiIndex;
    } else if (rashiIndex % 3 === 1) {
        // Fixed signs
        navamshaStart = (rashiIndex + 8) % 12;
    } else {
        // Dual signs
        navamshaStart = (rashiIndex + 4) % 12;
    }

    const navamshaRashiIndex =
        (navamshaStart + navamshaPart) % 12;

    return {
        tropicalLongitude: Number(
            moon.longitude.toFixed(8)
        ),

        siderealLongitude: Number(
            longitude.toFixed(8)
        ),

        ayanamsha: Number(
            ayanamsha.toFixed(8)
        ),

        rashi: RASHIS[rashiIndex],

        rashiIndex,

        rashiDegree: Number(
            rashiDegree.toFixed(6)
        ),

        nakshatra: NAKSHATRAS[nakshatraIndex],

        nakshatraIndex: nakshatraIndex + 1,

        pada,

        navamshaRashi: RASHIS[navamshaRashiIndex],

        navamshaRashiIndex,

        navamshaRashiLord: GRAHA_LORDS[navamshaRashiIndex]
    };
}

// ------------------------------------------
// MANGALIK - RAW SIDEREAL POSITIONS
// Lahiri Ayanamsha + Whole Sign
// ------------------------------------------

function getManglikDetails(
    eph,
    Body,
    Ayanamsa,
    birthUTC,
    latitude,
    longitude,
    moonDetails
) {
    const jd = getJulianDate(eph, birthUTC);

    const tt = eph.utToTt(
        jd,
        getDecimalYear(birthUTC)
    );

    const ayanamsha = eph.ayanamsa(
        Ayanamsa.Lahiri,
        tt
    );

    // Tropical planetary positions
    const mars = eph.position(Body.Mars, jd);
    const venus = eph.position(Body.Venus, jd);

    // Tropical Ascendant and MC
    const angles = eph.ascMc(
        jd,
        longitude,
        latitude
    );

    if (
        !mars ||
        !venus ||
        !angles ||
        !Number.isFinite(angles.asc)
    ) {
        throw new Error(
            'Manglik planetary or Ascendant calculation failed.'
        );
    }

    // Convert tropical longitudes to Lahiri sidereal
    const marsLongitude = normalize(
        mars.longitude - ayanamsha
    );

    const venusLongitude = normalize(
        venus.longitude - ayanamsha
    );

    const ascLongitude = normalize(
        angles.asc - ayanamsha
    );

    const marsRashiIndex = Math.floor(
        marsLongitude / 30
    );

    const venusRashiIndex = Math.floor(
        venusLongitude / 30
    );

    const ascRashiIndex = Math.floor(
        ascLongitude / 30
    );

    // Whole Sign house calculation
    function getHouseFromReference(referenceRashiIndex) {
        return (
            (marsRashiIndex - referenceRashiIndex + 12) % 12
        ) + 1;
    }

    const manglikHouses = [1, 2, 4, 7, 8, 12];

    const lagnaHouse = getHouseFromReference(
        ascRashiIndex
    );

    const moonHouse = getHouseFromReference(
        moonDetails.rashiIndex
    );

    const venusHouse = getHouseFromReference(
        venusRashiIndex
    );

    function getResult(house) {
        return {
            marsHouse: house,
            manglikPosition: manglikHouses.includes(house)
        };
    }

    return {
        calculation: 'Lahiri Sidereal - Whole Sign',
        ayanamsha: Number(ayanamsha.toFixed(8)),

        ascendant: {
            longitude: Number(ascLongitude.toFixed(8)),
            rashi: RASHIS[ascRashiIndex],
            rashiIndex: ascRashiIndex
        },

        mars: {
            tropicalLongitude: Number(mars.longitude.toFixed(8)),
            siderealLongitude: Number(marsLongitude.toFixed(8)),
            rashi: RASHIS[marsRashiIndex],
            rashiIndex: marsRashiIndex
        },

        venus: {
            siderealLongitude: Number(venusLongitude.toFixed(8)),
            rashi: RASHIS[venusRashiIndex],
            rashiIndex: venusRashiIndex
        },

        fromLagna: getResult(lagnaHouse),
        fromMoon: getResult(moonHouse),
        fromVenus: getResult(venusHouse),

        manglikHouses
    };
}
// ==========================================
// RADHE ASTRO - FULL D1 & D9 CHART DETAILS
// Lahiri Sidereal + Whole Sign
// ==========================================

function getFullChartDetails(
    eph,
    Body,
    Ayanamsa,
    birthUTC,
    latitude,
    longitude
) {
    const jd = getJulianDate(eph, birthUTC);

    const tt = eph.utToTt(
        jd,
        getDecimalYear(birthUTC)
    );

    const ayanamsha = eph.ayanamsa(
        Ayanamsa.Lahiri,
        tt
    );

    const angles = eph.ascMc(
        jd,
        longitude,
        latitude
    );

    if (
        !angles ||
        !Number.isFinite(angles.asc)
    ) {
        throw new Error(
            'Full chart Ascendant calculation failed.'
        );
    }

    const ascLongitude = normalize(
        angles.asc - ayanamsha
    );

    const ascRashiIndex = Math.floor(
        ascLongitude / 30
    );

    const ascDegree = ascLongitude % 30;

    // D9 Navamsha calculation
    function getNavamsha(longitudeValue) {
        const signIndex = Math.floor(
            longitudeValue / 30
        );

        const degree = longitudeValue % 30;

        const part = Math.min(
            8,
            Math.floor(degree / (30 / 9))
        );

        let start;

        if (signIndex % 3 === 0) {
            start = signIndex;
        } else if (signIndex % 3 === 1) {
            start = (signIndex + 8) % 12;
        } else {
            start = (signIndex + 4) % 12;
        }

        return (start + part) % 12;
    }

    const navamshaAscIndex =
        getNavamsha(ascLongitude);

    
    // Traditional planets + Mean Rahu
    const planetList = [
        { key: 'sun', name: 'सूर्य', body: Body.Sun },
        { key: 'moon', name: 'चंद्र', body: Body.Moon },
        { key: 'mars', name: 'मंगल', body: Body.Mars },
        { key: 'mercury', name: 'बुध', body: Body.Mercury },
        { key: 'jupiter', name: 'गुरु', body: Body.Jupiter },
        { key: 'venus', name: 'शुक्र', body: Body.Venus },
        { key: 'saturn', name: 'शनि', body: Body.Saturn },
        { key: 'rahu', name: 'राहु', body: Body.MeanNode }
    ];

    const planets = {};

    for (const planet of planetList) {
        const position = eph.position(
            planet.body,
            jd
        );

        if (
            !position ||
            !Number.isFinite(position.longitude)
        ) {
            throw new Error(
                'Planet position failed: ' + planet.name
            );
        }

        const siderealLongitude = normalize(
            position.longitude - ayanamsha
        );

        const rashiIndex = Math.floor(
            siderealLongitude / 30
        );

        const rashiDegree =
            siderealLongitude % 30;

        const navamshaIndex =
            getNavamsha(siderealLongitude);

        const house = (
            (rashiIndex - ascRashiIndex + 12) % 12
        ) + 1;

        const navamshaHouse = (
            (navamshaIndex - navamshaAscIndex + 12) % 12
        ) + 1;

        planets[planet.key] = {
            name: planet.name,

            tropicalLongitude: Number(
                position.longitude.toFixed(8)
            ),

            siderealLongitude: Number(
                siderealLongitude.toFixed(8)
            ),

            rashi: RASHIS[rashiIndex],
            rashiIndex,

            rashiDegree: Number(
                rashiDegree.toFixed(6)
            ),

            house,

            navamshaRashi: RASHIS[navamshaIndex],
            navamshaRashiIndex: navamshaIndex,

            navamshaLord:
                GRAHA_LORDS[navamshaIndex],

            navamshaHouse,

            retrograde:
                Number.isFinite(position.longitudeSpeed)
                    ? position.longitudeSpeed < 0
                    : null
        };
    }

    // Ketu = Rahu + 180 degrees
    const rahu = planets.rahu;

    const ketuSiderealLongitude = normalize(
        rahu.siderealLongitude + 180
    );

    const ketuTropicalLongitude = normalize(
        rahu.tropicalLongitude + 180
    );

    const ketuRashiIndex = Math.floor(
        ketuSiderealLongitude / 30
    );

    const ketuRashiDegree =
        ketuSiderealLongitude % 30;

    const ketuNavamshaIndex =
        getNavamsha(ketuSiderealLongitude);

    const ketuHouse = (
        (ketuRashiIndex - ascRashiIndex + 12) % 12
    ) + 1;

    const ketuNavamshaHouse = (
        (ketuNavamshaIndex - navamshaAscIndex + 12) % 12
    ) + 1;

    planets.ketu = {
        name: 'केतु',

        tropicalLongitude: Number(
            ketuTropicalLongitude.toFixed(8)
        ),

        siderealLongitude: Number(
            ketuSiderealLongitude.toFixed(8)
        ),

        rashi: RASHIS[ketuRashiIndex],
        rashiIndex: ketuRashiIndex,

        rashiDegree: Number(
            ketuRashiDegree.toFixed(6)
        ),

        house: ketuHouse,

        navamshaRashi: RASHIS[ketuNavamshaIndex],
        navamshaRashiIndex: ketuNavamshaIndex,

        navamshaLord:
            GRAHA_LORDS[ketuNavamshaIndex],

        navamshaHouse: ketuNavamshaHouse,

        retrograde: rahu.retrograde
    };
    

    return {
        calculation: 'Lahiri Sidereal - Whole Sign',

        ayanamsha: Number(
            ayanamsha.toFixed(8)
        ),

        ascendant: {
            longitude: Number(
                ascLongitude.toFixed(8)
            ),

            rashi: RASHIS[ascRashiIndex],
            rashiIndex: ascRashiIndex,

            degree: Number(
                ascDegree.toFixed(6)
            ),

            navamshaRashi:
                RASHIS[navamshaAscIndex],

            navamshaRashiIndex:
                navamshaAscIndex
        },

        planets
    };
}

// ==========================================
// RADHE ASTRO - MARRIAGE HOUSE ANALYSIS
// D1 & D9 - Seventh House and Seventh Lord
// ==========================================

function getMarriageHouseDetails(chart) {

    const planetKeyByName = {
        'सूर्य': 'sun',
        'चंद्र': 'moon',
        'मंगल': 'mars',
        'बुध': 'mercury',
        'गुरु': 'jupiter',
        'शुक्र': 'venus',
        'शनि': 'saturn'
    };

    // D1 - Seventh House
    const seventhRashiIndex =
        (chart.ascendant.rashiIndex + 6) % 12;

    const seventhLord =
        GRAHA_LORDS[seventhRashiIndex];

    const seventhLordKey =
        planetKeyByName[seventhLord];

    const seventhLordPlanet =
        chart.planets[seventhLordKey];

    const seventhHouseOccupants =
        Object.entries(chart.planets)
            .filter(([key, planet]) =>
                planet.house === 7
            )
            .map(([key, planet]) => ({
                key,
                name: planet.name,
                rashi: planet.rashi,
                degree: planet.rashiDegree
            }));

    // D9 - Seventh House
    const navamshaSeventhRashiIndex =
        (chart.ascendant.navamshaRashiIndex + 6) % 12;

    const navamshaSeventhLord =
        GRAHA_LORDS[navamshaSeventhRashiIndex];

    const navamshaSeventhLordKey =
        planetKeyByName[navamshaSeventhLord];

    const navamshaSeventhLordPlanet =
        chart.planets[navamshaSeventhLordKey];

    const navamshaSeventhHouseOccupants =
        Object.entries(chart.planets)
            .filter(([key, planet]) =>
                planet.navamshaHouse === 7
            )
            .map(([key, planet]) => ({
                key,
                name: planet.name,
                navamshaRashi: planet.navamshaRashi
            }));

    return {
        d1: {
            seventhHouse: {
                rashi: RASHIS[seventhRashiIndex],
                rashiIndex: seventhRashiIndex,
                lord: seventhLord,
                occupants: seventhHouseOccupants
            },

            seventhLordPosition: {
                rashi: seventhLordPlanet.rashi,
                house: seventhLordPlanet.house,
                degree: seventhLordPlanet.rashiDegree,
                retrograde: seventhLordPlanet.retrograde
            }
        },

        d9: {
            seventhHouse: {
                rashi: RASHIS[navamshaSeventhRashiIndex],
                rashiIndex: navamshaSeventhRashiIndex,
                lord: navamshaSeventhLord,
                occupants: navamshaSeventhHouseOccupants
            },

            seventhLordPosition: {
                rashi: navamshaSeventhLordPlanet.navamshaRashi,
                house: navamshaSeventhLordPlanet.navamshaHouse
            }
        }
    };
}

function getMarriageAspectDetails(chart, marriageDetails) {

    const aspectRules = {
        sun: [7],
        moon: [7],
        mars: [4, 7, 8],
        mercury: [7],
        jupiter: [5, 7, 9],
        venus: [7],
        saturn: [3, 7, 10]
    };

    const planetKeyByName = {
        'सूर्य': 'sun',
        'चंद्र': 'moon',
        'मंगल': 'mars',
        'बुध': 'mercury',
        'गुरु': 'jupiter',
        'शुक्र': 'venus',
        'शनि': 'saturn'
    };

    function getAspectingPlanets(
        targetHouse,
        houseField,
        excludeKey = null
    ) {
        return Object.entries(chart.planets)
            .filter(([key]) =>
                Object.prototype.hasOwnProperty.call(
                    aspectRules,
                    key
                ) && key !== excludeKey
            )
            .flatMap(([key, planet]) => {

                const sourceHouse = planet[houseField];

                if (
                    !Number.isInteger(sourceHouse) ||
                    sourceHouse < 1 ||
                    sourceHouse > 12
                ) {
                    return [];
                }

                const distance =
                    ((targetHouse - sourceHouse + 12) % 12) + 1;

                if (!aspectRules[key].includes(distance)) {
                    return [];
                }

                return [{
                    key,
                    name: planet.name,
                    sourceHouse,
                    aspect: distance
                }];
            });
    }

    const d1LordKey =
        planetKeyByName[marriageDetails.d1.seventhHouse.lord];

    const d9LordKey =
        planetKeyByName[marriageDetails.d9.seventhHouse.lord];

    return {
        d1: {
            seventhHouseAspects:
                getAspectingPlanets(7, 'house'),

            seventhLordHouseAspects:
                getAspectingPlanets(
                    marriageDetails.d1.seventhLordPosition.house,
                    'house',
                    d1LordKey
                )
        },

        d9: {
            seventhHouseAspects:
                getAspectingPlanets(7, 'navamshaHouse'),

            seventhLordHouseAspects:
                getAspectingPlanets(
                    marriageDetails.d9.seventhLordPosition.house,
                    'navamshaHouse',
                    d9LordKey
                )
        },

        method:
            'Parashari Graha Drishti - Classical Seven Planets; Rahu-Ketu aspects excluded'
    };
}

function getMarriageKarakaDetails(chart, marriageDetails) {

    const karakaRules = {
        venus: {
            name: 'शुक्र',
            exalted: 'मीन',
            debilitated: 'कन्या',
            ownSigns: ['वृषभ', 'तुला']
        },
        jupiter: {
            name: 'गुरु',
            exalted: 'कर्क',
            debilitated: 'मकर',
            ownSigns: ['धनु', 'मीन']
        }
    };

    function getDignity(rashi, rules) {

        if (rashi === rules.exalted) {
            return 'उच्च';
        }

        if (rashi === rules.debilitated) {
            return 'नीच';
        }

        if (rules.ownSigns.includes(rashi)) {
            return 'स्वराशि';
        }

        return 'अन्य राशि - मित्रता परीक्षण शेष';
    }

    function getPlanetDetails(key, chartType) {

        const planet = chart.planets[key];
        const rules = karakaRules[key];

        const isD9 = chartType === 'D9';

        const rashi = isD9
            ? planet.navamshaRashi
            : planet.rashi;

        const house = isD9
            ? planet.navamshaHouse
            : planet.house;

        return {
            key,
            name: rules.name,
            rashi,
            house,
            dignity: getDignity(rashi, rules),
            retrograde: planet.retrograde
        };
    }

    const d1SeventhLord =
        marriageDetails.d1.seventhHouse.lord;

    const d9SeventhLord =
        marriageDetails.d9.seventhHouse.lord;

    const planetKeyByName = {
        'सूर्य': 'sun',
        'चंद्र': 'moon',
        'मंगल': 'mars',
        'बुध': 'mercury',
        'गुरु': 'jupiter',
        'शुक्र': 'venus',
        'शनि': 'saturn'
    };

    const d1SeventhLordKey =
        planetKeyByName[d1SeventhLord];

    const d9SeventhLordKey =
        planetKeyByName[d9SeventhLord];

    const result = {
        d1: {},
        d9: {}
    };

    for (const key of ['venus', 'jupiter']) {

        const d1Planet = getPlanetDetails(key, 'D1');
        const d9Planet = getPlanetDetails(key, 'D9');

        result.d1[key] = {
            ...d1Planet,
            sameHouseAsSeventhLord:
                d1Planet.house ===
                chart.planets[d1SeventhLordKey].house
        };

        result.d9[key] = {
            ...d9Planet,
            sameHouseAsSeventhLord:
                d9Planet.house ===
                chart.planets[d9SeventhLordKey].navamshaHouse
        };
    }

    result.method =
        'D1 and D9 Marriage Karaka Position and Basic Dignity';

    return result;
}

function getPanchadhaMaitriDetails(chart) {

    const naturalRelations = {
        sun: {
            friends: ['moon', 'mars', 'jupiter'],
            enemies: ['venus', 'saturn']
        },
        moon: {
            friends: ['sun', 'mercury'],
            enemies: []
        },
        mars: {
            friends: ['sun', 'moon', 'jupiter'],
            enemies: ['mercury']
        },
        mercury: {
            friends: ['sun', 'venus'],
            enemies: ['moon']
        },
        jupiter: {
            friends: ['sun', 'moon', 'mars'],
            enemies: ['venus', 'mercury']
        },
        venus: {
            friends: ['mercury', 'saturn'],
            enemies: ['sun', 'moon']
        },
        saturn: {
            friends: ['mercury', 'venus'],
            enemies: ['sun', 'moon', 'mars']
        }
    };

    const planetNames = {
        sun: 'सूर्य',
        moon: 'चंद्र',
        mars: 'मंगल',
        mercury: 'बुध',
        jupiter: 'गुरु',
        venus: 'शुक्र',
        saturn: 'शनि'
    };

    const temporaryFriendHouses = [2, 3, 4, 10, 11, 12];

    function getNaturalRelation(source, target) {

        const rules = naturalRelations[source];

        if (rules.friends.includes(target)) {
            return 'मित्र';
        }

        if (rules.enemies.includes(target)) {
            return 'शत्रु';
        }

        return 'सम';
    }

    function getPanchadhaRelation(natural, temporary) {

        if (natural === 'मित्र' && temporary === 'मित्र') {
            return 'अधिमित्र';
        }

        if (natural === 'शत्रु' && temporary === 'शत्रु') {
            return 'अधिशत्रु';
        }

        if (
            (natural === 'मित्र' && temporary === 'शत्रु') ||
            (natural === 'शत्रु' && temporary === 'मित्र')
        ) {
            return 'सम';
        }

        if (natural === 'सम' && temporary === 'मित्र') {
            return 'मित्र';
        }

        if (natural === 'सम' && temporary === 'शत्रु') {
            return 'शत्रु';
        }

        return 'सम';
    }

    function calculateForChart(chartType) {

        const signField =
            chartType === 'D1'
                ? 'rashiIndex'
                : 'navamshaRashiIndex';

        const result = {};

        for (const source of ['venus', 'jupiter']) {

            const sourcePlanet = chart.planets[source];

            result[source] = [];

            for (const target of Object.keys(naturalRelations)) {

                if (source === target) {
                    continue;
                }

                const targetPlanet = chart.planets[target];

                const sourceSign = sourcePlanet[signField];
                const targetSign = targetPlanet[signField];

                const distance =
                    ((targetSign - sourceSign + 12) % 12) + 1;

                const natural =
                    getNaturalRelation(source, target);

                const temporary =
                    temporaryFriendHouses.includes(distance)
                        ? 'मित्र'
                        : 'शत्रु';

                result[source].push({
                    planet: planetNames[target],
                    naturalRelation: natural,
                    temporaryRelation: temporary,
                    relativeHouse: distance,
                    panchadhaRelation:
                        getPanchadhaRelation(natural, temporary)
                });
            }
        }

        return result;
    }

    return {
        d1: calculateForChart('D1'),
        d9: calculateForChart('D9'),
        method:
            'Parashari Panchadha Graha Maitri - Natural and Temporary Relationships'
    };
}

function getCoupleKarakaComparison(boyChart, girlChart) {

    const pairs = [
        {
            boyPlanet: 'venus',
            girlPlanet: 'venus',
            label: 'शुक्र-शुक्र'
        },
        {
            boyPlanet: 'jupiter',
            girlPlanet: 'jupiter',
            label: 'गुरु-गुरु'
        },
        {
            boyPlanet: 'venus',
            girlPlanet: 'jupiter',
            label: 'लड़के का शुक्र - लड़की का गुरु'
        },
        {
            boyPlanet: 'jupiter',
            girlPlanet: 'venus',
            label: 'लड़के का गुरु - लड़की का शुक्र'
        }
    ];

    function getRelationship(distance) {

        if (distance === 1) return 'समान राशि';
        if ([5, 9].includes(distance)) return 'त्रिकोण संबंध';
        if ([4, 7, 10].includes(distance)) return 'केंद्र संबंध';
        if ([2, 12].includes(distance)) return 'द्विर्द्वादश संबंध';
        if ([6, 8].includes(distance)) return 'षडाष्टक संबंध';
        if ([3, 11].includes(distance)) return 'तृतीय-एकादश संबंध';

        return 'अन्य';
    }

    function compareCharts(chartType) {

        const signField =
            chartType === 'D1'
                ? 'rashiIndex'
                : 'navamshaRashiIndex';

        const signNameField =
            chartType === 'D1'
                ? 'rashi'
                : 'navamshaRashi';

        return pairs.map(pair => {

            const boyPlanet =
                boyChart.planets[pair.boyPlanet];

            const girlPlanet =
                girlChart.planets[pair.girlPlanet];

            const boySign = boyPlanet[signField];
            const girlSign = girlPlanet[signField];

            const boyToGirlDistance =
                ((girlSign - boySign + 12) % 12) + 1;

            const girlToBoyDistance =
                ((boySign - girlSign + 12) % 12) + 1;

            return {
                pair: pair.label,

                boy: {
                    planet: boyPlanet.name,
                    rashi: boyPlanet[signNameField]
                },

                girl: {
                    planet: girlPlanet.name,
                    rashi: girlPlanet[signNameField]
                },

                boyToGirl: {
                    relativeHouse: boyToGirlDistance,
                    relationship:
                        getRelationship(boyToGirlDistance)
                },

                girlToBoy: {
                    relativeHouse: girlToBoyDistance,
                    relationship:
                        getRelationship(girlToBoyDistance)
                }
            };
        });
    }

    return {
        d1: compareCharts('D1'),
        d9: compareCharts('D9'),

        method:
            'Inter-chart Venus and Jupiter Sign Relationship - D1 and D9',

        note:
            'This is a comparative sign relationship analysis, not an independent marriage compatibility score.'
    };
}

function getManglikDoshaCancellation(manglikDetails, chartDetails) {
    if (
        !manglikDetails ||
        !manglikDetails.fromLagna ||
        !manglikDetails.fromMoon ||
        !manglikDetails.fromVenus ||
        !chartDetails ||
        !chartDetails.planets
    ) {
        throw new Error(
            'Manglik cancellation: required chart data is missing'
        );
    }

    const planets = chartDetails.planets;

    const mars = planets.mars;
    const jupiter = planets.jupiter;
    const moon = planets.moon;
    const venus = planets.venus;

    if (!mars || !jupiter || !moon || !venus) {
        throw new Error(
            'Manglik cancellation: Mars, Jupiter, Moon or Venus data missing'
        );
    }

    const rawDosha = {
        fromLagna: manglikDetails.fromLagna.manglikPosition === true,
        fromMoon: manglikDetails.fromMoon.manglikPosition === true,
        fromVenus: manglikDetails.fromVenus.manglikPosition === true
    };

    const rawDoshaPresent = Object.values(rawDosha).some(Boolean);

    const fullCancellations = [];
    const partialMitigations = [];

    // --------------------------------------------------
    // IMPORTANT:
    // No raw Manglik dosha means no cancellation claim.
    // --------------------------------------------------

    if (!rawDoshaPresent) {
        return {
            method: 'North Indian Extended Manglik Analysis',

            rawManglikStatus: rawDosha,

            rawDoshaPresent: false,

            cancellationStatus: 'NO_DOSHA_PRESENT',

            fullCancellations: [],

            partialMitigations: [],

            evidenceSummary: {
                fullCancellationCount: 0,
                partialMitigationCount: 0
            },

            interpretation:
                'निर्धारित लग्न, चंद्र और शुक्र संदर्भों में मूल मांगलिक दोष नहीं मिला। इसलिए दोष-भंग की आवश्यकता नहीं है।',

            importantNote:
                'दोष न होना और दोष-भंग होना दो अलग स्थितियाँ हैं।'
        };
    }

    function addMitigation(id, rule, source, reason) {
        partialMitigations.push({
            id,
            rule,
            source,
            reason,
            classification: 'POTENTIAL_MITIGATION',
            fullCancellationConfirmed: false
        });
    }

    const marsSign = mars.rashiIndex;

    if (!Number.isInteger(marsSign)) {
        throw new Error(
            'Manglik cancellation: invalid Mars sign index'
        );
    }

    const marsHouseFromLagna =
        manglikDetails.fromLagna.marsHouse;

    // --------------------------------------------------
    // RULE 1: Traditional house-sign exceptions
    // Applied only when Manglik dosha exists from Lagna.
    // --------------------------------------------------

    const houseSignExceptions = {
        2: [2, 5],       // Gemini, Virgo
        4: [0, 7],       // Aries, Scorpio
        7: [3, 9],       // Cancer, Capricorn
        8: [8, 11],      // Sagittarius, Pisces
        12: [1, 6]       // Taurus, Libra
    };

    if (rawDosha.fromLagna) {
        const exemptSigns =
            houseSignExceptions[marsHouseFromLagna] || [];

        if (exemptSigns.includes(marsSign)) {
            addMitigation(
                'RAMAN_HOUSE_SIGN_EXCEPTION',
                'भाव-राशि आधारित पारंपरिक अपवाद',
                'B. V. Raman, Muhurtha',
                `लग्न से मंगल ${marsHouseFromLagna}वें भाव में ${mars.rashi} राशि में है। इस परंपरा में इस भाव-राशि संयोजन को अपवाद माना जाता है।`
            );
        }
    }

    // --------------------------------------------------
    // RULE 2: Mars in Leo or Aquarius
    // Keep as a separate traditional candidate.
    // Do not automatically cancel raw dosha.
    // --------------------------------------------------

    if ([4, 10].includes(marsSign)) {
        addMitigation(
            'RAMAN_LEO_AQUARIUS_RULE',
            'सिंह अथवा कुंभ राशि में मंगल',
            'Traditional rule requiring source-specific verification',
            `मंगल ${mars.rashi} राशि में है। इस नियम को संभावित परिहार संकेत के रूप में दर्ज किया गया है, पूर्ण दोष-भंग के रूप में नहीं।`
        );
    }

    // --------------------------------------------------
    // RULE 3: Mars and Jupiter conjunction
    // --------------------------------------------------

    if (marsSign === jupiter.rashiIndex) {
        addMitigation(
            'MARS_JUPITER_CONJUNCTION',
            'मंगल-गुरु युति',
            'Traditional benefic association; requires rule-specific validation',
            `मंगल और गुरु दोनों ${mars.rashi} राशि में स्थित हैं।`
        );
    }

    // --------------------------------------------------
    // RULE 4: Jupiter aspect on Mars
    // Parashari Jupiter aspects: 5, 7, 9
    // --------------------------------------------------

    const jupiterToMarsDistance =
        ((marsSign - jupiter.rashiIndex + 12) % 12) + 1;

    if ([5, 7, 9].includes(jupiterToMarsDistance)) {
        addMitigation(
            'JUPITER_ASPECT_ON_MARS',
            'मंगल पर गुरु की विशेष दृष्टि',
            'Parashari Jupiter aspect calculation',
            `गुरु से मंगल ${jupiterToMarsDistance}वीं राशि में है। गुरु की ${jupiterToMarsDistance}वीं दृष्टि मंगल पर पड़ती है।`
        );
    }

    // --------------------------------------------------
    // RULE 5: Mars and Moon conjunction
    // --------------------------------------------------

    if (marsSign === moon.rashiIndex) {
        addMitigation(
            'MARS_MOON_CONJUNCTION',
            'मंगल-चंद्र युति',
            'Traditional rule requiring source-specific validation',
            `मंगल और चंद्रमा दोनों ${mars.rashi} राशि में स्थित हैं।`
        );
    }

    // --------------------------------------------------
    // RULE 6: Jupiter in D1 Lagna
    // --------------------------------------------------

    if (jupiter.house === 1) {
        addMitigation(
            'JUPITER_IN_LAGNA',
            'लग्न में गुरु',
            'Traditional rule requiring source-specific validation',
            'जन्म कुंडली के प्रथम भाव में गुरु स्थित है।'
        );
    }

    // --------------------------------------------------
    // RULE 7: Venus in D1 Lagna
    // --------------------------------------------------

    if (venus.house === 1) {
        addMitigation(
            'VENUS_IN_LAGNA',
            'लग्न में शुक्र',
            'Traditional rule requiring source-specific validation',
            'जन्म कुंडली के प्रथम भाव में शुक्र स्थित है।'
        );
    }

    // --------------------------------------------------
    // RULE 8: Mars in own or exaltation sign
    // This is supporting information, not automatic cancellation.
    // --------------------------------------------------

    if ([0, 7, 9].includes(marsSign)) {
        let reason;

        if (marsSign === 0) {
            reason = 'मंगल अपनी मेष राशि में स्थित है।';
        } else if (marsSign === 7) {
            reason = 'मंगल अपनी वृश्चिक राशि में स्थित है।';
        } else {
            reason = 'मंगल अपनी उच्च मकर राशि में स्थित है।';
        }

        addMitigation(
            'MARS_STRONG_SIGN',
            'मंगल की राशि-स्थिति',
            'Planetary dignity assessment',
            reason + ' इसे अपने आप पूर्ण मांगलिक दोष-भंग नहीं माना गया है।'
        );
    }

    // --------------------------------------------------
    // FINAL STATUS
    // No full cancellation is declared automatically.
    // --------------------------------------------------

    const cancellationStatus =
        partialMitigations.length > 0
            ? 'POTENTIAL_MITIGATION_REQUIRES_VALIDATION'
            : 'NO_CANCELLATION_RULE_FOUND';

    return {
        method: 'North Indian Extended Manglik Analysis',

        rawManglikStatus: rawDosha,

        rawDoshaPresent: true,

        cancellationStatus,

        fullCancellations,

        partialMitigations,

        evidenceSummary: {
            fullCancellationCount: 0,
            partialMitigationCount: partialMitigations.length
        },

        interpretation:
            partialMitigations.length > 0
                ? 'मूल मांगलिक दोष मौजूद है। कुछ संभावित पारंपरिक शमन संकेत मिले हैं, लेकिन अभी पूर्ण दोष-भंग प्रमाणित नहीं है।'
                : 'मूल मांगलिक दोष मौजूद है। जाँचे गए नियमों में कोई संभावित परिहार संकेत नहीं मिला।',

        importantNote:
            'मूल मांगलिक स्थिति सुरक्षित रखी गई है। संभावित शमन संकेत को पूर्ण दोष-भंग नहीं माना गया है। प्रत्येक नियम की परंपरा और प्रमाण अलग से सत्यापित करना आवश्यक है।'
    };
}


function getManglikSeverity(
    manglikDetails,
    chartDetails,
    cancellationDetails
) {
    if (!manglikDetails || !chartDetails ||
        !chartDetails.planets) {
        throw new Error(
            'Manglik severity: required chart data is missing'
        );
    }

    const mars = chartDetails.planets.mars;

    if (!mars) {
        throw new Error(
            'Manglik severity: Mars data is missing'
        );
    }

    const references = [
        {
            name: 'Lagna',
            hindiName: 'जन्म लग्न',
            result: manglikDetails.fromLagna
        },
        {
            name: 'Moon',
            hindiName: 'चंद्र लग्न',
            result: manglikDetails.fromMoon
        },
        {
            name: 'Venus',
            hindiName: 'शुक्र लग्न',
            result: manglikDetails.fromVenus
        }
    ];

    const affectedReferences = references
        .filter(item =>
            item.result &&
            item.result.manglikPosition === true
        )
        .map(item => ({
            reference: item.name,
            referenceHindi: item.hindiName,
            marsHouse: item.result.marsHouse,
            manglikPosition: true
        }));

    const unaffectedReferences = references
        .filter(item =>
            item.result &&
            item.result.manglikPosition === false
        )
        .map(item => ({
            reference: item.name,
            referenceHindi: item.hindiName,
            marsHouse: item.result.marsHouse,
            manglikPosition: false
        }));

    const affectedCount = affectedReferences.length;

    // --------------------------------------------------
    // INTENSITY CLASSIFICATION
    // This is an analytical coverage classification,
    // not a universal classical numerical scale.
    // --------------------------------------------------

    let intensityLevel = 'NONE';
    let intensityHindi = 'मांगलिक दोष का संकेत नहीं';

    if (affectedCount === 1) {
        intensityLevel = 'LIMITED';
        intensityHindi = 'सीमित मांगलिक संकेत';
    } else if (affectedCount === 2) {
        intensityLevel = 'MODERATE';
        intensityHindi = 'दो संदर्भों से मांगलिक संकेत';
    } else if (affectedCount === 3) {
        intensityLevel = 'WIDESPREAD';
        intensityHindi = 'तीनों संदर्भों से मांगलिक संकेत';
    }

    // --------------------------------------------------
    // MARS POSITION AND CONDITION
    // --------------------------------------------------

    const ownSigns = [0, 7]; // Aries, Scorpio
    const exaltedSign = 9;   // Capricorn

    let signCondition = 'OTHER_SIGN';
    let signConditionHindi = 'अन्य राशि';

    if (ownSigns.includes(mars.rashiIndex)) {
        signCondition = 'OWN_SIGN';
        signConditionHindi = 'स्वराशि';
    } else if (mars.rashiIndex === exaltedSign) {
        signCondition = 'EXALTED';
        signConditionHindi = 'उच्च राशि';
    } else if (mars.rashiIndex === 3) {
        signCondition = 'DEBILITATED';
        signConditionHindi = 'नीच राशि';
    }

    const marsCondition = {
        sign: mars.rashi,
        signIndex: mars.rashiIndex,
        house: mars.house,
        degreeInSign: mars.rashiDegree,
        retrograde: mars.retrograde,
        signCondition,
        signConditionHindi
    };

    // --------------------------------------------------
    // NAVAMSHA POSITION
    // --------------------------------------------------

    const navamshaPosition = {
        sign: mars.navamshaRashi,
        signIndex: mars.navamshaRashiIndex,
        house: mars.navamshaHouse,
        lord: mars.navamshaLord
    };

    // --------------------------------------------------
    // CANCELLATION STATUS
    // Raw dosha and cancellation evidence remain separate.
    // --------------------------------------------------

    let cancellationStatus = 'NOT_AVAILABLE';

    if (cancellationDetails) {
        cancellationStatus =
            cancellationDetails.cancellationStatus ||
            'NOT_AVAILABLE';
    }

    let residualAssessment =
        'दोष की मूल स्थिति दर्ज है; दोष-भंग का अलग मूल्यांकन आवश्यक है।';

    if (
        cancellationStatus ===
        'TRADITIONAL_CANCELLATION_RULES_FOUND'
    ) {
        residualAssessment =
            'दोष-भंग के कुछ पारंपरिक नियम लागू पाए गए हैं। उनकी प्रमाणिकता और प्रभाव की अलग समीक्षा आवश्यक है।';
    } else if (
        cancellationStatus === 'PARTIAL_MITIGATION_ONLY'
    ) {
        residualAssessment =
            'आंशिक शमन के संकेत मिले हैं; मूल मांगलिक स्थिति बनी रहती है।';
    }

    // --------------------------------------------------
    // FINAL OUTPUT
    // --------------------------------------------------

    return {
        method: 'North Indian Extended Manglik Analysis',

        classificationBasis:
            'लग्न, चंद्र और शुक्र से दोष की उपस्थिति के आधार पर संकेतों का विस्तार। यह सार्वभौमिक शास्त्रीय अंक-पद्धति नहीं है।',

        intensityLevel,
        intensityHindi,

        referenceSummary: {
            totalReferencesChecked: 3,
            affectedReferences: affectedCount,
            unaffectedReferences: unaffectedReferences.length,
            affectedDetails: affectedReferences,
            unaffectedDetails: unaffectedReferences
        },

        marsCondition,
        navamshaPosition,

        cancellationStatus,
        residualAssessment,

        interpretationNotes: [
            'तीनों संदर्भों की जाँच स्वतंत्र रूप से की गई है।',
            'संदर्भों की संख्या को मंगल की तीव्रता का सार्वभौमिक शास्त्रीय माप नहीं माना गया है।',
            'मंगल की स्वराशि, उच्च राशि, नीच राशि और वक्री स्थिति अलग-अलग तथ्य हैं।',
            'नवांश स्थिति को सहायक जानकारी के रूप में रखा गया है।',
            'दोष-भंग मिलने पर भी मूल मांगलिक स्थिति को मिटाया नहीं गया है।'
        ]
    };
}

function compareCoupleManglik(
    boyManglik,
    girlManglik,
    boySeverity,
    girlSeverity,
    boyCancellation,
    girlCancellation,
    boyChart,
    girlChart
) {
    const required = [
        boyManglik,
        girlManglik,
        boySeverity,
        girlSeverity,
        boyChart,
        girlChart
    ];

    if (required.some(item => !item)) {
        throw new Error(
            'Couple Manglik comparison: required data missing'
        );
    }

    const references = [
        {
            key: 'fromLagna',
            name: 'Lagna',
            hindi: 'जन्म लग्न'
        },
        {
            key: 'fromMoon',
            name: 'Moon',
            hindi: 'चंद्र लग्न'
        },
        {
            key: 'fromVenus',
            name: 'Venus',
            hindi: 'शुक्र लग्न'
        }
    ];

    const boyAffected = [];
    const girlAffected = [];
    const commonAffected = [];
    const boyOnlyAffected = [];
    const girlOnlyAffected = [];

    const referenceComparison = references.map(ref => {
        const boyResult = boyManglik[ref.key];
        const girlResult = girlManglik[ref.key];

        const boyHasDosha =
            !!(boyResult && boyResult.manglikPosition);

        const girlHasDosha =
            !!(girlResult && girlResult.manglikPosition);

        if (boyHasDosha) {
            boyAffected.push(ref.hindi);
        }

        if (girlHasDosha) {
            girlAffected.push(ref.hindi);
        }

        if (boyHasDosha && girlHasDosha) {
            commonAffected.push(ref.hindi);
        } else if (boyHasDosha) {
            boyOnlyAffected.push(ref.hindi);
        } else if (girlHasDosha) {
            girlOnlyAffected.push(ref.hindi);
        }

        return {
            reference: ref.name,
            referenceHindi: ref.hindi,

            boy: {
                manglikPosition: boyHasDosha,
                marsHouse: boyResult
                    ? boyResult.marsHouse
                    : null
            },

            girl: {
                manglikPosition: girlHasDosha,
                marsHouse: girlResult
                    ? girlResult.marsHouse
                    : null
            },

            sameStatus: boyHasDosha === girlHasDosha
        };
    });

    // --------------------------------------------------
    // RAW DOSHA COMPARISON
    // --------------------------------------------------

    const boyHasRawDosha = boyAffected.length > 0;
    const girlHasRawDosha = girlAffected.length > 0;

    let coupleStatus;
    let coupleStatusHindi;

    if (boyHasRawDosha && girlHasRawDosha) {
        coupleStatus = 'BOTH_HAVE_MANGLIK_INDICATIONS';
        coupleStatusHindi =
            'दोनों की कुंडलियों में मांगलिक दोष के संकेत हैं।';
    } else if (boyHasRawDosha) {
        coupleStatus = 'BOY_ONLY_HAS_MANGLIK_INDICATIONS';
        coupleStatusHindi =
            'लड़के की कुंडली में मांगलिक दोष के संकेत हैं। लड़की की कुंडली में इन संदर्भों से दोष नहीं मिला।';
    } else if (girlHasRawDosha) {
        coupleStatus = 'GIRL_ONLY_HAS_MANGLIK_INDICATIONS';
        coupleStatusHindi =
            'लड़की की कुंडली में मांगलिक दोष के संकेत हैं। लड़के की कुंडली में इन संदर्भों से दोष नहीं मिला।';
    } else {
        coupleStatus = 'NEITHER_HAS_MANGLIK_INDICATIONS';
        coupleStatusHindi =
            'दोनों की कुंडलियों में निर्धारित तीन संदर्भों से मांगलिक दोष का संकेत नहीं मिला।';
    }

    // --------------------------------------------------
    // SEVERITY COMPARISON
    // --------------------------------------------------

    const boyIntensity =
        boySeverity.intensityLevel || 'NOT_AVAILABLE';

    const girlIntensity =
        girlSeverity.intensityLevel || 'NOT_AVAILABLE';

    const sameIntensity = boyIntensity === girlIntensity;

    // --------------------------------------------------
    // CANCELLATION COMPARISON
    // --------------------------------------------------

    function getCancellationSummary(details) {
        return {
            status: details
                ? details.cancellationStatus
                : 'NOT_AVAILABLE',

            fullCancellationCount: details &&
                Array.isArray(details.fullCancellations)
                ? details.fullCancellations.length
                : 0,

            partialMitigationCount: details &&
                Array.isArray(details.partialMitigations)
                ? details.partialMitigations.length
                : 0
        };
    }

    const boyCancellationSummary =
        getCancellationSummary(boyCancellation);

    const girlCancellationSummary =
        getCancellationSummary(girlCancellation);

    // --------------------------------------------------
    // MARS POSITION COMPARISON
    // --------------------------------------------------

    const boyMars = boyChart.planets.mars;
    const girlMars = girlChart.planets.mars;

    if (!boyMars || !girlMars) {
        throw new Error(
            'Couple Manglik comparison: Mars chart data missing'
        );
    }

    const marsPositionComparison = {
        boy: {
            sign: boyMars.rashi,
            signIndex: boyMars.rashiIndex,
            house: boyMars.house,
            degree: boyMars.rashiDegree,
            retrograde: boyMars.retrograde
        },

        girl: {
            sign: girlMars.rashi,
            signIndex: girlMars.rashiIndex,
            house: girlMars.house,
            degree: girlMars.rashiDegree,
            retrograde: girlMars.retrograde
        },

        sameSign:
            boyMars.rashiIndex === girlMars.rashiIndex,

        sameHouse:
            boyMars.house === girlMars.house
    };

    // --------------------------------------------------
    // FINAL COMPARATIVE ASSESSMENT
    // --------------------------------------------------

    let comparisonAssessment;

    if (!boyHasRawDosha && !girlHasRawDosha) {
        comparisonAssessment =
            'निर्धारित नियमों के अनुसार दोनों में मूल मांगलिक संकेत नहीं मिले।';
    } else if (boyHasRawDosha && girlHasRawDosha) {
        comparisonAssessment =
            'दोनों में मांगलिक संकेत मौजूद हैं। समानता का परीक्षण प्रत्येक संदर्भ और दोष-भंग के प्रमाण के आधार पर किया गया है।';
    } else {
        comparisonAssessment =
            'दोनों की मांगलिक स्थिति में अंतर है। केवल इसी अंतर से विवाह को अनुचित घोषित नहीं किया जा सकता।';
    }

    return {
        method: 'North Indian Extended Manglik Couple Comparison',

        coupleStatus,
        coupleStatusHindi,

        rawDoshaComparison: {
            boyHasRawDosha,
            girlHasRawDosha,
            boyAffectedReferences: boyAffected,
            girlAffectedReferences: girlAffected,
            commonAffectedReferences: commonAffected,
            boyOnlyAffectedReferences: boyOnlyAffected,
            girlOnlyAffectedReferences: girlOnlyAffected,
            matchingReferenceCount: commonAffected.length
        },

        referenceComparison,

        severityComparison: {
            boy: {
                level: boyIntensity,
                hindi: boySeverity.intensityHindi
            },

            girl: {
                level: girlIntensity,
                hindi: girlSeverity.intensityHindi
            },

            sameIntensity
        },

        cancellationComparison: {
            boy: boyCancellationSummary,
            girl: girlCancellationSummary
        },

        marsPositionComparison,

        comparisonAssessment,

        importantNote:
            'यह तुलनात्मक ज्योतिषीय विश्लेषण है। समान मांगलिक स्थिति अपने आप दोष-भंग नहीं होती और अलग स्थिति अपने आप विवाह में बाधा सिद्ध नहीं करती। अंतिम निष्कर्ष के लिए सप्तम भाव, सप्तमेश, शुक्र, गुरु, नवांश और अष्टकूट का संयुक्त परीक्षण आवश्यक है।'
    };
            }


function getManglikEvidence(
    manglikDetails,
    chartDetails,
    cancellationDetails,
    severityDetails,
    personLabel = 'व्यक्ति'
) {
    if (
        !manglikDetails ||
        !chartDetails ||
        !chartDetails.planets ||
        !chartDetails.planets.mars ||
        !cancellationDetails ||
        !severityDetails
    ) {
        throw new Error(
            'Manglik evidence: required analysis data is missing'
        );
    }

    const mars = chartDetails.planets.mars;

    const references = [
        {
            key: 'fromLagna',
            name: 'जन्म लग्न',
            details: manglikDetails.fromLagna
        },
        {
            key: 'fromMoon',
            name: 'चंद्र लग्न',
            details: manglikDetails.fromMoon
        },
        {
            key: 'fromVenus',
            name: 'शुक्र लग्न',
            details: manglikDetails.fromVenus
        }
    ];

    const doshaEvidence = [];
    const nonDoshaEvidence = [];

    // --------------------------------------------------
    // 1. RAW MANGLIK POSITION EVIDENCE
    // --------------------------------------------------

    references.forEach(reference => {
        const result = reference.details;

        if (!result) {
            return;
        }

        const evidence = {
            reference: reference.key,
            referenceHindi: reference.name,
            marsHouse: result.marsHouse,
            checkedHouses: result.manglikHouses || [
                1, 2, 4, 7, 8, 12
            ],
            manglikPosition:
                result.manglikPosition === true
        };

        if (result.manglikPosition === true) {
            doshaEvidence.push({
                ...evidence,
                conclusion: 'MANGLIK_POSITION_FOUND',
                explanation:
                    `मंगल ${reference.name} से ${result.marsHouse}वें भाव में है। यह निर्धारित मांगलिक भावों में आता है।`
            });
        } else {
            nonDoshaEvidence.push({
                ...evidence,
                conclusion: 'MANGLIK_POSITION_NOT_FOUND',
                explanation:
                    `मंगल ${reference.name} से ${result.marsHouse}वें भाव में है। यह निर्धारित मांगलिक भावों में नहीं आता।`
            });
        }
    });

    // --------------------------------------------------
    // 2. MARS PLANETARY POSITION EVIDENCE
    // --------------------------------------------------

    const marsPositionEvidence = {
        planet: 'Mars',
        planetHindi: 'मंगल',
        sign: mars.rashi || null,
        signIndex: Number.isInteger(mars.rashiIndex)
            ? mars.rashiIndex
            : null,
        house: Number.isInteger(mars.house)
            ? mars.house
            : null,
        degreeInSign:
            mars.rashiDegree !== undefined
                ? mars.rashiDegree
                : null,
        retrograde:
            typeof mars.retrograde === 'boolean'
                ? mars.retrograde
                : null,
        navamsha: {
            sign: mars.navamshaRashi || null,
            signIndex:
                Number.isInteger(mars.navamshaRashiIndex)
                    ? mars.navamshaRashiIndex
                    : null,
            house:
                Number.isInteger(mars.navamshaHouse)
                    ? mars.navamshaHouse
                    : null,
            lord: mars.navamshaLord || null
        }
    };

    // --------------------------------------------------
    // 3. CANCELLATION / MITIGATION EVIDENCE
    // --------------------------------------------------

    const fullCancellations =
        Array.isArray(cancellationDetails.fullCancellations)
            ? cancellationDetails.fullCancellations
            : [];

    const partialMitigations =
        Array.isArray(cancellationDetails.partialMitigations)
            ? cancellationDetails.partialMitigations
            : [];

    const cancellationEvidence = {
        status:
            cancellationDetails.cancellationStatus || 'NOT_AVAILABLE',

        rawDoshaPresent:
            cancellationDetails.rawDoshaPresent === true,

        fullCancellations: fullCancellations.map(item => ({
            id: item.id,
            rule: item.rule,
            source: item.source,
            reason: item.reason
        })),

        partialMitigations: partialMitigations.map(item => ({
            id: item.id,
            rule: item.rule,
            source: item.source,
            reason: item.reason,
            classification:
                item.classification || 'REQUIRES_VALIDATION',
            fullCancellationConfirmed:
                item.fullCancellationConfirmed === true
        })),

        confirmedFullCancellationCount:
            fullCancellations.length,

        potentialMitigationCount:
            partialMitigations.length
    };

    // --------------------------------------------------
    // 4. SEVERITY EVIDENCE
    // --------------------------------------------------

    const severityEvidence = {
        level: severityDetails.intensityLevel || 'NOT_AVAILABLE',

        hindi:
            severityDetails.intensityHindi || 'उपलब्ध नहीं',

        classificationBasis:
            severityDetails.classificationBasis || null,

        affectedReferences:
            severityDetails.referenceSummary
                ? severityDetails.referenceSummary.affectedDetails
                : [],

        marsCondition:
            severityDetails.marsCondition || null,

        residualAssessment:
            severityDetails.residualAssessment || null
    };

    // --------------------------------------------------
    // 5. EVIDENCE QUALITY AND LIMITATIONS
    // --------------------------------------------------

    const limitations = [
        'मांगलिक दोष की मूल स्थिति और दोष-भंग अलग-अलग परिणाम हैं।',
        'संभावित शमन संकेत को स्वतः पूर्ण दोष-भंग नहीं माना गया है।',
        'अलग-अलग ज्योतिषीय परंपराओं के नियमों को एक समान शास्त्रीय नियम नहीं माना गया है।',
        'नवांश स्थिति सहायक प्रमाण है; केवल इसके आधार पर दोष-भंग घोषित नहीं किया गया है।',
        'अंतिम विवाह निष्कर्ष के लिए दोनों कुंडलियों के अन्य विवाह संकेतों का संयुक्त परीक्षण आवश्यक है।'
    ];

    // --------------------------------------------------
    // 6. FINAL EVIDENCE SUMMARY
    // --------------------------------------------------

    let evidenceConclusion;

    if (doshaEvidence.length === 0) {
        evidenceConclusion =
            'निर्धारित तीनों संदर्भों से मांगलिक दोष का प्रमाण नहीं मिला।';
    } else if (partialMitigations.length > 0) {
        evidenceConclusion =
            'मांगलिक दोष के प्रमाण मिले हैं और कुछ संभावित शमन संकेत भी मिले हैं। पूर्ण दोष-भंग अभी प्रमाणित नहीं है।';
    } else {
        evidenceConclusion =
            'मांगलिक दोष के प्रमाण मिले हैं। जाँचे गए नियमों में कोई संभावित शमन संकेत नहीं मिला।';
    }

    return {
        person: personLabel,

        method: 'North Indian Extended Manglik Evidence Analysis',

        rawDoshaEvidence: {
            totalReferencesChecked: references.length,
            doshaFoundCount: doshaEvidence.length,
            doshaNotFoundCount: nonDoshaEvidence.length,
            details: doshaEvidence,
            unaffectedReferences: nonDoshaEvidence
        },

        marsPositionEvidence,

        cancellationEvidence,

        severityEvidence,

        evidenceConclusion,

        limitations,

        importantNote:
            'यह गणना-आधारित ज्योतिषीय प्रमाण रिपोर्ट है। जिन परिहार नियमों का स्रोत या परंपरा अभी पूर्ण रूप से सत्यापित नहीं है, उन्हें संभावित शमन के रूप में ही दिखाया गया है।'
    };
}


function getFinalMarriageConclusion(
    ashtakootDetails,
    boyManglikEvidence,
    girlManglikEvidence,
    coupleManglikComparison,
    boyMarriageDetails,
    girlMarriageDetails,
    boyAspectDetails,
    girlAspectDetails,
    boyKarakaDetails,
    girlKarakaDetails,
    coupleKarakaComparison
) {
    const required = [
        ashtakootDetails,
        boyManglikEvidence,
        girlManglikEvidence,
        coupleManglikComparison,
        boyMarriageDetails,
        girlMarriageDetails,
        boyAspectDetails,
        girlAspectDetails,
        boyKarakaDetails,
        girlKarakaDetails,
        coupleKarakaComparison
    ];

    if (required.some(item => !item)) {
        throw new Error(
            'Final marriage conclusion: required analysis data missing'
        );
    }

    // --------------------------------------------------
    // 1. ASHTAKOOT SUMMARY
    // --------------------------------------------------

    const ashtakootScore =
    Number.isFinite(ashtakootDetails.totalScore)
        ? ashtakootDetails.totalScore
        : null;

    const ashtakootSummary = {
        score: ashtakootScore,
        maximumScore: 36,
        status: ashtakootDetails.status || 'NOT_AVAILABLE',
        doshas: ashtakootDetails.doshas || {},
        cancellations: ashtakootDetails.cancellations || {},
        rawDoshas: ashtakootDetails.rawDoshas || {}
    };

    // --------------------------------------------------
    // 2. MANGLIK SUMMARY
    // --------------------------------------------------

    const boyManglik = {
        conclusion:
            boyManglikEvidence.evidenceConclusion,

        rawDosha:
            boyManglikEvidence.rawDoshaEvidence,

        cancellation:
            boyManglikEvidence.cancellationEvidence,

        severity:
            boyManglikEvidence.severityEvidence
    };

    const girlManglik = {
        conclusion:
            girlManglikEvidence.evidenceConclusion,

        rawDosha:
            girlManglikEvidence.rawDoshaEvidence,

        cancellation:
            girlManglikEvidence.cancellationEvidence,

        severity:
            girlManglikEvidence.severityEvidence
    };

    const manglikSummary = {
        comparisonStatus:
            coupleManglikComparison.coupleStatus,

        comparisonHindi:
            coupleManglikComparison.coupleStatusHindi,

        boy: boyManglik,
        girl: girlManglik,

        referenceComparison:
            coupleManglikComparison.referenceComparison,

        comparisonAssessment:
            coupleManglikComparison.comparisonAssessment
    };

    // --------------------------------------------------
    // 3. SEVENTH HOUSE AND SEVENTH LORD
    // --------------------------------------------------

    const marriageHouseSummary = {
        boy: {
            D1: boyMarriageDetails.d1 || null,
            D9: boyMarriageDetails.d9 || null
        },

        girl: {
            D1: girlMarriageDetails.d1 || null,
            D9: girlMarriageDetails.d9 || null
        }
    };

    // --------------------------------------------------
    // 4. MARRIAGE ASPECTS
    // --------------------------------------------------

    const aspectSummary = {
        boy: {
            D1: boyAspectDetails.d1 || null,
            D9: boyAspectDetails.d9 || null
        },

        girl: {
            D1: girlAspectDetails.d1 || null,
            D9: girlAspectDetails.d9 || null
        }
    };

    // --------------------------------------------------
    // 5. VENUS AND JUPITER KARAKA ANALYSIS
    // --------------------------------------------------

    const karakaSummary = {
        boy: boyKarakaDetails,
        girl: girlKarakaDetails,

        coupleComparison: coupleKarakaComparison
    };

    // --------------------------------------------------
    // 6. POSITIVE AND CAUTIONARY INDICATORS
    // --------------------------------------------------

    const positiveIndicators = [];
    const cautionaryIndicators = [];
    const pendingChecks = [];

    if (ashtakootScore !== null) {
        positiveIndicators.push({
            area: 'Ashtakoot',
            finding:
                `अष्टकूट का प्राप्त गुण ${ashtakootScore}/36 है।`,
            interpretation:
                'अंकों को अन्य विवाह संकेतों के साथ मिलाकर समझना आवश्यक है।'
        });
    } else {
        pendingChecks.push(
            'अष्टकूट का कुल गुण उपलब्ध नहीं है।'
        );
    }

    if (
        boyManglikEvidence.rawDoshaEvidence.doshaFoundCount > 0 &&
        girlManglikEvidence.rawDoshaEvidence.doshaFoundCount > 0
    ) {
        positiveIndicators.push({
            area: 'Manglik comparison',
            finding:
                'दोनों कुंडलियों में मांगलिक संकेत पाए गए हैं।',
            interpretation:
                'दोनों की स्थिति में समानता का विस्तृत परीक्षण उपलब्ध है; केवल समान दोष होने से दोष-भंग सिद्ध नहीं होता।'
        });
    } else if (
        boyManglikEvidence.rawDoshaEvidence.doshaFoundCount > 0 ||
        girlManglikEvidence.rawDoshaEvidence.doshaFoundCount > 0
    ) {
        cautionaryIndicators.push({
            area: 'Manglik comparison',
            finding:
                'दोनों की मांगलिक स्थिति में अंतर पाया गया है।',
            interpretation:
                'दोष-भंग, तीव्रता और अन्य विवाह संकेतों के साथ इसकी समीक्षा आवश्यक है।'
        });
    } else {
        positiveIndicators.push({
            area: 'Manglik comparison',
            finding:
                'निर्धारित तीनों संदर्भों में दोनों की कुंडलियों में मूल मांगलिक दोष नहीं मिला।',
            interpretation:
                'यह केवल मांगलिक परीक्षण का परिणाम है, संपूर्ण विवाह निष्कर्ष नहीं।'
        });
    }

    if (
        boyManglikEvidence.cancellationEvidence
            .potentialMitigationCount > 0 ||
        girlManglikEvidence.cancellationEvidence
            .potentialMitigationCount > 0
    ) {
        pendingChecks.push(
            'दोष-भंग के संभावित संकेतों का परंपरा और प्रमाण के अनुसार सत्यापन आवश्यक है।'
        );
    }

    // --------------------------------------------------
    // 7. MARRIAGE HOUSE, ASPECTS AND KARAKA REVIEW
    // --------------------------------------------------

    pendingChecks.push(
        'दोनों के D1 और D9 सप्तम भाव, सप्तमेश, भावेश की स्थिति और भाव के स्वामित्व का संयुक्त मूल्यांकन आवश्यक है।'
    );

    pendingChecks.push(
        'सप्तम भाव और सप्तमेश पर शुभ तथा पाप ग्रहों की दृष्टियों का प्रभाव जाँचना आवश्यक है।'
    );

    pendingChecks.push(
        'शुक्र और गुरु की राशि, भाव, बल, युति, दृष्टि तथा नवांश स्थिति को साथ में समझना आवश्यक है।'
    );

    pendingChecks.push(
        'अंतिम विवाह निर्णय से पहले दशा और गोचर का समय-आधारित परीक्षण भी आवश्यक है।'
    );

    // --------------------------------------------------
    // 8. OVERALL CONCLUSION
    // --------------------------------------------------

    const overallAssessment = {
        status: 'PRELIMINARY_REQUIRES_ASTROLOGICAL_REVIEW',

        hindi:
            'विवाह संबंधी सभी प्रमुख ज्योतिषीय संकेत एकत्र किए गए हैं। अंतिम अनुकूलता का निर्णय करने से पहले सप्तम भाव, सप्तमेश, शुक्र, गुरु, नवांश और दशा का संयुक्त अर्थगत परीक्षण आवश्यक है।',

        positiveIndicators,
        cautionaryIndicators,
        pendingChecks
    };

    // --------------------------------------------------
    // FINAL RESPONSE
    // --------------------------------------------------

    return {
        method:
            'Integrated North Indian Marriage Compatibility Analysis',

        analysisCompleted: {
            ashtakoot: true,
            manglik: true,
            manglikComparison: true,
            manglikEvidence: true,
            seventhHouseData: true,
            marriageAspects: true,
            marriageKarakas: true,
            navamshaData: true
        },

        ashtakoot: ashtakootSummary,

        manglik: manglikSummary,

        seventhHouseAnalysis:
            marriageHouseSummary,

        marriageAspectAnalysis:
            aspectSummary,

        marriageKarakaAnalysis:
            karakaSummary,

        overallAssessment,

        finalConclusion:
            overallAssessment.hindi,

        importantNote:
            'यह संयुक्त ज्योतिषीय विश्लेषण है, विवाह की निश्चित सफलता या असफलता की भविष्यवाणी नहीं। उपलब्ध गणनाओं और प्रमाणों के आधार पर ही अंतिम व्याख्या की जानी चाहिए।'
    };
}

// ==========================================
// RADHE ASTRO - ASHTAKOOTA TABLES & HELPERS
// Reference: Muhurta Chintamani Vivaha Prakarana
// Bride = girl, Groom = boy
// ==========================================

const GRAHA_LORDS = [
    'मंगल', 'शुक्र', 'बुध', 'चंद्र',
    'सूर्य', 'बुध', 'शुक्र', 'मंगल',
    'गुरु', 'शनि', 'शनि', 'गुरु'
];

// Varna rank: 1 = Brahmin, 2 = Kshatriya,
// 3 = Vaishya, 4 = Shudra
const VARNA_BY_RASHI = [
    2, 3, 4, 1, 2, 3,
    4, 1, 2, 3, 4, 1
];

// Muhurta Chintamani Vashya classes
const VASHYA_BY_RASHI = [
    'Chatushpada', // Mesha
    'Chatushpada', // Vrishabha
    'Dvipada',     // Mithuna
    'Jalachara',   // Karka
    'Chatushpada', // Simha
    'Dvipada',     // Kanya
    'Dvipada',     // Tula
    'Keeta',       // Vrischika
    'Chatushpada', // Dhanu
    'Jalachara',   // Makara
    'Jalachara',   // Kumbha
    'Jalachara'    // Meena
];

// Vashya score matrix: bride row, groom column
const VASHYA_CLASSES = [
    'Dvipada',
    'Chatushpada',
    'Jalachara',
    'Keeta'
];

const VASHYA_MATRIX = [
    [2, 0.5, 0.5, 1],
    [0.5, 2, 2, 2],
    [0.5, 2, 2, 2],
    [1, 2, 2, 2]
];

// 27 Nakshatra Yoni assignments
const YONI_BY_NAKSHATRA = [
    'Horse', 'Elephant', 'Sheep',
    'Serpent', 'Serpent', 'Dog',
    'Cat', 'Sheep', 'Cat',
    'Rat', 'Rat', 'Cow',
    'Buffalo', 'Tiger', 'Buffalo',
    'Tiger', 'Deer', 'Deer',
    'Dog', 'Monkey', 'Mongoose',
    'Monkey', 'Lion', 'Lion',
    'Lion', 'Cow', 'Elephant'
];

const YONI_CLASSES = [
    'Horse', 'Elephant', 'Sheep', 'Serpent',
    'Dog', 'Cat', 'Rat', 'Cow', 'Buffalo',
    'Tiger', 'Deer', 'Monkey', 'Mongoose', 'Lion'
];

// Yoni matrix: bride row, groom column
// Values: 4 same, 3 friendly, 2 neutral,
// 1 enemy, 0 great enemy.
const YONI_MATRIX = [
    [4,2,3,2,2,3,3,3,0,1,3,2,2,1],
    [2,4,3,2,2,3,3,3,3,2,2,2,2,0],
    [3,3,4,3,2,3,1,3,3,1,3,0,3,1],
    [2,2,3,4,2,2,1,1,2,2,2,2,0,2],
    [2,2,2,2,4,1,1,2,2,1,0,2,2,1],
    [2,2,3,2,1,4,0,2,2,1,2,2,2,2],
    [2,2,2,1,1,0,4,2,2,2,2,2,2,1],
    [3,2,3,1,2,2,2,4,3,0,3,2,3,1],
    [0,3,3,2,2,2,2,3,4,1,2,2,2,3],
    [1,2,1,2,1,1,2,0,1,4,2,1,2,2],
    [3,2,3,2,0,2,2,3,2,1,4,2,2,2],
    [2,3,0,2,2,2,2,2,2,1,2,4,2,3],
    [2,2,3,0,2,2,2,3,2,2,2,2,4,2],
    [1,0,1,2,1,2,1,1,3,2,2,2,2,4]
];

// Graha Maitri: natural friendship matrix
// Bride's lord row, groom's lord column
const GRAHA_CLASSES = [
    'सूर्य', 'चंद्र', 'मंगल', 'बुध',
    'गुरु', 'शुक्र', 'शनि'
];

const GRAHA_MAITRI_MATRIX = [
    [5, 5, 5, 4, 5, 0, 0],
    [5, 5, 4, 1, 4, 0.5, 0.5],
    [5, 4, 5, 0.5, 5, 3, 0.5],
    [4, 1, 0.5, 5, 0.5, 5, 4],
    [5, 4, 5, 0.5, 5, 0.5, 3],
    [0, 0.5, 3, 5, 0.5, 5, 5],
    [0, 0.5, 0.5, 4, 3, 5, 5]
];

// Natural planetary friendship
// Only mutual friendship is accepted for cancellation.

const NATURAL_FRIENDS = {
    'सूर्य': ['चंद्र', 'मंगल', 'गुरु'],
    'चंद्र': ['सूर्य', 'बुध'],
    'मंगल': ['सूर्य', 'चंद्र', 'गुरु'],
    'बुध': ['सूर्य', 'शुक्र'],
    'गुरु': ['सूर्य', 'चंद्र', 'मंगल'],
    'शुक्र': ['बुध', 'शनि'],
    'शनि': ['बुध', 'शुक्र']
};

function areMutualFriends(planetA, planetB) {
    if (!planetA || !planetB) {
        return false;
    }

    if (planetA === planetB) {
        return true;
    }

    return (
        NATURAL_FRIENDS[planetA]?.includes(planetB) &&
        NATURAL_FRIENDS[planetB]?.includes(planetA)
    );
}

// Nakshatra Gana: 0-based nakshatra index
const GANA_BY_NAKSHATRA = [
    'Deva', 'Manushya', 'Rakshasa',
    'Rakshasa', 'Deva', 'Manushya',
    'Deva', 'Deva', 'Rakshasa',
    'Rakshasa', 'Manushya', 'Manushya',
    'Deva', 'Rakshasa', 'Deva',
    'Rakshasa', 'Deva', 'Rakshasa',
    'Rakshasa', 'Manushya', 'Manushya',
    'Deva', 'Rakshasa', 'Rakshasa',
    'Manushya', 'Manushya', 'Deva'
];

// Gana score matrix: bride row, groom column
const GANA_CLASSES = ['Deva', 'Manushya', 'Rakshasa'];

const GANA_MATRIX = [
    [6, 5, 1],
    [6, 6, 0],
    [0, 0, 6]
];

// Nakshatra Nadi assignments
const NADI_BY_NAKSHATRA = [
    'Adi', 'Madhya', 'Antya',
    'Antya', 'Madhya', 'Adi',
    'Adi', 'Madhya', 'Antya',
    'Antya', 'Madhya', 'Adi',
    'Adi', 'Madhya', 'Antya',
    'Antya', 'Madhya', 'Adi',
    'Adi', 'Madhya', 'Antya',
    'Antya', 'Madhya', 'Adi',
    'Adi', 'Madhya', 'Antya'
];

// ------------------------------------------
// ASHTAKOOTA COMMON HELPERS
// ------------------------------------------

function getMatrixScore(matrix, classes, brideValue, groomValue) {
    const brideIndex = classes.indexOf(brideValue);
    const groomIndex = classes.indexOf(groomValue);

    if (brideIndex < 0 || groomIndex < 0) {
        throw new Error('Invalid Ashtakoota table value.');
    }

    return matrix[brideIndex][groomIndex];
}

function getNakshatraTara(fromIndex, toIndex) {
    // Both indexes are 0-based
    const count = ((toIndex - fromIndex + 27) % 27) + 1;
    const remainder = count % 9 || 9;

    const taraNames = [
        'Janma', 'Sampat', 'Vipat',
        'Kshema', 'Pratyak', 'Sadhana',
        'Naidhana', 'Mitra', 'Parama Mitra'
    ];

    return {
        count,
        remainder,
        name: taraNames[remainder - 1],
        favorable: ![3, 5, 7].includes(remainder)
    };
}

// ------------------------------------------
// INDIVIDUAL KOOTA CALCULATIONS
// ------------------------------------------

function calculateVarna(boyMoon, girlMoon) {
    const boyVarna = VARNA_BY_RASHI[boyMoon.rashiIndex];
    const girlVarna = VARNA_BY_RASHI[girlMoon.rashiIndex];

    return {
        name: 'वर्ण',
        boyVarna,
        girlVarna,
        score: boyVarna <= girlVarna ? 1 : 0,
        maximum: 1
    };
}

function calculateVashya(boyMoon, girlMoon) {
    const boyClass = VASHYA_BY_RASHI[boyMoon.rashiIndex];
    const girlClass = VASHYA_BY_RASHI[girlMoon.rashiIndex];

    return {
        name: 'वश्य',
        boyClass,
        girlClass,
        score: getMatrixScore(
            VASHYA_MATRIX,
            VASHYA_CLASSES,
            girlClass,
            boyClass
        ),
        maximum: 2
    };
}

function calculateTara(boyMoon, girlMoon) {
    // Girl -> Boy and Boy -> Girl
    const girlToBoy = getNakshatraTara(
        girlMoon.nakshatraIndex - 1,
        boyMoon.nakshatraIndex - 1
    );

    const boyToGirl = getNakshatraTara(
        boyMoon.nakshatraIndex - 1,
        girlMoon.nakshatraIndex - 1
    );

    const score =
        girlToBoy.favorable && boyToGirl.favorable ? 3 :
        girlToBoy.favorable || boyToGirl.favorable ? 1.5 : 0;

    return {
        name: 'तारा',
        girlToBoy,
        boyToGirl,
        score,
        maximum: 3
    };
}

function calculateYoni(boyMoon, girlMoon) {
    const boyYoni = YONI_BY_NAKSHATRA[
        boyMoon.nakshatraIndex - 1
    ];

    const girlYoni = YONI_BY_NAKSHATRA[
        girlMoon.nakshatraIndex - 1
    ];

    return {
        name: 'योनि',
        boyYoni,
        girlYoni,
        score: getMatrixScore(
            YONI_MATRIX,
            YONI_CLASSES,
            girlYoni,
            boyYoni
        ),
        maximum: 4
    };
}

function calculateGrahaMaitri(boyMoon, girlMoon) {
    const boyLord = GRAHA_LORDS[boyMoon.rashiIndex];
    const girlLord = GRAHA_LORDS[girlMoon.rashiIndex];

    return {
        name: 'ग्रह मैत्री',
        boyLord,
        girlLord,
        score: getMatrixScore(
            GRAHA_MAITRI_MATRIX,
            GRAHA_CLASSES,
            girlLord,
            boyLord
        ),
        maximum: 5
    };
}


function calculateGana(boyMoon, girlMoon) {
    const boyGana = GANA_BY_NAKSHATRA[
        boyMoon.nakshatraIndex - 1
    ];

    const girlGana = GANA_BY_NAKSHATRA[
        girlMoon.nakshatraIndex - 1
    ];

    const score = getMatrixScore(
        GANA_MATRIX,
        GANA_CLASSES,
        girlGana,
        boyGana
    );

    const boyRashiLord = GRAHA_LORDS[boyMoon.rashiIndex];
    const girlRashiLord = GRAHA_LORDS[girlMoon.rashiIndex];

    const boyNavamshaLord = boyMoon.navamshaRashiLord;
    const girlNavamshaLord = girlMoon.navamshaRashiLord;

    const rashiLordsFriendly = areMutualFriends(
        boyRashiLord,
        girlRashiLord
    );

    const navamshaLordsFriendly = areMutualFriends(
        boyNavamshaLord,
        girlNavamshaLord
    );

    const dosha = score <= 1;

    const cancelled = (
        dosha &&
        rashiLordsFriendly &&
        navamshaLordsFriendly
    );

    return {
        name: 'गण',
        boyGana,
        girlGana,
        boyRashiLord,
        girlRashiLord,
        boyNavamshaLord,
        girlNavamshaLord,
        dosha,
        cancelled,
        cancellationReason: cancelled
            ? 'राशि स्वामी और नवांश स्वामी दोनों परस्पर मित्र हैं'
            : null,
        score,
        maximum: 6
    };
}

function calculateBhakoot(boyMoon, girlMoon) {
    const boyRashi = boyMoon.rashiIndex;
    const girlRashi = girlMoon.rashiIndex;

    const girlToBoy = ((boyRashi - girlRashi + 12) % 12) + 1;
    const boyToGirl = ((girlRashi - boyRashi + 12) % 12) + 1;

    const pair = [girlToBoy, boyToGirl];

    const dosha = (
        (pair.includes(2) && pair.includes(12)) ||
        (pair.includes(5) && pair.includes(9)) ||
        (pair.includes(6) && pair.includes(8))
    );

    const boyLord = GRAHA_LORDS[boyRashi];
    const girlLord = GRAHA_LORDS[girlRashi];

    const mutualFriendship = areMutualFriends(
        boyLord,
        girlLord
    );

    const sameLord = boyLord === girlLord;

    const nadiDosha = (
        NADI_BY_NAKSHATRA[boyMoon.nakshatraIndex - 1] ===
        NADI_BY_NAKSHATRA[girlMoon.nakshatraIndex - 1]
    );

    const cancelled = (
        dosha &&
        !nadiDosha &&
        (sameLord || mutualFriendship)
    );

    return {
        name: 'भकूट',
        girlToBoy,
        boyToGirl,
        boyLord,
        girlLord,
        dosha,
        cancelled,
        cancellationReason: cancelled
            ? (sameLord
                ? 'दोनों राशियों के स्वामी समान हैं'
                : 'दोनों राशि स्वामी परस्पर मित्र हैं')
            : null,
        score: dosha ? 0 : 7,
        maximum: 7
    };
}


function calculateNadi(boyMoon, girlMoon) {
    const boyNadi = NADI_BY_NAKSHATRA[
        boyMoon.nakshatraIndex - 1
    ];

    const girlNadi = NADI_BY_NAKSHATRA[
        girlMoon.nakshatraIndex - 1
    ];

    const dosha = boyNadi === girlNadi;

    // Traditional Nadi Dosha exceptions
    const sameRashi =
        boyMoon.rashiIndex === girlMoon.rashiIndex;

    const sameNakshatra =
        boyMoon.nakshatraIndex === girlMoon.nakshatraIndex;

    const differentNakshatra =
        !sameNakshatra;

    const differentRashi =
        !sameRashi;

    const differentPada =
        boyMoon.pada !== girlMoon.pada;

    const exceptionSameRashiDifferentNakshatra =
        sameRashi && differentNakshatra;

    const exceptionSameNakshatraDifferentRashi =
        sameNakshatra && differentRashi;

    const exceptionSameNakshatraDifferentPada =
        sameNakshatra && sameRashi && differentPada;

    const cancelled = (
        dosha &&
        (
            exceptionSameRashiDifferentNakshatra ||
            exceptionSameNakshatraDifferentRashi ||
            exceptionSameNakshatraDifferentPada
        )
    );

    let cancellationReason = null;

    if (cancelled) {
        if (exceptionSameRashiDifferentNakshatra) {
            cancellationReason =
                'समान राशि में अलग-अलग नक्षत्र';
        } else if (exceptionSameNakshatraDifferentRashi) {
            cancellationReason =
                'समान नक्षत्र में अलग-अलग राशियाँ';
        } else {
            cancellationReason =
                'समान नक्षत्र और राशि में अलग-अलग पद';
        }
    }

    return {
        name: 'नाड़ी',
        boyNadi,
        girlNadi,
        dosha,
        cancelled,
        cancellationReason,
        score: dosha ? 0 : 8,
        maximum: 8
    };
}

// ------------------------------------------
// COMPLETE ASHTAKOOTA CALCULATION
// ------------------------------------------


function calculateAshtakoota(boyMoon, girlMoon) {
    const kootas = [
        calculateVarna(boyMoon, girlMoon),
        calculateVashya(boyMoon, girlMoon),
        calculateTara(boyMoon, girlMoon),
        calculateYoni(boyMoon, girlMoon),
        calculateGrahaMaitri(boyMoon, girlMoon),
        calculateGana(boyMoon, girlMoon),
        calculateBhakoot(boyMoon, girlMoon),
        calculateNadi(boyMoon, girlMoon)
    ];

    const gana = kootas[5];
    const bhakoot = kootas[6];
    const nadi = kootas[7];

    // 1. Apply Nadi exception to Gana Dosha
    if (nadi.cancelled && gana.dosha) {
        gana.cancelled = true;

        gana.cancellationReason =
            'नाड़ी अपवाद के कारण गण दोष भी निरस्त';

        gana.nadiExceptionApplied = true;
    } else {
        gana.nadiExceptionApplied = false;
    }

    // 2. Recheck Bhakoot cancellation
    // Nadi Dosha must not remain active.
    const activeNadiDosha =
        nadi.dosha && !nadi.cancelled;

    const sameRashiLord =
        bhakoot.boyLord === bhakoot.girlLord;

    const mutualRashiFriendship = areMutualFriends(
        bhakoot.boyLord,
        bhakoot.girlLord
    );

    if (
        bhakoot.dosha &&
        !activeNadiDosha &&
        (sameRashiLord || mutualRashiFriendship)
    ) {
        bhakoot.cancelled = true;

        bhakoot.cancellationReason = sameRashiLord
            ? 'समान राशि स्वामी तथा सक्रिय नाड़ी दोष नहीं'
            : 'राशि स्वामी परस्पर मित्र तथा सक्रिय नाड़ी दोष नहीं';
    }

    // 3. Calculate original Ashtakoota score
    // Cancellation does not automatically restore points.
    const totalScore = Number(
        kootas.reduce(
            (sum, item) => sum + item.score,
            0
        ).toFixed(2)
    );

    // 4. Final active dosha status
    const doshas = {
        gana: gana.dosha && !gana.cancelled,
        bhakoot: bhakoot.dosha && !bhakoot.cancelled,
        nadi: nadi.dosha && !nadi.cancelled
    };

    return {
        status: 'EXCEPTION_CHECKED_REQUIRES_TRADITIONAL_VALIDATION',

        method: 'North Indian Ashtakoota - Muhurta Chintamani',

        totalScore,

        totalMaximumPoints: 36,

        kootas,

        rawDoshas: {
            gana: gana.dosha,
            bhakoot: bhakoot.dosha,
            nadi: nadi.dosha
        },

        doshas,

        cancellations: {
            gana: {
                cancelled: !!gana.cancelled,
                reason: gana.cancellationReason || null
            },

            bhakoot: {
                cancelled: !!bhakoot.cancelled,
                reason: bhakoot.cancellationReason || null
            },

            nadi: {
                cancelled: !!nadi.cancelled,
                reason: nadi.cancellationReason || null
            }
        },

        note:
            'Base Ashtakoota score is preserved. Traditional exception checks are applied separately. Final horoscope review is still required.'
    };
}


// ------------------------------------------
// BIRTH DETAILS VALIDATION
// ------------------------------------------

function validatePerson(person, label) {
    if (!person || typeof person !== 'object') {
        throw new Error(label + ': birth details are missing.');
    }

    const date = parseDate(person.dob);
    const time = parseTime(person.tob);

    if (!date) {
        throw new Error(label + ': invalid date of birth.');
    }

    if (!time) {
        throw new Error(label + ': invalid time of birth.');
    }

    if (!person.pob || typeof person.pob !== 'string') {
        throw new Error(label + ': birth place is required.');
    }

    const latitude = Number(person.latitude);
    const longitude = Number(person.longitude);

    if (
        person.latitude === undefined ||
        person.longitude === undefined ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 ||
        longitude < -180 || longitude > 180
    ) {
        throw new Error(
            label + ': valid latitude and longitude are required.'
        );
    }

    let timezoneName = person.timezoneName;

    if (!timezoneName) {
        const zones = find(latitude, longitude);
        timezoneName = zones && zones[0];
    }

    if (!timezoneName || typeof timezoneName !== 'string') {
        throw new Error(
            label + ': birth place timezone could not be determined.'
        );
    }

    return {
        name: String(person.name || label).slice(0, 100),
        pob: person.pob,
        date,
        time,
        latitude,
        longitude,
        timezoneName
    };
}

// ------------------------------------------
// HEALTH CHECK
// ------------------------------------------

app.get('/api/matchmaking', (req, res) => {
    return res.json({
        success: true,
        service: 'Radhe Astro Kundali Matchmaking',
        endpoint: '/api/matchmaking',
        engine: '@astrologer/ephemera 0.4.1',
        ayanamsha: 'Lahiri',
        status: 'running'
    });
});

// ------------------------------------------
// MATCHMAKING CALCULATION
// ------------------------------------------


app.post('/api/matchmaking', async (req, res) => {
    try {
        const { boy, girl } = req.body || {};

        if (!boy || !girl) {
            return res.status(400).json({
                success: false,
                message: 'Boy and girl birth details are required.'
            });
        }

        const boyData = validatePerson(boy, 'Boy');
        const girlData = validatePerson(girl, 'Girl');

        const boyUTC = localBirthToUTC(
            boyData.date,
            boyData.time,
            boyData.timezoneName
        );

        const girlUTC = localBirthToUTC(
            girlData.date,
            girlData.time,
            girlData.timezoneName
        );

        const { eph, Body, Ayanamsa } = await getEphemera();

        // 1. Moon details
        const boyMoon = getMoonDetails(
            eph, Body, Ayanamsa, boyUTC
        );

        const girlMoon = getMoonDetails(
            eph, Body, Ayanamsa, girlUTC
        );

        // 2. Raw Manglik details
        const boyManglik = getManglikDetails(
            eph, Body, Ayanamsa,
            boyUTC,
            boyData.latitude,
            boyData.longitude,
            boyMoon
        );

        const girlManglik = getManglikDetails(
            eph, Body, Ayanamsa,
            girlUTC,
            girlData.latitude,
            girlData.longitude,
            girlMoon
        );

        // 3. Full planetary charts
        const boyChart = getFullChartDetails(
            eph, Body, Ayanamsa,
            boyUTC,
            boyData.latitude,
            boyData.longitude
        );

        const girlChart = getFullChartDetails(
            eph, Body, Ayanamsa,
            girlUTC,
            girlData.latitude,
            girlData.longitude
        );

        // 4. Marriage house details
        const boyMarriage = getMarriageHouseDetails(boyChart);
        const girlMarriage = getMarriageHouseDetails(girlChart);

        // 5. Marriage aspects
        const boyMarriageAspects =
            getMarriageAspectDetails(boyChart, boyMarriage);

        const girlMarriageAspects =
            getMarriageAspectDetails(girlChart, girlMarriage);

        // 6. Marriage karaka details
        const boyMarriageKaraka =
            getMarriageKarakaDetails(boyChart, boyMarriage);

        const girlMarriageKaraka =
            getMarriageKarakaDetails(girlChart, girlMarriage);

        // 7. Panchadha Maitri
        const boyPanchadhaMaitri =
            getPanchadhaMaitriDetails(boyChart);

        const girlPanchadhaMaitri =
            getPanchadhaMaitriDetails(girlChart);

        // 8. Couple karaka comparison
        const coupleKarakaComparison =
            getCoupleKarakaComparison(boyChart, girlChart);

        // 9. Ashtakoot calculation
        const ashtakoot =
            calculateAshtakoota(boyMoon, girlMoon);

        // 10. Traditional Manglik dosha cancellation analysis
        const boyManglikCancellation =
            getManglikDoshaCancellation(boyManglik, boyChart);

        const girlManglikCancellation =
            getManglikDoshaCancellation(girlManglik, girlChart);

        // 11. Manglik severity analysis
        const boyManglikSeverity =
            getManglikSeverity(
                boyManglik,
                boyChart,
                boyManglikCancellation
            );

        const girlManglikSeverity =
            getManglikSeverity(
                girlManglik,
                girlChart,
                girlManglikCancellation
            );

        // 12. Couple Manglik comparison
        const coupleManglikComparison =
            compareCoupleManglik(
                boyManglik,
                girlManglik,
                boyManglikSeverity,
                girlManglikSeverity,
                boyManglikCancellation,
                girlManglikCancellation,
                boyChart,
                girlChart
            );

        // 13. Manglik evidence for both persons
        const boyManglikEvidence =
            getManglikEvidence(
                boyManglik,
                boyChart,
                boyManglikCancellation,
                boyManglikSeverity,
                boyData.name
            );

        const girlManglikEvidence =
            getManglikEvidence(
                girlManglik,
                girlChart,
                girlManglikCancellation,
                girlManglikSeverity,
                girlData.name
            );

        // 14. Combined preliminary marriage conclusion
        const finalMarriageConclusion =
            getFinalMarriageConclusion(
                ashtakoot,
                boyManglikEvidence,
                girlManglikEvidence,
                coupleManglikComparison,
                boyMarriage,
                girlMarriage,
                boyMarriageAspects,
                girlMarriageAspects,
                boyMarriageKaraka,
                girlMarriageKaraka,
                coupleKarakaComparison
            );

        // 15. API response
        return res.status(200).json({
            success: true,

            service: 'Radhe Astro Kundali Matchmaking',

            engine: 'Ephemera 0.4.1',

            calculation:
                'Lahiri Sidereal - Moon, Ascendant and Planetary Positions',

            ayanamsha: 'Lahiri',

            boy: {
                name: boyData.name,
                birthPlace: boyData.pob,
                birthUTC: boyUTC.toISOString(),
                timezoneName: boyData.timezoneName,
                latitude: boyData.latitude,
                longitude: boyData.longitude,

                moon: boyMoon,
                manglik: boyManglik,
                chart: boyChart,
                marriage: boyMarriage,
                marriageAspects: boyMarriageAspects,
                marriageKaraka: boyMarriageKaraka,
                panchadhaMaitri: boyPanchadhaMaitri,

                manglikCancellation: boyManglikCancellation,
                manglikSeverity: boyManglikSeverity,
                manglikEvidence: boyManglikEvidence
            },

            girl: {
                name: girlData.name,
                birthPlace: girlData.pob,
                birthUTC: girlUTC.toISOString(),
                timezoneName: girlData.timezoneName,
                latitude: girlData.latitude,
                longitude: girlData.longitude,

                moon: girlMoon,
                manglik: girlManglik,
                chart: girlChart,
                marriage: girlMarriage,
                marriageAspects: girlMarriageAspects,
                marriageKaraka: girlMarriageKaraka,
                panchadhaMaitri: girlPanchadhaMaitri,

                manglikCancellation: girlManglikCancellation,
                manglikSeverity: girlManglikSeverity,
                manglikEvidence: girlManglikEvidence
            },

            coupleKarakaComparison: coupleKarakaComparison,

            coupleManglikComparison: coupleManglikComparison,

            ashtakoot: ashtakoot,

            finalMarriageConclusion: finalMarriageConclusion
        });

    } catch (error) {
        console.error(
            'MATCHMAKING API ERROR:',
            error.stack || error.message
        );

        return res.status(400).json({
            success: false,
            message: error.message ||
                'Kundali matchmaking calculation failed.'
        });
    }
});

// ------------------------------------------
// VERCEL SERVERLESS EXPORT
// ------------------------------------------

module.exports = app;

// Local development
if (require.main === module) {
    const PORT = process.env.PORT || 3001;

    app.listen(PORT, () => {
        console.log(
            'Radhe Astro Matchmaking Backend running on port ' + PORT
        );
    });
          }
