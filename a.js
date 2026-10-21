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
// Navamsha API Route (Dynamic & Professional)
app.post('/api/navamsha', async (req, res) => {
    try {
        const { name, dob, tob, pob } = req.body;
        
        // Date parsing (DD/MM/YYYY)
        const dobParts = dob ? dob.split('/') : ['01', '01', '2000'];
        const day = parseInt(dobParts[0], 10);
        const month = parseInt(dobParts[1], 10);
        const year = parseInt(dobParts[2], 10);

        // Time parsing (HH:MM)
        const tobParts = tob ? tob.split(':') : ['12', '00'];
        const hour = parseInt(tobParts[0], 10);
        const min = parseInt(tobParts[1], 10);

        // Dynamic payload jo frontend se aane wale pob (Place of Birth) ko use karega
        const apiPayload = {
            day: day,
            month: month,
            year: year,
            hour: hour,
            min: min,
            place: pob || "New Delhi", // Agar user ne place bhara hai toh wo jayega, nahi toh default
            tzone: 5.5
        };

        const apiResponse = await fetch('https://api.vedicastrologyapi.com/v3-json/horoscope/navamsha-chart', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer vda_live_bc7adba0_-s513GlzBfGHLhNBeWbdz8VSTOrA_bc6pBH8xXsKlEU' // 👈 Yahan apni asli vda_live key rakhiye ga
            },
            body: JSON.stringify(apiPayload)
        });

        const result = await apiResponse.json();

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

// Port listener zaroori hai Render ke liye
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Radhe Astro Server is running on port ${PORT}`);
});
