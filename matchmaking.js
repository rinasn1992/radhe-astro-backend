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

    const nakshatraIndex = Math.floor(
        longitude / NAKSHATRA_SIZE
    );

    const nakshatraStart =
        nakshatraIndex * NAKSHATRA_SIZE;

    const pada = Math.floor(
        (longitude - nakshatraStart) / PADA_SIZE
    ) + 1;

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
            (longitude - rashiIndex * 30).toFixed(6)
        ),

        nakshatra: NAKSHATRAS[nakshatraIndex],

        nakshatraIndex: nakshatraIndex + 1,

        pada
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

    return {
        name: 'गण',
        boyGana,
        girlGana,
        score: getMatrixScore(
            GANA_MATRIX,
            GANA_CLASSES,
            girlGana,
            boyGana
        ),
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
        pair.includes(2) && pair.includes(12)
    ) || (
        pair.includes(5) && pair.includes(9)
    ) || (
        pair.includes(6) && pair.includes(8)
    );

    return {
        name: 'भकूट',
        girlToBoy,
        boyToGirl,
        dosha,
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

    return {
        name: 'नाड़ी',
        boyNadi,
        girlNadi,
        dosha,
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

    const totalScore = Number(
        kootas.reduce((sum, item) => sum + item.score, 0).toFixed(2)
    );

    return {
        status: 'BASE_CALCULATED_REQUIRES_VALIDATION',
        method: 'North Indian Ashtakoota - Muhurta Chintamani',
        totalScore,
        totalMaximumPoints: 36,
        kootas,
        doshas: {
            bhakoot: kootas[6].dosha,
            nadi: kootas[7].dosha
        },
        note:
            'Base Ashtakoota scores calculated. Dosha cancellation and final traditional review are not yet applied.'
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

        const boyMoon = getMoonDetails(
            eph,
            Body,
            Ayanamsa,
            boyUTC
        );

        const girlMoon = getMoonDetails(
            eph,
            Body,
            Ayanamsa,
            girlUTC
        );

        return res.status(200).json({
            success: true,

            service: 'Radhe Astro Kundali Matchmaking',

            engine: 'Ephemera 0.4.1',

            calculation: 'Geocentric Sidereal',

            ayanamsha: 'Lahiri',

            boy: {
                name: boyData.name,
                birthPlace: boyData.pob,
                birthUTC: boyUTC.toISOString(),
                timezoneName: boyData.timezoneName,
                latitude: boyData.latitude,
                longitude: boyData.longitude,
                moon: boyMoon
            },

            girl: {
                name: girlData.name,
                birthPlace: girlData.pob,
                birthUTC: girlUTC.toISOString(),
                timezoneName: girlData.timezoneName,
                latitude: girlData.latitude,
                longitude: girlData.longitude,
                moon: girlMoon
            },

            
ashtakoot: calculateAshtakoota(boyMoon, girlMoon)
            
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
