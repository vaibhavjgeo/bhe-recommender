# BHE Recommender - Should You Drill a Borehole Here?

> Click anywhere on a map of Germany and get an instant shallow-geothermal feasibility report: in-browser yield and cost model, LLM-written geological interpretation, downloadable PDF.

**Live**: [vaibhavjgeo.vercel.app/bhe](https://vaibhavjgeo.vercel.app/bhe/)

## What this is

A decision-support tool built on my M.Sc. thesis data. Pick a site, choose a climate scenario and statistic, enter your heating demand - the tool reads the sustainable heat-extraction rate at that exact 5 km pixel, sizes the borehole, estimates output and cost, has an LLM write the plain-language geological interpretation, and generates a PDF report. Science-to-stakeholder translation with no backend to maintain.

## How this was built - AI-pair-programming disclosure

Built with **AI-assisted development** (Anthropic Claude as primary pair-programmer, GitHub Copilot inline). Mine: the feasibility logic and cost assumptions, the decision to run the model in the browser, the prompt rules for the interpretation (thesis values only, no invented numbers), and full review of every line. AI accelerated the Leaflet integration, jsPDF layout, and refactoring.

## Architecture

```
Browser (vanilla JS)
   +-- Leaflet map + thesis JSON layers (SSP 2-4.5 / 5-8.5, mean / P50)
   +-- In-browser sizing & cost model
   +-- jsPDF report generation
   |
   v
Vercel serverless function (api/recommend.js, Node.js)
   |
   v
Google Gemini API -> plain-language geological interpretation
```

## Tech stack

| Layer | What |
|---|---|
| Frontend | Vanilla HTML, CSS, JavaScript; Leaflet; jsPDF |
| Data | Thesis result layers (JSON, 5 km resolution, EPSG:4326) |
| Backend | Vercel serverless function (Node.js) |
| AI model | Google Gemini (interpretation text only - numbers come from data) |
| Hosting | Vercel free tier |
| Cost | 0 EUR/month |

## Environment variables

| Name | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google Gemini API key for the interpretation endpoint (set in Vercel project settings, never committed) |

## Run locally

```bash
git clone https://github.com/vaibhavjgeo/bhe-recommender.git
cd bhe-recommender
python3 -m http.server 8000
# Open http://localhost:8000  (the AI interpretation needs the deployed function)
```

## Project structure

```
.
├── index.html          # Map, model, configurator, PDF export
├── data/               # SSP scenario layers (mean + P50)
├── api/recommend.js    # Serverless LLM interpretation endpoint
├── vercel.json         # Function config
└── README.md
```

## Disclaimer

First-pass estimates, not engineering advice. Values come from CMIP6 ensemble averages at 5 km resolution; local geology, groundwater, and permits will shift the real numbers.

## License

MIT.

## Contact

- **Email**: vaibhavjaiswal1234@gmail.com
- **Portfolio**: [vaibhavjgeo.vercel.app](https://vaibhavjgeo.vercel.app)
- **LinkedIn**: [linkedin.com/in/vaibhavgeo](https://www.linkedin.com/in/vaibhavgeo/)
