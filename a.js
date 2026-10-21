const https = require('https');

app.post('/api/navamsha', async (req, res) => {
    try {
        const { name, dob, tob, pob } = req.body;
        
        const dobParts = dob ? dob.split('/') : ['03', '03', '1988'];
        const day = parseInt(dobParts[0], 10);
        const month = parseInt(dobParts[1], 10);
        const year = parseInt(dobParts[2], 10);

        const tobParts = tob ? tob.split(':') : ['23', '30'];
        const hour = parseInt(tobParts[0], 10);
        const min = parseInt(tobParts[1], 10);

        const postData = JSON.stringify({
            day: day,
            month: month,
            year: year,
            hour: hour,
            min: min,
            lat: 25.2138,
            lon: 84.9814,
            tzone: 5.5
        });

        const options = {
            hostname: 'api.vedicastrologyapi.com',
            port: 443,
            path: '/v3-json/horoscope/navamsha-chart',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer vda_live_cc1b52dc_ie316Y9F6iGcJH-dUFheqdxGw65LLl8RbsCCnUt4EDU', // 👈 Yahan apni asli key daalni hai
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const apiPromise = new Promise((resolve, reject) => {
            const apiReq = https.request(options, (apiRes) => {
                let data = '';
                apiRes.on('data', (chunk) => { data += chunk; });
                apiRes.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error("Invalid JSON from Astrology API: " + data));
                    }
                });
            });

            apiReq.on('error', (e) => { reject(e); });
            apiReq.write(postData);
            apiReq.end();
        });

        const result = await apiPromise;

        res.json({
            success: true,
            message: "Navamsha data fetched successfully",
            planetDetails: result.output || result
        });

    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});
