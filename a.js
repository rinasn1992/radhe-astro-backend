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
        
        // Frontend response
        return res.json({
            success: true,
            message: 'Navamsha data fetched successfully',
planetDetails,
d1Details,
d1Error,
d2Details,
d2Error,

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
