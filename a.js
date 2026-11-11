const express = require('express');
const cors = require('cors');
const { find } = require('geo-tz');
const Astronomy = require('astronomy-engine');
const app = express();

app.use(cors({
    origin: process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',').map(x => x.trim())
        : true
}));

app.use(express.json({ limit: '32kb' }));

// Root Route
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Radhe Astro Backend API is running successfully!'
    });
});

// Date validation
function parseBirthDate(dob) {
    if (typeof dob !== 'string') return null;

    const match = dob.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const date = Number(match[3]);

    const check = new Date(Date.UTC(year, month - 1, date));

    if (
        check.getUTCFullYear() !== year ||
        check.getUTCMonth() + 1 !== month ||
        check.getUTCDate() !== date ||
        year < 1
    ) return null;

    return { year, month, date };
}

// Time validation
function parseBirthTime(tob) {
    if (typeof tob !== 'string') return null;

    const match = tob.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) return null;

    return {
        hours: Number(match[1]),
        minutes: Number(match[2])
    };
}

// Convert IANA timezone into birth-date-specific UTC offset
function getTimezoneOffsetHours(timeZone, dateParts, timeParts) {
    try {
        const inputUTC = Date.UTC(
            dateParts.year,
            dateParts.month - 1,
            dateParts.date,
            timeParts.hours,
            timeParts.minutes
        );

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

        const parts = formatter.formatToParts(new Date(inputUTC));
        const values = {};

        for (const part of parts) {
            if (part.type !== 'literal') {
                values[part.type] = Number(part.value);
            }
        }

        const localAsUTC = Date.UTC(
            values.year,
            values.month - 1,
            values.day,
            values.hour,
            values.minute,
            values.second
        );

        return (localAsUTC - inputUTC) / 3600000;

    } catch (error) {
        return null;
    }
}

