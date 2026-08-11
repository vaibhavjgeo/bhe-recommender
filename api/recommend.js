// BHE Recommender - Stage B
// API now accepts a q_lookup value (from map click) and location coordinates
// instead of a region key. Falls back to region-based lookup for backward compat.

const THESIS_CONTEXT = `You explain BHE (borehole heat exchanger) drilling recommendations for a tool built on Vaibhav Jaiswal's MSc thesis at KIT.

Key facts you can cite:
- Germany's sustainable BHE potential ranges from 43 to 50 W/m
- High-yield areas: southwest Germany, Berlin, Munich, Frankfurt, Rhine-Ruhr
- Low-yield areas: northern and eastern Germany
- By 2100, subsurface warming: +1.7 deg C under SSP 2-4.5, +3.1 deg C under SSP 5-8.5
- Warming reduces required drilling depth: roughly 4 m per 1 deg C
- 100-year sustainable mode keeps ground temperature stable forever

Style: clear professional English. No em dashes. No emojis. Use commas or short sentences. Always finish every sentence with a period.`;

// =============================================================================
// COST CONSTANTS
// =============================================================================

const COST = {
  drilling_per_m: { min: 50, max: 90, default: 70 },
  heat_pump: { min: 8000, max: 15000, default: 11000 },
  ancillary: 2500,
};

// =============================================================================
// YIELD CLASSIFICATION (based on W/m value)
// =============================================================================

function classifyYield(q) {
  if (q >= 47) return { class: 'high', label: 'high yield', note: 'This site sits in the upper range of geothermal potential in Germany.' };
  if (q >= 44) return { class: 'medium', label: 'medium yield', note: 'This site has a moderate but viable geothermal yield.' };
  return { class: 'low', label: 'low yield', note: 'This site is at the lower end of yield, but BHE installation can still be effective with proper sizing.' };
}

// =============================================================================
// CALCULATION LOGIC
// =============================================================================

function calculateDepth(demand_kW, q_per_m) {
  const demand_W = demand_kW * 1000;
  const raw_depth = demand_W / q_per_m;
  return Math.ceil(raw_depth / 10) * 10;
}

function calculatePower(depth_m, q_per_m) {
  return Math.round((depth_m * q_per_m) / 100) / 10;
}

function calculateCost(depth_m, useCases) {
  const drilling = depth_m * COST.drilling_per_m.default;
  const drilling_min = depth_m * COST.drilling_per_m.min;
  const drilling_max = depth_m * COST.drilling_per_m.max;
  const heat_pump = COST.heat_pump.default;

  const cooling_addon = useCases.cooling ? 1500 : 0;
  const hot_water_addon = useCases.hotWater ? 800 : 0;

  const total = drilling + heat_pump + cooling_addon + hot_water_addon + COST.ancillary;

  return {
    drilling: Math.round(drilling),
    drilling_range: [Math.round(drilling_min), Math.round(drilling_max)],
    heat_pump: heat_pump,
    cooling_addon: cooling_addon,
    hot_water_addon: hot_water_addon,
    ancillary: COST.ancillary,
    total: Math.round(total),
    cost_per_kW: 0
  };
}

