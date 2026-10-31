const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Root Route
app.get('/', (req, res) => {
    res.json({ success: true, message: "Radhe Astro Backend API is running successfully!" });
});


// Navamsha API Route
app.post('/api/navamsha', async (req, res) => {
    try {
            const { name, year, month, day, hour, minute, place } = req.body;

    const apiPayload = {
        date: day ? parseInt(day, 10) : 12,
        month: month ? parseInt(month, 10) : 10,
        year: year ? parseInt(year, 10) : 1990,
        hours: hour ? parseInt(hour, 10) : 10,
        minutes: minute ? parseInt(minute, 10) : 30,
        latitude: 25.2138,
        longitude: 84.9814,
        timezone: 5.5
    };
            // Safe API call: Kundali Advanced (Primary) + Planets (Optional with catch)
    const kundaliResponse = await fetch('https://api.navamsha.in/api/v1/astrology/kundli/advanced', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer vda_live_cc1b52dc_14316Y9F61gCJH-dUFhagdXwG65LL18RbsCCnUt4EDU'
      },
      body: JSON.stringify(apiPayload)
    });

    const kundaliResult = await kundaliResponse.json();
    let combinedOutput = kundaliResult.output || kundaliResult;

    // Planets API call with safety catch so it never crashes the app
    try {
      const planetsResponse = await fetch('https://api.navamsha.in/api/v1/planets/extended', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer vda_live_cc1b52dc_14316Y9F61gCJH-dUFhagdXwG65LL18RbsCCnUt4EDU'
        },
        body: JSON.stringify(apiPayload)
      });
      const planetsResult = await planetsResponse.json();
      if (!planetsResult.detail) {
        combinedOutput.planet_positions = planetsResult.output || planetsResult;
      }
    } catch (err) {
      console.log("Planets API optional fetch skipped:", err.message);
    }

    console.log("Final Combined Output:", JSON.stringify(combinedOutput, null, 2));

    res.json({
      success: true,
      message: "Navamsha data fetched successfully",
      planetDetails: combinedOutput
    });
        
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Port listener
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Radhe Astro Server is running on port ${PORT}`);
});
module.exports = app;
