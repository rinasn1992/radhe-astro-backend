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

            ashtakoot: {
                status: 'PENDING_VALIDATION',
                totalMaximumPoints: 36,
                message:
                    'Moon positions calculated. Ashtakoot scoring tables and compatibility rules must be validated before issuing a guna score.'
            }
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
