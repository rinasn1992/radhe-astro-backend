// Test route yeh check karne ke liye ki server live hai ya nahi
app.get('/api/test', (req, res) => {
    res.json({ success: true, message: "Server is working perfectly!" });
});

const express = require('express');
const cors = require('cors');
const moment = require('moment');

const app = express();
app.use(cors());
app.use(express.json());

// Aapka Kundali aur Astro logic yahan hai
app.get('/', (req, res) => {
  res.send('Radhe Astro Backend API is running successfully!');
});
// Navamsha API Route (Debug Mode)
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

        const apiPayload = {
            day: day,
            month: month,
            year: year,
            hour: hour,
            min: min,
            lat: 25.2138,
            lon: 84.9814,
            tzone: 5.5
        };

        const apiResponse = await fetch('https://api.vedicastrologyapi.com/v3-json/horoscope/navamsha-chart', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer vda_live_cc1b52dc_ie316Y9F6iGcJH-dUFheqdxGw65LLl8RbsCCnUt4EDU' // 👈 Yahan apni asli key daalna na bhulein
            },
            body: JSON.stringify(apiPayload)
        });

        const result = await apiResponse.json();

        // Agar API error return kare toh use bhi pakdo
        if (!apiResponse.ok) {
            return res.status(500).json({ 
                success: false, 
                message: "Third-party API Error: " + JSON.stringify(result) 
            });
        }

        res.json({
            success: true,
            message: "Navamsha data fetched successfully",
            planetDetails: result.output || result
        });

    } catch (error) {
        console.error("Server Crash Error:", error);
        res.status(500).json({ success: false, message: "Server Error: " + error.message });
    }
});


// Port listener zaroori hai Render ke liye
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Radhe Astro Server is running on port ${PORT}`);
});