// Birth Place Search Route - Photon + OpenStreetMap
app.get('/api/places', async (req, res) => {
    try {
        const query = String(req.query.q || '').trim();

        if (query.length < 2) {
            return res.json({
                success: true,
                places: []
            });
        }

        if (query.length > 100) {
            return res.status(400).json({
                success: false,
                message: 'Search text is too long.'
            });
        }

        const photonUrl = new URL(
            'https://photon.komoot.io/api/'
        );

        photonUrl.searchParams.set('q', query);
        photonUrl.searchParams.set('limit', '8');
        photonUrl.searchParams.set('lang', 'en');

        const response = await fetch(photonUrl, {
            headers: {
                'User-Agent': 'RadheAstro/1.0'
            },
            signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
            throw new Error('Place search service unavailable');
        }

        const data = await response.json();

        const places = (data.features || [])
            .map(feature => {
                const properties = feature.properties || {};
                const coordinates =
                    feature.geometry?.coordinates || [];

                const longitude = Number(coordinates[0]);
                const latitude = Number(coordinates[1]);

                if (
                    !Number.isFinite(latitude) ||
                    !Number.isFinite(longitude) ||
                    latitude < -90 || latitude > 90 ||
                    longitude < -180 || longitude > 180
                ) {
                    return null;
                }

                const timezoneList = find(latitude, longitude);
                const timezoneName = timezoneList[0];

                if (!timezoneName) return null;

                const parts = [
                    properties.name,
                    properties.city,
                    properties.district,
                    properties.state,
                    properties.country
                ].filter(Boolean);

                const displayName = [...new Set(parts)].join(', ');

                return {
                    id: [
                        properties.osm_type || '',
                        properties.osm_id || '',
                        latitude,
                        longitude
                    ].join('-'),

                    name: properties.name || displayName,
                    displayName,
                    latitude,
                    longitude,
                    timezoneName
                };
            })
            .filter(Boolean);

        return res.json({
            success: true,
            places
        });

    } catch (error) {
        console.error('Place Search Error:', error.message);

        return res.status(502).json({
            success: false,
            message: 'Could not search birth places. Please try again.'
        });
    }
});

// Navamsha API Route
app.post('/api/navamsha', async (req, res) => {
    try {
        const {
            name,
            dob,
            tob,
            pob,
            latitude,
            longitude,
            timezone,
            timezoneName
        } = req.body || {};

        // Required birth details
        if (!dob || !tob || !pob) {
            return res.status(400).json({
                success: false,
                message: 'Date of birth, time of birth and place of birth are required.'
            });
        }

        const dateParts = parseBirthDate(dob);
        const timeParts = parseBirthTime(tob);

        if (!dateParts || !timeParts) {
            return res.status(400).json({
                success: false,
                message: 'Invalid date or time. Use YYYY-MM-DD and HH:mm format.'
            });
        }

        // Validate real coordinates
        const lat = Number(latitude);
        const lon = Number(longitude);

        if (
            latitude === undefined ||
            longitude === undefined ||
            !Number.isFinite(lat) ||
            !Number.isFinite(lon) ||
            lat < -90 || lat > 90 ||
            lon < -180 || lon > 180
        ) {
            return res.status(400).json({
                success: false,
                message: 'Valid latitude and longitude are required.'
            });
        }

        // Get date-specific timezone offset
        let tz;

        if (timezoneName) {
            if (typeof timezoneName !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid timezone name.'
                });
            }

            tz = getTimezoneOffsetHours(
                timezoneName,
                dateParts,
                timeParts
            );

            if (tz === null || !Number.isFinite(tz)) {
                return res.status(400).json({
                    success: false,
                    message: 'Could not calculate the birth-place timezone.'
                });
            }

        } else {
            // Backward compatibility with existing frontend
            tz = Number(timezone);

            if (
                timezone === undefined ||
                !Number.isFinite(tz) ||
                tz < -14 || tz > 14
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Valid timezone or timezoneName is required.'
                });
            }
        }

        // Read secret from Vercel Environment Variables
        const apiKey = process.env.NAVAMSHA_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                success: false,
                message: 'NAVAMSHA_API_KEY is missing in Vercel Environment Variables.'
            });
        }

        // Navamsha birth-data payload
        const apiPayload = {
            ...dateParts,
            ...timeParts,
            latitude: lat,
            longitude: lon,
            timezone: tz
        };

        const apiResponse = await fetch(
            'https://api.navamsha.in/api/v1/astrology/kundli/advanced',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey
                },
                body: JSON.stringify(apiPayload),
                signal: AbortSignal.timeout(25000)
            }
        );

        const responseText = await apiResponse.text();

        let result;

        try {
            result = JSON.parse(responseText);
        } catch {
            return res.status(502).json({
                success: false,
                message: 'Navamsha API returned an invalid response.'
            });
        }

        if (
            !apiResponse.ok ||
            (result.statusCode && Number(result.statusCode) >= 400)
        ) {
            return res.status(502).json({
                success: false,
                message: result.message ||
                    result.error ||
                    'Navamsha API request failed.',
                providerStatus: result.statusCode || apiResponse.status
            });
        }

        const planetDetails = result.output || result;
