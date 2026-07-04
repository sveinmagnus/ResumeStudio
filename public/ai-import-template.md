# Resume Studio — AI Import Template (v1)

You are converting a CV/resume into structured JSON for **Resume Studio**.

## Your task

1. Read the attached CV file (PDF or Word document).
2. Output **one** JSON object that matches the schema below.
3. Output **JSON only** — no prose, no explanation, no Markdown code fences.

## Rules

- Include `"$schema": "resumestudio-ai/v1"` as the first field.
- Set `"primary_locale"` to the CV's main language: `"en"` (English), `"no"`
  (Norwegian), `"se"` (Swedish), or `"dk"` (Danish). Default to `"en"`.
- **Every text field is plain text in the CV's main language.** Do not translate.
- For any field you cannot determine from the CV, **omit it** — never invent
  data. Omitting is always safe; the app fills in sensible defaults.
- Dates use `{ "year": 2021, "month": 3 }`. Use `"month": null` (or omit it) when
  only the year is known. Use `"end": null` for anything ongoing/current.
- `roles` and `skills` on a project are arrays of plain names. The app
  automatically deduplicates them — list the same skill on as many projects as
  applies; don't worry about repetition.
- To link a project to a job, set the project's `"employer"` to the same
  employer name used in `work_experiences`. The app matches them by name.
- Keep it faithful to the source. It's better to omit an uncertain field than
  to guess.

## Schema

```ts
{
  "$schema": "resumestudio-ai/v1",
  "primary_locale": "en",            // "en" | "no" | "se" | "dk"

  "profile": {
    "full_name": string,
    "title": string,                 // e.g. "Senior Software Engineer"
    "email": string,
    "phone": string,
    "nationality": string,
    "place_of_residence": string,    // city / country
    "linkedin_url": string,
    "website_url": string,
    "summary": string                // short professional summary paragraph
  },

  "key_qualifications": [            // headline strengths / focus areas
    {
      "label": string,               // e.g. "Cloud Architecture"
      "summary": string,             // a sentence or two
      "bullets": [string]            // short supporting points
    }
  ],

  "work_experiences": [             // employment history
    {
      "employer": string,
      "role_title": string,
      "description": string,
      "start": { "year": number, "month": number },
      "end": { "year": number, "month": number }   // null if current
    }
  ],

  "projects": [                     // assignments / engagements
    {
      "customer": string,            // client or project name
      "industry": string,
      "description": string,
      "employer": string,            // match to a work_experiences[].employer to link
      "roles": [string],             // e.g. ["Tech Lead", "Backend Developer"]
      "skills": [string],            // e.g. ["TypeScript", "PostgreSQL", "AWS"]
      "start": { "year": number, "month": number },
      "end": { "year": number, "month": number }
    }
  ],

  "educations": [
    {
      "school": string,
      "degree": string,
      "description": string,
      "start": { "year": number, "month": number },
      "end": { "year": number, "month": number }
    }
  ],

  "courses": [
    { "name": string, "program": string, "completed": { "year": number, "month": number } }
  ],

  "certifications": [
    {
      "name": string,
      "organiser": string,           // issuing body
      "issued": { "year": number, "month": number },
      "expires": { "year": number, "month": number }
    }
  ],

  "spoken_languages": [
    { "name": string, "level": string }   // e.g. { "name": "English", "level": "Fluent" }
  ],

  "technology_categories": [        // skills grouped under headings — becomes
    { "name": string, "skills": [string] }   // skill categories; listed skills are highlighted
  ],

  "recommendations": [
    {
      "recommender_name": string,
      "recommender_title": string,
      "recommender_company": string,
      "relationship": string,        // how they know the candidate
      "text": string                 // the testimonial
    }
  ]
}
```

## Worked example

A short, complete example so you can see the exact shape expected:

```json
{
  "$schema": "resumestudio-ai/v1",
  "primary_locale": "en",
  "profile": {
    "full_name": "Jane Doe",
    "title": "Senior Software Engineer",
    "email": "jane.doe@example.com",
    "phone": "+47 400 00 000",
    "place_of_residence": "Oslo, Norway",
    "linkedin_url": "https://linkedin.com/in/janedoe",
    "summary": "Full-stack engineer with 8 years building cloud platforms in fintech."
  },
  "key_qualifications": [
    {
      "label": "Cloud Architecture",
      "summary": "Designs and operates resilient AWS platforms.",
      "bullets": ["Infrastructure as code", "Cost optimisation", "Zero-downtime migrations"]
    }
  ],
  "work_experiences": [
    {
      "employer": "Acme Consulting",
      "role_title": "Senior Consultant",
      "description": "Consulting across fintech and public sector.",
      "start": { "year": 2019, "month": 3 },
      "end": null
    }
  ],
  "projects": [
    {
      "customer": "Nordic Bank",
      "industry": "Finance",
      "description": "Rebuilt the payments backend as event-driven microservices.",
      "employer": "Acme Consulting",
      "roles": ["Tech Lead", "Backend Developer"],
      "skills": ["TypeScript", "Node.js", "PostgreSQL", "AWS Lambda"],
      "start": { "year": 2020, "month": 1 },
      "end": { "year": 2021, "month": 6 }
    }
  ],
  "educations": [
    {
      "school": "NTNU",
      "degree": "MSc Computer Science",
      "start": { "year": 2011, "month": 8 },
      "end": { "year": 2016, "month": 6 }
    }
  ],
  "spoken_languages": [
    { "name": "Norwegian", "level": "Native" },
    { "name": "English", "level": "Fluent" }
  ]
}
```

After the model returns the JSON, save it as a `.json` file (or copy it) and
drop it into Resume Studio's **AI-assisted import** dialog. The app validates it,
shows a preview of what it found, and creates a new resume you can then refine.