// =============================================================================
// REQUEST HANDLER
// =============================================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      q_lookup,           // W/m, looked up from map click (this is the 100yr sustainable value)
      q_all,              // {q_50_depleting, q_50_sustainable, q_100_sustainable} - all 3 horizons
      location,           // { lat, lng, label?: string }
      demand_kW,
      budget_eur,
      useCases = {},
      scenario = 'ssp585',
      statistic = 'mean',
    } = req.body;

    // Validation
    if (!q_lookup || q_lookup < 20 || q_lookup > 80) {
      return res.status(400).json({ error: 'Invalid or missing q_lookup value. Click somewhere within Germany on the map.' });
    }
    if (!demand_kW || demand_kW < 1 || demand_kW > 100) {
      return res.status(400).json({ error: 'Heating demand must be between 1 and 100 kW' });
    }
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      return res.status(400).json({ error: 'Missing location coordinates' });
    }

    // Calculations
    const q_used = q_lookup;
    const yieldInfo = classifyYield(q_used);
    const depth = calculateDepth(demand_kW, q_used);
    const power_actual_kW = calculatePower(depth, q_used);
    const cost = calculateCost(depth, useCases);
    cost.cost_per_kW = Math.round(cost.total / power_actual_kW);

    // Compute time-horizon comparison at the same recommended depth
    const horizons = [];
    if (q_all) {
      if (typeof q_all.q_50_depleting === 'number' && q_all.q_50_depleting > 0) {
        horizons.push({
          key: '50yr_depleting',
          label: '50-year depleting',
          mode: 'depleting',
          q: Math.round(q_all.q_50_depleting * 100) / 100,
          power_kW: Math.round((depth * q_all.q_50_depleting) / 100) / 10,
          note: 'Higher initial output, but the ground cools and the system loses effectiveness over decades.'
        });
      }
      if (typeof q_all.q_50_sustainable === 'number' && q_all.q_50_sustainable > 0) {
        horizons.push({
          key: '50yr_sustainable',
          label: '50-year sustainable',
          mode: 'sustainable',
          q: Math.round(q_all.q_50_sustainable * 100) / 100,
          power_kW: Math.round((depth * q_all.q_50_sustainable) / 100) / 10,
          note: 'Safe operation for 50 years with minimal ground cooling.'
        });
      }
      if (typeof q_all.q_100_sustainable === 'number' && q_all.q_100_sustainable > 0) {
        horizons.push({
          key: '100yr_sustainable',
          label: '100-year sustainable',
          mode: 'sustainable',
          q: Math.round(q_all.q_100_sustainable * 100) / 100,
          power_kW: Math.round((depth * q_all.q_100_sustainable) / 100) / 10,
          note: 'Fully renewable. Ground temperature stays stable forever.',
          recommended: true
        });
      }
    }

    const budgetStatus = budget_eur ? {
      provided: budget_eur,
      fits: cost.total <= budget_eur,
      delta: budget_eur - cost.total
    } : null;

    // Compose summary for the AI
    const scenarioLabel = scenario === 'ssp585' ? 'SSP 5-8.5 (high emissions)' : 'SSP 2-4.5 (moderate emissions)';
    const statisticLabel = statistic === 'p50' ? 'ensemble median' : 'ensemble mean';
    const locationLabel = location.label || `${location.lat.toFixed(3)}°N, ${location.lng.toFixed(3)}°E`;

    const calcSummary = `
Location: ${locationLabel}
Latitude: ${location.lat.toFixed(3)}, Longitude: ${location.lng.toFixed(3)}
Sustainable extraction rate at this site: ${q_used.toFixed(2)} W/m (looked up from thesis data, ${statisticLabel})
Climate scenario: ${scenarioLabel}
Yield class at this location: ${yieldInfo.label}
User heating demand: ${demand_kW} kW
Use cases: heating${useCases.cooling ? ' + cooling' : ''}${useCases.hotWater ? ' + hot water' : ''}
Recommended borehole depth: ${depth} m
Expected sustainable thermal output at this depth: ${power_actual_kW} kW
Estimated total cost: EUR ${cost.total.toLocaleString('en-US')}
Cost per kW capacity: EUR ${cost.cost_per_kW.toLocaleString('en-US')} / kW
${budgetStatus ? `User budget: EUR ${budget_eur.toLocaleString('en-US')}, fits within budget: ${budgetStatus.fits ? 'yes' : 'no (over by EUR ' + Math.abs(budgetStatus.delta).toLocaleString('en-US') + ')'}` : 'No budget specified'}
`;

    // AI explanation
    let aiExplanation = null;
    const apiKey = process.env.GEMINI_API_KEY;

    async function callGemini() {
      const prompt = `Write 4 to 6 complete sentences interpreting this BHE drilling recommendation for a homeowner. Make every sentence complete with a period.

Data:
${calcSummary}

Cover in this order:
- Verdict on the site (compare ${q_used.toFixed(1)} W/m to German range 43-50 W/m).
- Climate change impact by 2100 under ${scenarioLabel}.
- Whether the recommended depth fits the heating demand.
- One practical consideration (geology, groundwater, permits, or urban density).
- Cost reasonableness and a concrete recommendation (proceed, get a quote, or reconsider).

Write naturally as one paragraph. No bullet points. No em dashes. No emojis. Always end with a period.`;

      const geminiResponse = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + apiKey,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: THESIS_CONTEXT }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.5, maxOutputTokens: 1500 },
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
            ],
          }),
        }
      );

      if (!geminiResponse.ok) {
        console.error('Gemini API non-OK:', geminiResponse.status);
        return null;
      }

      const data = await geminiResponse.json();
      let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
      const finishReason = data?.candidates?.[0]?.finishReason;
      console.log('Gemini finishReason:', finishReason, 'length:', text?.length);

      // Sanitize trailing incomplete sentence
      if (text) {
        text = text.trim();
        if (!/[.!?]$/.test(text)) {
          const sentenceEndRegex = /[.!?]\s+[A-Z]/g;
          let lastSentenceEnd = -1;
          let match;
          while ((match = sentenceEndRegex.exec(text)) !== null) {
            lastSentenceEnd = match.index + 1;
          }
          if (lastSentenceEnd > 80) {
            text = text.substring(0, lastSentenceEnd).trim();
          } else {
            text = text + '...';
          }
        }
      }
      return text;
    }

    if (apiKey) {
      try {
        aiExplanation = await callGemini();
      } catch (err) {
        console.error('Gemini call failed:', err);
      }
    }

    return res.status(200).json({
      input: { q_lookup, location, demand_kW, budget_eur, useCases, scenario, statistic },
      site: {
        location: locationLabel,
        coordinates: { lat: location.lat, lng: location.lng },
        q_used: Math.round(q_used * 100) / 100,
        yield_class: yieldInfo.class,
        yield_label: yieldInfo.label,
        yield_note: yieldInfo.note,
        statistic_used: statistic,
        scenario_used: scenario
      },
      recommendation: {
        depth_m: depth,
        power_kW: power_actual_kW,
        cost: cost,
        budget_status: budgetStatus,
        horizons: horizons
      },
      ai_explanation: aiExplanation || 'AI explanation unavailable. The calculation above is based on data from the underlying thesis. For best results, also consider local geology and groundwater conditions.'
    });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