console.log("RADHE COMPLETE NAVAMSHA PROVIDER DATA:", JSON.stringify(result, null, 2));
        if (
            !planetDetails ||
            typeof planetDetails !== 'object'
        ) {
            return res.status(502).json({
                success: false,
                message: 'Navamsha API did not return valid astrology data.'
            });
        }

        // D-1 Basic Kundali API
        let d1Details = null;
        let d1Error = null;

        try {
            const d1ApiResponse = await fetch(
                'https://api.navamsha.in/api/v1/kundali/basic',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': apiKey
                    },
                    body: JSON.stringify(apiPayload),
                    signal: AbortSignal.timeout(25000)
                }
            );

            const d1ResponseText = await d1ApiResponse.text();

            let d1Result;

            try {
                d1Result = JSON.parse(d1ResponseText);
            } catch {
                throw new Error('D-1 API returned invalid JSON.');
            }

            if (
                !d1ApiResponse.ok ||
                (d1Result.statusCode &&
                 Number(d1Result.statusCode) >= 400)
            ) {
                throw new Error(
                    d1Result.message ||
                    d1Result.error ||
                    'D-1 API request failed.'
                );
            }

            d1Details = d1Result.output || d1Result;

            if (
                !d1Details ||
                typeof d1Details !== 'object'
            ) {
                throw new Error('D-1 data is invalid.');
            }

            console.log(
                'RADHE D1 COMPLETE DATA:',
                JSON.stringify(d1Details, null, 2)
            );

        } catch (d1FetchError) {
            d1Error = d1FetchError.name === 'TimeoutError'
                ? 'D-1 API request timed out.'
                : d1FetchError.message;

            console.error('RADHE D1 API ERROR:', d1Error);
        }

        
        // D-2 Hora Divisional Chart API
        let d2Details = null;
        let d2Error = null;

        try {
            const d2ApiResponse = await fetch(
                'https://api.navamsha.in/api/v1/divisional/d2',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': apiKey
                    },
                    body: JSON.stringify(apiPayload),
                    signal: AbortSignal.timeout(25000)
                }
            );

            const d2ResponseText = await d2ApiResponse.text();

            let d2Result;

            try {
                d2Result = JSON.parse(d2ResponseText);
            } catch {
                throw new Error('D-2 API returned invalid JSON.');
            }

            if (
                !d2ApiResponse.ok ||
                (d2Result.statusCode &&
                 Number(d2Result.statusCode) >= 400)
            ) {
                throw new Error(
                    d2Result.message ||
                    d2Result.error ||
                    'D-2 API request failed.'
                );
            }

            d2Details = d2Result.output || d2Result;

            if (
                !d2Details ||
                typeof d2Details !== 'object'
            ) {
                throw new Error('D-2 data is invalid.');
            }

            console.log(
                'RADHE D2 COMPLETE DATA:',
                JSON.stringify(d2Details, null, 2)
            );

        } catch (d2FetchError) {
            d2Error = d2FetchError.name === 'TimeoutError'
                ? 'D-2 API request timed out.'
                : d2FetchError.message;

            console.error('RADHE D2 API ERROR:', d2Error);
        }
        
        // D-3 Drekkana Divisional Chart API
        let d3Details = null;
        let d3Error = null;

        try {
            const d3ApiResponse = await fetch(
                'https://api.navamsha.in/api/v1/divisional/d3',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': apiKey
                    },
                    body: JSON.stringify(apiPayload),
                    signal: AbortSignal.timeout(25000)
                }
            );

            const d3ResponseText = await d3ApiResponse.text();
            let d3Result;

            try {
                d3Result = JSON.parse(d3ResponseText);
            } catch {
                throw new Error('D-3 API returned invalid JSON.');
            }

            if (
                !d3ApiResponse.ok ||
                (d3Result.statusCode &&
                 Number(d3Result.statusCode) >= 400)
            ) {
                throw new Error(
                    d3Result.message ||
                    d3Result.error ||
                    'D-3 API request failed.'
                );
            }

            d3Details = d3Result.output || d3Result;

            if (!d3Details || typeof d3Details !== 'object') {
                throw new Error('D-3 data is invalid.');
            }

            console.log(
                'RADHE D3 COMPLETE DATA:',
                JSON.stringify(d3Details, null, 2)
            );

        } catch (d3FetchError) {
            d3Error = d3FetchError.name === 'TimeoutError'
                ? 'D-3 API request timed out.'
                : d3FetchError.message;

            console.error('RADHE D3 API ERROR:', d3Error);
        }


        // D-4 Chaturthamsa Divisional Chart API
        let d4Details = null;
        let d4Error = null;

        try {
            const d4ApiResponse = await fetch(
                'https://api.navamsha.in/api/v1/divisional/d4',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': apiKey
                    },
                    body: JSON.stringify(apiPayload),
                    signal: AbortSignal.timeout(25000)
                }
            );

            const d4ResponseText = await d4ApiResponse.text();
            let d4Result;

            try {
                d4Result = JSON.parse(d4ResponseText);
            } catch {
                throw new Error('D-4 API returned invalid JSON.');
            }

            if (
                !d4ApiResponse.ok ||
                (d4Result.statusCode &&
                 Number(d4Result.statusCode) >= 400)
            ) {
                throw new Error(
                    d4Result.message ||
                    d4Result.error ||
                    'D-4 API request failed.'
                );
            }

            d4Details = d4Result.output || d4Result;

            if (!d4Details || typeof d4Details !== 'object') {
                throw new Error('D-4 data is invalid.');
            }

            console.log(
                'RADHE D4 COMPLETE DATA:',
                JSON.stringify(d4Details, null, 2)
            );

        } catch (d4FetchError) {
            d4Error = d4FetchError.name === 'TimeoutError'
                ? 'D-4 API request timed out.'
                : d4FetchError.message;

            console.error('RADHE D4 API ERROR:', d4Error);
        }
        // D-7 Saptamamsa Divisional Chart API
