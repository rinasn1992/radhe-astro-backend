
const express = require('express');
const cors = require('cors');

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
            timezone
        } = req.body || {};

        // Required birth details
        if (!dob || !tob || !pob) {
            return res.status(400).json({
                success: false,
                message: 'Name, date of birth, time of birth and place of birth are required.'
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

        // Real coordinates are required.
        const lat = Number(latitude);
        const lon = Number(longitude);
        const tz = Number(timezone);

        if (
            latitude === undefined ||
            longitude === undefined ||
            timezone === undefined ||
            !Number.isFinite(lat) ||
            !Number.isFinite(lon) ||
            !Number.isFinite(tz) ||
            lat < -90 || lat > 90 ||
            lon < -180 || lon > 180 ||
            tz < -14 || tz > 14
        ) {
            return res.status(400).json({
                success: false,
                message: 'Valid latitude, longitude and timezone are required. Please provide actual birth-place coordinates.'
            });
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
                message: result.message || result.error || 'Navamsha API request failed.',
                providerStatus: result.statusCode || apiResponse.status
            });
        }

        const planetDetails = result.output || result;

        if (
            !planetDetails ||
            typeof planetDetails !== 'object'
        ) {
            return res.status(502).json({
                success: false,
                message: 'Navamsha API did not return valid astrology data.'
            });
        }

        // Keep the existing frontend response property.
        return res.json({
            success: true,
            message: 'Navamsha data fetched successfully',
            planetDetails,
            birthDetails: {
                name: name || '',
                dob,
                tob,
                pob
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
        console.log(`Radhe Astro Server running on port ${PORT}`);
    });
}
