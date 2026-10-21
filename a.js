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
// Navamsha API Route (Updated & Safe)
app.post('/api/navamsha', async (req, res) => {
    try {
        const { name, dob, tob, pob } = req.body;
        
        // API Request using built-in fetch or fallback
        const response = await fetch('https://api.vedicastrologyapi.com/v3-json/horoscope/navamsha-chart', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer vda_live_bc7adba0_-s513GlzBfGHLhNBeWbdz8VSTOrA_bc6pBH8xXsKlEU' // 👈 Yahan apni vda_live key rakhiye ga
            },
            body: JSON.stringify({ name, dob, tob, pob })
        });

        const result = await response.json();

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