let d7Details = null;
let d7Error = null;

try {
    const d7ApiResponse = await fetch(
        'https://api.navamsha.in/api/v1/divisional/d7',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey
            },
            body: JSON.stringify(apiPayload),
            signal: AbortSignal.timeout(25000)
        }
    );

    const d7ResponseText = await d7ApiResponse.text();
    let d7Result;

    try {
        d7Result = JSON.parse(d7ResponseText);
    } catch {
        throw new Error('D-7 API returned invalid JSON.');
    }

    if (
        !d7ApiResponse.ok ||
        (d7Result.statusCode &&
         Number(d7Result.statusCode) >= 400)
    ) {
        throw new Error(
            d7Result.message ||
            d7Result.error ||
            'D-7 API request failed.'
        );
    }

    d7Details = d7Result.output || d7Result;

    if (!d7Details || typeof d7Details !== 'object') {
        throw new Error('D-7 data is invalid.');
    }

    console.log(
        'RADHE D7 COMPLETE DATA:',
        JSON.stringify(d7Details, null, 2)
    );

} catch (d7FetchError) {
    d7Error = d7FetchError.name === 'TimeoutError'
        ? 'D-7 API request timed out.'
        : d7FetchError.message;

    console.error('RADHE D7 API ERROR:', d7Error);
}


// D-9 Navamsha Divisional Chart API
let d9Details = null;
let d9Error = null;

try {
    const d9ApiResponse = await fetch(
        'https://api.navamsha.in/api/v1/divisional/d9',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey
            },
            body: JSON.stringify(apiPayload),
            signal: AbortSignal.timeout(25000)
        }
    );

    const d9ResponseText = await d9ApiResponse.text();
    let d9Result;

    try {
        d9Result = JSON.parse(d9ResponseText);
    } catch {
        throw new Error('D-9 API returned invalid JSON.');
    }

    if (
        !d9ApiResponse.ok ||
        (d9Result.statusCode &&
         Number(d9Result.statusCode) >= 400)
    ) {
        throw new Error(
            d9Result.message ||
            d9Result.error ||
            'D-9 API request failed.'
        );
    }

    d9Details = d9Result.output || d9Result;

    if (!d9Details || typeof d9Details !== 'object') {
        throw new Error('D-9 data is invalid.');
    }

    console.log(
        'RADHE D9 COMPLETE DATA:',
        JSON.stringify(d9Details, null, 2)
    );

} catch (d9FetchError) {
    d9Error = d9FetchError.name === 'TimeoutError'
        ? 'D-9 API request timed out.'
        : d9FetchError.message;

    console.error('RADHE D9 API ERROR:', d9Error);
}

// ==========================================
// RADHE ASTRO - D5, D6, D8, D10, D11, D12
// Divisional Chart API Calls
// ==========================================

async function fetchRadheDivisionalChart(chartCode) {
    let chartDetails = null;
    let chartError = null;

    try {
        const apiResponse = await fetch(
            `https://api.navamsha.in/api/v1/divisional/${chartCode.toLowerCase()}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey
                },
                body: JSON.stringify(apiPayload),
                signal: AbortSignal.timeout(25000)
            }
        );

        const responseText = await apiResponse.text();
        let result;

        try {
            result = JSON.parse(responseText);
        } catch {
            throw new Error(`${chartCode} API returned invalid JSON.`);
        }

        if (
            !apiResponse.ok ||
            (result.statusCode &&
             Number(result.statusCode) >= 400)
        ) {
            throw new Error(
                result.message ||
                result.error ||
                `${chartCode} API request failed.`
            );
        }

        chartDetails = result.output || result;

        if (
            !chartDetails ||
            typeof chartDetails !== 'object'
        ) {
            throw new Error(`${chartCode} data is invalid.`);
        }

        console.log(
            `RADHE ${chartCode} COMPLETE DATA:`,
            JSON.stringify(chartDetails, null, 2)
        );

    } catch (fetchError) {
        chartError = fetchError.name === 'TimeoutError'
            ? `${chartCode} API request timed out.`
            : fetchError.message;

        console.error(
            `RADHE ${chartCode} API ERROR:`,
            chartError
        );
    }

    return {
        details: chartDetails,
        error: chartError
    };
}


// D-5 Panchamsha
const {
    details: d5Details,
    error: d5Error
} = await fetchRadheDivisionalChart('D5');


// D-6 Shashtamsha
const {
    details: d6Details,
    error: d6Error
} = await fetchRadheDivisionalChart('D6');


// D-8 Ashtamsha
const {
    details: d8Details,
    error: d8Error
} = await fetchRadheDivisionalChart('D8');


// D-10 Dashamsha
const {
    details: d10Details,
    error: d10Error
} = await fetchRadheDivisionalChart('D10');


// D-11 Rudramsha
const {
    details: d11Details,
    error: d11Error
} = await fetchRadheDivisionalChart('D11');


// D-12 Dwadashamsha
const {
    details: d12Details,
    error: d12Error
} = await fetchRadheDivisionalChart('D12');
        
        // Frontend response
        return res.json({
            success: true,
            message: 'Navamsha data fetched successfully',
planetDetails,
d1Details,
d1Error,
d2Details,
d2Error,
d3Details,
d3Error,
d4Details,
d4Error,
d7Details,
d7Error,
d9Details,
d9Error,
d5Details,
d5Error,
d6Details,
d6Error,
d8Details,
d8Error,
d10Details,
d10Error,
d11Details,
d11Error,
d12Details,
d12Error,
            

            birthDetails: {
                name: name || '',
                dob,
                tob,
                pob,
                latitude: lat,
                longitude: lon,
                timezone: tz,
                timezoneName: timezoneName || ''
            }
        });

    } catch (error) {
        console.error('API Error:', error.message);

        return res.status(500).json({
            success: false,
            message: error.name === 'TimeoutError'
                ? 'Navamsha API request timed out.'
                : 'Backend could not complete the astrology request.'
        });
    }
});

// ==========================================
// RADHE ASTRO - ASTRONOMY ENGINE TEST
// ==========================================

app.get('/api/astronomy-test', (req, res) => {
    try {
        const testDate = new Date();

        const jupiterVector = Astronomy.GeoVector(
            Astronomy.Body.Jupiter,
            testDate,
            true
        );

        const jupiterPosition = Astronomy.Ecliptic(
            jupiterVector
        );

        return res.json({
            success: true,
            message: 'Astronomy Engine is working!',
            testDate: testDate.toISOString(),
            planet: 'Jupiter',
            tropicalLongitude: jupiterPosition.elon,
            eclipticLatitude: jupiterPosition.elat
        });

    } catch (error) {
        console.error('ASTRONOMY TEST ERROR:', error.message);

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ==========================================
// JUPITER 24-HOUR POSITION TEST
// Existing APIs remain unchanged
// ==========================================

app.get('/api/astronomy-jupiter-24h', (req, res) => {
    try {
        // Two fixed UTC timestamps, exactly 24 hours apart
        const date1 = new Date('2026-11-11T11:50:00Z');
        const date2 = new Date('2026-11-12T11:50:00Z');

        // Lahiri ayanamsha from the November 2026
        // Astrodienst sidereal ephemeris header
        const ayanamsha = 24 + (13 / 60) + (55 / 3600);

        function getJupiterPosition(date) {
            const vector = Astronomy.GeoVector(
                Astronomy.Body.Jupiter,
                date,
                true
            );

            const ecliptic = Astronomy.Ecliptic(vector);

            const tropical = ecliptic.elon;

            let sidereal = tropical - ayanamsha;

            if (sidereal < 0) {
                sidereal += 360;
            }

            return {
                date: date.toISOString(),
                tropicalLongitude: tropical,
                siderealLongitude: sidereal,
                eclipticLatitude: ecliptic.elat
            };
        }

        const position1 = getJupiterPosition(date1);
        const position2 = getJupiterPosition(date2);

        // Calculate angular movement in 24 hours
        let movement = (
            position2.siderealLongitude -
            position1.siderealLongitude
        );

        if (movement > 180) movement -= 360;
        if (movement < -180) movement += 360;

        const dailyMotionArcMinutes = movement * 60;

        return res.json({
            success: true,
            test: 'Jupiter 24-hour movement',
            ayanamshaUsed: ayanamsha,
            position1,
            position2,
            dailyMotionDegrees: movement,
            dailyMotionArcMinutes: dailyMotionArcMinutes,
            direction: movement > 0
                ? 'DIRECT'
                : movement < 0
                    ? 'RETROGRADE'
                    : 'STATIONARY'
        });

    } catch (error) {
        console.error(
            'JUPITER 24H TEST ERROR:',
            error.message
        );

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

app.get('/api/astronomy-saturn-24h', (req, res) => {
    try {
        // Two fixed UTC timestamps, exactly 24 hours apart
        const date1 = new Date('2026-11-11T11:50:00Z');
        const date2 = new Date('2026-11-12T11:50:00Z');

        // Lahiri ayanamsha - November 2026
        const ayanamsha = 24 + (13 / 60) + (55 / 3600);

        function getSaturnPosition(date) {
            const vector = Astronomy.GeoVector(
                Astronomy.Body.Saturn,
                date,
                true
            );

            const ecliptic = Astronomy.Ecliptic(vector);

            const tropical = ecliptic.elon;

            let sidereal = tropical - ayanamsha;

            if (sidereal < 0) {
                sidereal += 360;
            }

            return {
                date: date.toISOString(),
                tropicalLongitude: tropical,
                siderealLongitude: sidereal,
                eclipticLatitude: ecliptic.elat
            };
        }

        const position1 = getSaturnPosition(date1);
        const position2 = getSaturnPosition(date2);

        // Calculate angular movement in 24 hours
        let movement = (
            position2.siderealLongitude -
            position1.siderealLongitude
        );

        if (movement > 180) movement -= 360;
        if (movement < -180) movement += 360;

        const dailyMotionArcMinutes = movement * 60;

        return res.json({
            success: true,
            test: 'Saturn 24-hour movement',
            ayanamshaUsed: ayanamsha,
            position1,
            position2,
            dailyMotionDegrees: movement,
            dailyMotionArcMinutes: dailyMotionArcMinutes,
            direction: movement > 0
                ? 'DIRECT'
                : movement < 0
                    ? 'RETROGRADE'
                    : 'STATIONARY'
        });

    } catch (error) {
        console.error(
            'SATURN 24H TEST ERROR:',
            error.message
        );

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

let ephemeraTestInstancePromise = null;

app.get('/api/ephemera-guru-shani-test', async (req, res) => {
    try {
        if (!ephemeraTestInstancePromise) {
            ephemeraTestInstancePromise =
                import('@astrologer/ephemera').then(
                    async (mod) => ({
                        eph: await mod.createEphemera(),
                        Body: mod.Body,
                        Ayanamsa: mod.Ayanamsa
                    })
                );
        }

        const { eph, Body, Ayanamsa } =
            await ephemeraTestInstancePromise;

        const date1 = new Date('2026-11-11T11:50:00Z');
        const date2 = new Date('2026-11-12T11:50:00Z');

        function getJulianDate(date) {
            const year = date.getUTCFullYear();
            const month = date.getUTCMonth() + 1;

            const day =
                date.getUTCDate() +
                (
                    date.getUTCHours() +
                    date.getUTCMinutes() / 60 +
                    date.getUTCSeconds() / 3600
                ) / 24;

            return eph.julianDate(year, month, day);
        }

        function getDecimalYear(date) {
            const year = date.getUTCFullYear();
            const start = Date.UTC(year, 0, 1);
            const end = Date.UTC(year + 1, 0, 1);

            return year +
                (date.getTime() - start) / (end - start);
        }

        function normalize(degrees) {
            return ((degrees % 360) + 360) % 360;
        }

        function getPlanetPosition(date, body) {
            const jd = getJulianDate(date);

            const tt = eph.utToTt(
                jd,
                getDecimalYear(date)
            );

            const planet = eph.position(body, jd);

            const ayanamsha = eph.ayanamsa(
                Ayanamsa.Lahiri,
                tt
            );

            return {
                date: date.toISOString(),
                julianDate: jd,
                tropicalLongitude: planet.longitude,
                siderealLongitude: normalize(
                    planet.longitude - ayanamsha
                ),
                eclipticLatitude: planet.latitude,
                tropicalDailyMotion: planet.longitudeSpeed,
                ayanamshaUsed: ayanamsha
            };
        }

        function testPlanet(body) {
            const p1 = getPlanetPosition(date1, body);
            const p2 = getPlanetPosition(date2, body);

            let movement =
                p2.siderealLongitude -
                p1.siderealLongitude;

            if (movement > 180) movement -= 360;
            if (movement < -180) movement += 360;

            return {
                position1: p1,
                position2: p2,
                dailyMotionDegrees: movement,
                dailyMotionArcMinutes: movement * 60,
                direction: movement > 0.000001
                    ? 'DIRECT'
                    : movement < -0.000001
                        ? 'RETROGRADE'
                        : 'STATIONARY'
            };
        }

const ephemeraMethods = {
    ownMethods: Object.keys(eph),
    prototypeMethods: Object.getOwnPropertyNames(
        Object.getPrototypeOf(eph)
    ),
    methodDetails: {
        longitudeCrossing: {
            argumentsCount: eph.longitudeCrossing.length,
            source: eph.longitudeCrossing.toString()
        },
        station: {
            argumentsCount: eph.station.length,
            source: eph.station.toString()
        }
    }
};
        
console.log(
    'EPHEMERA AVAILABLE METHODS:',
    JSON.stringify(ephemeraMethods)
);
        return res.json({
            success: true,
            availableMethods: ephemeraMethods,
            engine: 'Ephemera',
            version: '0.4.1',
            test: 'Dynamic Lahiri Guru and Shani 24-hour test',
            reference: 'Geocentric Sidereal',
            ayanamsha: 'Lahiri',
            jupiter: testPlanet(Body.Jupiter),
            saturn: testPlanet(Body.Saturn)
        });

    } catch (error) {
        console.error(
            'EPHEMERA TEST ERROR:',
            error.stack || error.message
        );

        ephemeraTestInstancePromise = null;

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Vercel serverless export
module.exports = app;

// Local development only
if (require.main === module) {
    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
        console.log(
            `Radhe Astro Server running on port ${PORT}`
        );
    });
        }
