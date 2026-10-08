// Every prompt the studio sends to Claude, plus the option lists the screens share.
// Prompts carried over from v2 keep their wording; prompts added in v3 are marked "v3".

// ---- Create (design graphics) --------------------------------------------------

export const VISION_ANALYSIS_SYSTEM = `You are a visual composition analyst for a luxury photography studio. Analyse the image and return JSON:
{
  "focalPoint": "where the main subject sits",
  "negativeSpace": "where open/empty areas are — this is where text should live",
  "dominantTones": "describe the light quality and tonal range",
  "suggestedTextZone": "specific zone for text (e.g. upper-left third, bottom strip, right column)",
  "textContrast": "light or dark — what will read better against the image in that zone",
  "mood": "one word (cinematic / intimate / dramatic / airy / raw / refined / moody / charged)",
  "colorPalette": ["#hex1","#hex2","#hex3"],
  "typographyMood": "what typography personality fits (e.g. sharp geometric, flowing serif, stark mono, refined italic)",
  "composition": "rule of thirds / centered / asymmetric / leading lines / frame within frame"
}
Return ONLY valid JSON.`

export const PRELOADED_FONTS = `SERIF: "Cormorant Garamond", "Bodoni Moda", "Playfair Display", "EB Garamond"
SANS:  "Inter", "Space Grotesk"
MONO:  "JetBrains Mono", "Space Mono"`

export const REF_EXTRACT_SYSTEM = `Analyse this reference design image and return a precise style JSON. Return ONLY valid JSON:
{
  "shell": "caption-bottom-gradient | corner-whisper | centered-minimal | bottom-panel | edge-type | float-in-space",
  "text_zone": "e.g. bottom-25%, top-left-corner, center-bottom-edge",
  "text_alignment": "left | center | right",
  "overlay": "describe CSS value or 'none'",
  "headline_weight": 300,
  "headline_size": "small | medium | large",
  "headline_case": "uppercase | lowercase | mixed",
  "headline_tracking": "tight | normal | wide | very-wide",
  "type_feel": "warm-serif | cold-geometric | editorial-mono | neutral-sans",
  "handle_position": "top-right | top-left | bottom-right | bottom-left | none",
  "color_temperature": "warm | cool | neutral",
  "overall_feel": "one short phrase"
}`

export const DESIGN_PLAN_SYSTEM = `You are a design director deciding the exact layout and typography for a luxury Instagram post. Output a JSON plan only — a separate step writes the HTML.

PRE-LOADED FONTS (use exact names, no @import):
${PRELOADED_FONTS}

SHELLS — pick the one that matches where the negative space naturally lives:
- "caption-bottom-gradient": full-bleed image, CSS gradient darkens lower portion, text sits in that zone
- "corner-whisper": full-bleed image, small precise text block in one corner, no overlay
- "centered-minimal": full-bleed image, one short line centered at the very bottom edge
- "bottom-panel": image fills 78–85% height, solid-colour text panel below
- "edge-type": text block runs vertically along the left or right edge
- "float-in-space": text floats in the image's natural negative space, vignette only if essential

RULES:
- Shell must follow the image's actual negative space — if space is at bottom, use caption-bottom-gradient
- Font temperature must match mood: architectural/cold → geometric sans or condensed; warm/portrait/intimate → humanist italic serif; editorial/fashion → stark mono or geometric
- Never more than 2 font families
- Overlay only when the image has no natural dark zone for contrast
- Large headline (48–72px) only for bold minimal compositions; editorial restraint = 22–40px

Return ONLY valid JSON, exactly this shape — no extra keys, no markdown:
{
  "shell": "...",
  "overlay": "css value or 'none'",
  "text_zone_css": "e.g. bottom:0; left:0; right:0; padding:40px 44px 48px",
  "text_alignment": "left | center | right",
  "font_headline": "exact name from list",
  "weight_headline": 300,
  "size_headline_px": 36,
  "tracking_headline_em": 0.06,
  "style_headline": "normal | italic",
  "case_headline": "none | uppercase | lowercase",
  "color_headline": "#hexcode",
  "font_sub": "exact name from list",
  "weight_sub": 400,
  "size_sub_px": 11,
  "tracking_sub_em": 0.2,
  "case_sub": "uppercase | none",
  "color_sub": "rgba or #hex",
  "handle_position": "top-right | top-left | bottom-right | none",
  "handle_size_px": 9,
  "color_handle": "rgba or #hex",
  "reasoning": "one sentence — the single key design decision"
}`

export const POST_SYSTEM = (handle, website, plan, copy) => `Implement this design plan as a 1080×1350px Instagram post HTML div.

Studio: ${handle} · Website: ${website}
${copy?.headline ? `Copy:\n  Headline: "${copy.headline}"${copy.sub ? `\n  Sub: "${copy.sub}"` : ''}${copy.cta ? `\n  CTA: "${copy.cta}"` : ''}` : 'No copy — handle and website only.'}

PLAN — follow exactly, no deviations:
${JSON.stringify(plan, null, 2)}

FONTS are pre-loaded — use font-family directly, no @import.
Available: Cormorant Garamond, Bodoni Moda, Playfair Display, EB Garamond, Inter, Space Grotesk, JetBrains Mono, Space Mono.

RULES: Inline styles only. Div exactly 1080×1350px, position:relative, overflow:hidden.
Use src="[IMAGE_SRC]" or url('[IMAGE_SRC]'). Image dominant.
No decorative elements. No boxes around text. No button CTAs. No @import.
Return ONLY the HTML div.`

export const STORY_SYSTEM = (handle, website, plan, copy) => `Implement this design plan as a 1080×1920px Instagram Story HTML div.

Studio: ${handle} · Website: ${website}
${copy?.headline ? `Copy: "${copy.headline}"${copy.sub ? ` / "${copy.sub}"` : ''}${copy.cta ? ` / CTA: "${copy.cta}"` : ''}` : 'No copy — handle only.'}

PLAN — follow exactly:
${JSON.stringify(plan, null, 2)}

FONTS are pre-loaded — no @import. Use the 9:16 vertical canvas intentionally.
Inline styles only. Div exactly 1080×1920px. src="[IMAGE_SRC]". Image dominant.
No decorative elements. No button CTAs. Return ONLY the HTML div.`

export const COPY_SYSTEM = (handle, context, website, tone, imageAnalysis, visionDesc) => `You are writing Instagram copy for ${handle}, a luxury commercial photography studio.
This post showcases work shot for a brand. Copy appears on the photographer's Instagram feed.

${context ? `BRAND BRIEF (research findings):\n${context}` : `Studio: ${handle} — luxury commercial, editorial and advertising photography`}
Studio website: ${website || 'www.kshetejsareen.com'}
${tone ? `Tone override: ${tone}` : ''}
${imageAnalysis ? `Image mood: ${imageAnalysis.mood || 'refined'} · tones: ${imageAnalysis.dominantTones || 'varied'}` : ''}
${visionDesc ? `Image content: ${visionDesc}` : ''}

THE VOICE — derive from the brand:
Read the VOICE field in the brand brief. That is the emotional temperature and rhythm of every line.
If no VOICE field: read AESTHETIC and AUDIENCE and find the voice that lives in that world.
A furniture brand with architectural minimalism writes the way a building feels — sparse, decisive, material.
A fashion brand writes the way a glance works — incomplete, arresting, with space left open.
A hospitality brand writes the way a room welcomes — warm, precise, unhurried.
The copy should feel native. A reader who knows the brand should recognise the language.

THE THINKING — this is how the best copy works:
Copy doesn't describe what's in the image. It completes it.
The image says something — the copy finds the last word.
When the image shows the founders of a furniture brand: don't write about the people. Write about what drives someone to make objects that outlast them.
When the image shows a product in perfect light: don't describe the product. Write about what it means to see something clearly for the first time.
When the image shows an interior: don't list its features. Write about how a room holds memory.

The question to ask before writing: what does this photograph know that words almost can't say? Write towards that.

PERSPECTIVE:
You write as the photographer — the work is yours, the vision is yours. The subject serves the photograph.
CTA: an invitation to commission commercial or brand work from ${handle}. Never a family or portrait studio CTA.

What not to write:
- Headlines that describe subjects: "Three held still", "Man and woman by a wall"
- Subheadlines that explain the image: "Shot for Ravoh — a portrait of two people"
- Consumer CTAs: "Commission your portrait", "Preserve this moment"
- Clichés: "capturing moments", "timeless", "bespoke", "stunning", "through the lens", "artistry", "crafted"

Headlines: 2–5 words. The image carries the weight — the headline lands the last thought.
Website: ${website || 'www.kshetejsareen.com'}

Return JSON only:
{
  "headlines": ["strongest version", "second distinct option", "third distinct option"],
  "sub": "one line in the brand's voice, or null",
  "tagline": "optional, or null",
  "cta": "commission invitation — e.g. Book a shoot / Commission your story / Inquire now",
  "website": "${website || 'www.kshetejsareen.com'}"
}
Return ONLY valid JSON.`

export const DESIGN_REFINE_SYSTEM = `You are a front-end developer refining Instagram post HTML.
The user will describe a change. Apply ONLY that specific change to the HTML.
Return the complete modified HTML div, nothing else. No explanation. No markdown.`

export const COPY_TONES = ['Editorial', 'Interrogative', 'Declarative', 'Poetic', 'Provocative']

export const COPY_FIELDS = [
  ['Headline', 'headline', '2–5 decisive words'],
  ['Sub', 'sub', 'One line of context'],
  ['Tagline', 'tagline', 'Studio voice — optional'],
  ['CTA', 'cta', 'Invitation, not a command'],
]

export const DIRECTION_PRESETS = [
  ['Subject dominant', 'Subject fills the frame. Type bows to it.', 'Subject Dominant — The image fills the frame and typography steps back. Type is small and precise, bowing to the photograph.'],
  ['Negative space', 'Build around open space. Subject and text breathe.', 'Negative Space Led — Build the layout around open areas in the image. Subject and text breathe without competing.'],
  ['Graphic tension', 'Visual tension between image and type.', 'Graphic Tension — Create visual tension between the image and typography. Type cuts across or challenges the composition.'],
  ['Editorial stillness', 'Magazine spread that stopped time.', 'Editorial Stillness — The feeling of a magazine spread that has stopped time. Minimal, considered, deliberate.'],
  ['Layered depth', 'Type in its own plane, not on top.', 'Layered Depth — Typography sits in its own compositional plane rather than simply on top of the image.'],
  ['Cinematic', 'Feels like a still from a film.', 'Cinematic — The design feels like a still from a film. Letterboxing, film grain, dramatic light.'],
]

export const REFINE_HINTS = ['larger headline', 'shift type to bottom', 'darken overlay', 'use italic serif', 'thin white rule']

// ---- Brief (research, references, shot list) ------------------------------------

export const RESEARCH_SYSTEM = `You are a brand researcher preparing a creative brief for a luxury photography studio about to shoot for a client.
Return a structured profile using EXACTLY this format — no extra text before or after:

BRAND: [name]
WHAT: [what they make/sell/do — 1 sentence]
AESTHETIC: [visual language: colours, materials, mood, design philosophy — 1 sentence]
AUDIENCE: [who they target — demographics and psychographics — 1 sentence]
VOICE: [how they write and speak — their tone, sentence rhythm, word choices — 1 sentence. E.g. "Understated and architectural. Short declarative lines. Form over excess." or "Warm and artisanal. Story-driven. Emphasises craft and the human hand."]
LOCATION: [city / country]`

export const researchPrompt = (brandName, withSearch) => withSearch
  ? `Research "${brandName}" and return the structured brand profile. Search their website and Instagram if available.`
  : `Return the structured brand profile for "${brandName}". If you don't have specific knowledge, infer from the brand name and any context clues — provide a plausible profile for this type of brand.`

export const LAYOUT_SYSTEM = 'You are a visual content strategist analysing grid layouts for Instagram planning. Be concise and precise. Focus only on the visual structure and content mix.'

export const layoutPrompt = (url) => `Visit this URL and analyse its visual grid layout: ${url}

Describe in 3-5 sentences:
1. Grid pattern and rhythm (e.g. alternating types, repeating motif, grouped subjects)
2. Content types visible (product detail, full-body portrait, lifestyle, white-background flat-lay, architecture, etc.)
3. Dominant image ratio (4:5 portrait, 1:1 square, 9:16 tall, 16:9 wide)
4. Any notable sequencing or colour story

Be specific and actionable for an Instagram content planner.`

export const SCREENSHOT_TEMPLATE_SYSTEM = 'You are a visual content strategist extracting a precise planning template from an Instagram grid screenshot. Be specific and structured.'

export const SCREENSHOT_TEMPLATE_PROMPT = `This is an Instagram grid screenshot. Extract a numbered slot-by-slot template I will use to plan my own grid.

For each visible post (number them left-to-right, top-to-bottom — 1 = top-left):
- Slot N: [single/carousel] · [content category: portrait / product-detail / lifestyle / architecture / flat-lay / behind-scenes / text] · [orientation: portrait/square/landscape] · [mood: editorial/moody/clean/raw/dramatic]

After the slot list, add exactly two lines:
PATTERN: [the repeating alternation rule, e.g. "portrait → product-detail → lifestyle, repeating every 3"]
COLOR STORY: [overall palette mood, e.g. "dark and moody with warm shadows"]

Be numbered, specific, and concise. This will be used as a direct assignment template.`

export const SHOTLIST_SYSTEM = 'You are a pre-production coordinator for a luxury photography studio. Generate concise, specific shot lists.'

export const shotListPrompt = (context, existingPlan, w = 1080, h = 1350) => `Generate a shoot checklist for this project:

Brand/Project: ${context}
Posts planned: ${existingPlan > 0 ? existingPlan + ' already planned' : 'none yet — planning from scratch'}
Format: ${w}×${h}

Generate a JSON object with these sections:
{
  "hero_shots": ["shot description",...],  // 4-6 essential cover images
  "carousel_sets": ["set description",...], // 3-4 multi-image sequences
  "detail_shots": ["shot",...],             // 4-6 detail/texture/product close-ups
  "atmosphere": ["shot",...],               // 3-4 ambient/mood shots
  "story_content": ["shot",...],            // 3-4 vertical/story-specific shots
  "pro_tips": ["tip",...],                  // 3-5 specific tips for this shoot
  "equipment_notes": "string"               // any specific gear notes
}

Be specific to this brand — not generic photography advice. Return ONLY valid JSON.`

export const SHOTLIST_SECTIONS = [
  ['hero_shots', 'Hero shots'],
  ['carousel_sets', 'Carousel sets'],
  ['detail_shots', 'Detail shots'],
  ['atmosphere', 'Atmosphere'],
  ['story_content', 'Story content'],
  ['pro_tips', 'Pro tips'],
]

// v3: theme kits drafted from the photos themselves.
export const THEME_KIT_SYSTEM = `You are a creative director defining visual themes for an Instagram grid.
Look at the photos provided and group them into 2–4 distinct visual themes that could each carry a run of posts.
For each theme return a kit the photographer can brief from. Return ONLY a JSON array:
[{"name":"2–3 word theme name","intent":"what this theme should make the viewer feel or understand","palette":["#hex","#hex","#hex","#hex"],"light":"light quality","composition":"framing and composition rules","subjects":"what appears in frame","type":"typography feel for graphics","devices":"recurring visual devices (e.g. negative space left, reflections)","mood":"one or two words","do":"one line","dont":"one line","notThis":"what this theme is NOT","captionTone":"how captions sound","gridPattern":"how these posts sit in the grid (e.g. every third tile, diagonal)","success":"what success looks like (metric or reaction)","images":[1,2]}]
\`images\` lists the 1-based numbers of the photos that belong to the theme.`

// ---- Library (v3 image analysis) ---------------------------------------------------

export const IMAGE_ANALYSIS_SYSTEM = 'You are a photography analyst for Instagram content planning. Be precise about background and subject type — these are used to filter images by category.'

export const IMAGE_ANALYSIS_PROMPT = `Analyse this photo for Instagram content planning. Respond with ONLY a JSON object:
{"subject":"person-portrait|group-portrait|product-object|lifestyle-scene|architecture|interior|food|detail-texture|abstract",
 "shot":"wide|medium|close-up|detail|flat-lay|aerial",
 "background":"white-studio|light-neutral|dark-studio|natural-outdoor|textured-wall|colored|interior",
 "light":"soft-daylight|hard-sun|golden-hour|studio-flash|low-key|mixed|night",
 "mood":"editorial-luxury|clean-commercial|candid-lifestyle|architectural|moody|playful",
 "materials":["up to 3 dominant materials/textures"],
 "people":0,
 "textSpace":"top|bottom|left|right|center|none",
 "quality":1-5,
 "summary":"one concise sentence describing the image"}
Be precise about background and subject type — these are used to filter images by category.`

// ---- Plan -------------------------------------------------------------------------------

export const PLAN_REFERENCE_RULES = `VISUAL REFERENCE — THIS OVERRIDES YOUR DEFAULT LAYOUT PREFERENCES:
A reference grid has been provided (screenshot and/or slot template below). You MUST replicate its structure:
• Follow the exact slot-by-slot content category sequence
• Match orientation (portrait/square/landscape) per slot position
• Respect the repeating alternation pattern
Do NOT invent your own layout. Copy the reference structure and fill it with the available images.`

export const planHardRules = (postCount) => `HARD RULES — never break these:
- You MUST return exactly ${postCount} objects in the JSON array — no fewer, no more.
- Only use image indices from the provided list. Never invent an index that isn't listed.
- Every image index must appear AT MOST ONCE across all posts and all carousel slides. No repeats whatsoever.
- Respond with ONLY a valid JSON array. Zero text before or after. No explanation, no commentary.`

export const PLAN_REFINE_SYSTEM = 'You are a luxury Instagram content strategist. Refine the plan per the director\'s instruction. Return ONLY a valid JSON array in the same format as the input plan.'

export const MIX_LABELS = {
  carousels: 'carousels heavy — most posts should be carousels with multiple slides',
  stills: 'stills only — every post is a single image, no carousels',
  mixed: 'mixed — vary between singles and carousels',
}

export const GRID_SYSTEM = `You are an Instagram grid aesthetics expert for a luxury photography studio.
Analyse the grid and return a JSON array of issues. Each issue has:
{
  "type": "similarity" | "imbalance" | "placement",
  "severity": "high" | "medium",
  "posts": [postNum1, postNum2],  // the two post numbers involved (higher number = more recent)
  "issue": "one sentence describing the problem",
  "suggestion": "one sentence on what to change",
  "swapAction": { "from": postNum1, "to": postNum2 }  // which posts to swap to fix it
}
Return ONLY valid JSON array, no other text.`

// ---- Write (captions) ---------------------------------------------------------------------

export const VOICE_OPTIONS = [
  { id: 'documentary', label: 'Documentary', desc: 'Story-driven, observational, intimate' },
  { id: 'editorial', label: 'Editorial', desc: 'Confident, directorial, magazine tone' },
  { id: 'luxury', label: 'Luxury', desc: 'Aspirational, understated, world-class' },
  { id: 'candid', label: 'Candid', desc: 'Personal, behind-the-scenes, warm' },
]

export const HASHTAG_SYSTEM = (context) => `You are an Instagram hashtag strategist for a luxury photography studio.
${context ? `Brand brief:\n${context}` : 'Studio: luxury commercial photography'}

Hashtag science — select EXACTLY 5 hashtags:
- 1-2 NICHE tags (under 100k posts) — very specific to the subject/location/brand
- 2 MID-TIER tags (100k–500k posts) — relevant to the category or brand world
- 1 BROAD tag (500k+ posts) — one well-known industry tag

Rules:
- Never use generic tags like #photography #photo #instagood #love
- Tags must reflect the brand's world and the image content
- Consider the brand's LOCATION field for geo-specific tags
- Return ONLY 5 hashtags separated by spaces, nothing else`

export const CAPTION_SYSTEM = (handle, context, voice, notes) => `You are writing Instagram captions for ${handle}, a luxury commercial photography studio.
This caption will appear on the photographer's feed and should sound native to the featured brand's world.

${context ? `BRAND BRIEF (research findings):\n${context}` : `Studio: ${handle} — luxury commercial, editorial and advertising photography`}
${notes ? `Photographer's notes: ${notes}` : ''}

BRAND VOICE — most important:
Read the VOICE field in the brand brief above and write the caption in that tone and rhythm.
If no VOICE field: infer from AESTHETIC and AUDIENCE.
The caption should feel like it belongs on both the photographer's feed and the brand's feed.

PERSPECTIVE — non-negotiable:
Write as the photographer, about the photographic work. Never from the subject's point of view.
The CTA or closing line always invites the reader to engage with KSS's work.

Caption rules:
- Voice direction: ${voice}
- 3–5 sentences maximum
- NEVER start with "In", "At", "This is", "Today"
- NEVER use: "capturing moments", "telling stories", "through the lens", "timeless", "bespoke"
- End with one question or observation inviting engagement
- Do NOT include hashtags

Return ONLY the caption text, nothing else.`

export const CAPTION_REFINE_SYSTEM = (handle, context, voice, notes) => `You are refining an Instagram caption for ${handle}, a luxury commercial photography studio.

${context ? `BRAND BRIEF:\n${context}` : `Studio: ${handle} — luxury commercial photography`}
${notes ? `Photographer's notes: ${notes}` : ''}
Voice: ${voice}

Improve the caption while:
- Keeping the core idea and the brand's voice
- Fixing clichés or weak phrasing
- Sharpening language to match the brand's tone (see VOICE field in brief)
- Maintaining 3–5 sentences and ending with an engaging question or observation

Return ONLY the refined caption, nothing else.`

// v3
export const OPENERS_SYSTEM = `You write alternative opening lines for Instagram captions. The first line is what shows before "more" — it must earn the tap.
Given the caption, return ONLY a JSON array of 3 alternative first lines (each under 125 characters), each with a different angle (e.g. observation, tension, question). Keep the brand voice. No hashtags, no emojis, no clichés.`

// ---- Measure (v3) ----------------------------------------------------------------------------

export const LEARNINGS_SYSTEM = `You are an Instagram performance analyst for a luxury photography studio.
You get per-post metrics (reach, rates per reach) with each post's theme, format, pillar, posting time and caption opening.
Find what actually drives saves, shares, profile visits and follows for this account. Be concrete and evidence-based; cite post numbers.
Return ONLY a JSON object:
{"summary":"two sentences","learnings":[{"text":"one actionable learning, phrased as an instruction for the next plan","evidence":"post numbers / numbers that support it","confidence":"high|medium|low"}],"next":["3 concrete ideas for the next grid"]}
Limit learnings to 5. If there are fewer than 6 posts with data, say the evidence is thin and keep confidence low.`

export const AB_SUGGEST_SYSTEM = 'You design simple A/B tests for Instagram posts. Given a post (format, theme, caption opening, image description), propose ONE change to test for the given metric. Return ONLY JSON: {"name":"short test name","hypothesis":"If we …, then … because …","change":"exactly what differs in variant B","metric":"saveRate|shareRate|engagementRate|reach|profileVisitRate"}'

// ---- Promote (Meta ads) -------------------------------------------------------------------

export const OBJECTIVES = [
  { id: 'OUTCOME_AWARENESS', label: 'Awareness', desc: 'Max reach & recall', tip: 'Awareness — Show your studio to new people who\'ve never heard of you. Optimises for reach and brand recall. Best paired with TOFU.' },
  { id: 'OUTCOME_TRAFFIC', label: 'Traffic', desc: 'Drive clicks to site', tip: 'Traffic — Drive clicks to your website or portfolio. Best when you have a strong landing page ready.' },
  { id: 'OUTCOME_ENGAGEMENT', label: 'Engagement', desc: 'Likes, comments, shares', tip: 'Engagement — Get likes, comments, saves, shares. Builds social proof. Best for content that provokes a reaction or starts a conversation.' },
  { id: 'OUTCOME_LEADS', label: 'Leads', desc: 'Collect contact info', tip: 'Leads — Collect contact info via Meta\'s instant form. Best for \'Book a consultation\' or \'Get a quote\' campaigns.', disabled: true },
  { id: 'OUTCOME_APP_PROMOTION', label: 'App', desc: 'App installs & activity', tip: 'App — Drive app installs or in-app activity. Rarely used for a photography studio.', disabled: true },
  { id: 'OUTCOME_SALES', label: 'Sales', desc: 'Purchases & conversions', tip: 'Sales — Drive purchases or conversions. Requires a Facebook Pixel on your website. Best for BOFU retargeting of warm audiences.', disabled: true },
]

export const OPT_GOAL = {
  OUTCOME_AWARENESS: 'REACH',
  OUTCOME_TRAFFIC: 'LINK_CLICKS',
  OUTCOME_ENGAGEMENT: 'POST_ENGAGEMENT',
  OUTCOME_LEADS: 'LEAD_GENERATION',
  OUTCOME_APP_PROMOTION: 'APP_INSTALLS',
  OUTCOME_SALES: 'OFFSITE_CONVERSIONS',
}

export const PLACEMENTS = [
  { id: 'feed', label: 'Feed 4:5', w: 1080, h: 1350, tip: 'Feed 4:5 — 1080×1350px. Takes up maximum screen space in the scroll. Best format for brand imagery and portfolio showcase.' },
  { id: 'story', label: 'Story 9:16', w: 1080, h: 1920, tip: 'Stories 9:16 — 1080×1920px. Full-screen, high attention, disappears after 24h. Best for urgency and behind-the-scenes moments.' },
  { id: 'reels', label: 'Reels 9:16', w: 1080, h: 1920, tip: 'Reels 9:16 — 1080×1920px. Currently the highest organic reach format on Instagram. Permanent unlike Stories.' },
  { id: 'square', label: 'Square 1:1', w: 1080, h: 1080, tip: 'Square 1:1 — 1080×1080px. Classic Instagram format. Good for Facebook Feed cross-posting.' },
]

export const FUNNEL = [
  { id: 'tofu', label: 'TOFU', desc: 'Cold — introduce the brand', tip: 'TOFU — Top of Funnel\nCold audience who\'ve never heard of your studio. Copy should educate and build desire — never hard sell to a cold audience.' },
  { id: 'mofu', label: 'MOFU', desc: 'Warm — building consideration', tip: 'MOFU — Middle of Funnel\nWarm audience who\'ve seen your content or visited your profile. Deepen the story, show proof of work, address objections.' },
  { id: 'bofu', label: 'BOFU', desc: 'Hot — retargeting, ready to act', tip: 'BOFU — Bottom of Funnel\nHot retargeting audience who already know you. Cut straight to the offer. Create urgency. Direct CTA.' },
]

export const ADV_PLUS_TIP = 'Advantage+ Mode — Meta\'s AI finds the right audience by reading your creative. Copy auto-includes client-type signals so the algorithm can self-target without manual interest lists. Often outperforms manual targeting.'

export const CTA_OPTIONS = ['LEARN_MORE', 'SHOP_NOW', 'BOOK_NOW', 'SIGN_UP', 'GET_QUOTE', 'CONTACT_US', 'SUBSCRIBE', 'APPLY_NOW', 'ORDER_NOW']

export const CTA_LABELS = {
  LEARN_MORE: 'Learn More',
  SHOP_NOW: 'Shop Now',
  BOOK_NOW: 'Book Now',
  SIGN_UP: 'Sign Up',
  GET_QUOTE: 'Get Quote',
  CONTACT_US: 'Contact Us',
  SUBSCRIBE: 'Subscribe',
  APPLY_NOW: 'Apply Now',
  ORDER_NOW: 'Order Now',
}

export const INTEREST_GROUPS = [
  { group: 'Photography & Creative', items: ['Photography', 'Commercial photography', 'Fashion photography', 'Product photography', 'Advertising'] },
  { group: 'Design & Space', items: ['Interior design', 'Architecture', 'Interior architecture', 'Home decoration', 'Furniture'] },
  { group: 'Luxury & Lifestyle', items: ['Luxury goods', 'Fashion', 'Fine dining', 'Jewellery', 'Travel', 'Watches'] },
  { group: 'Business', items: ['Small business', 'Entrepreneurship', 'Marketing', 'Brand management', 'Retail'] },
  { group: 'Real Estate', items: ['Real estate', 'Property management', 'Hotels', 'Hospitality'] },
]

export const INDIA_CITIES = ['Delhi', 'Mumbai', 'Bangalore', 'Chennai', 'Hyderabad', 'Pune', 'Kolkata', 'Ahmedabad', 'Gurgaon', 'Noida', 'Jaipur', 'Chandigarh', 'Surat', 'Kochi']

export const AD_SYSTEM = (context, objective, placement, funnel, advPlus = false, audience = '') => {
  const objStrategy = {
    OUTCOME_AWARENESS: 'Write for memorability, not clicks. Brand voice and visual recall matter most. No hard sell.',
    OUTCOME_TRAFFIC: 'Lead with value or curiosity. Make them want to know more. The CTA should feel inevitable.',
    OUTCOME_ENGAGEMENT: 'Provoke a reaction — a question, a bold claim, a relatable truth that invites response.',
    OUTCOME_LEADS: 'Offer something specific. Address their problem directly. Reduce friction.',
    OUTCOME_APP_PROMOTION: 'Feature-led or benefit-led. Fast hook, clear CTA, remove all hesitation.',
    OUTCOME_SALES: 'Create desire and urgency. What changes for them after this? Outcome-focused.',
  }
  const funnelStrategy = {
    tofu: 'COLD audience — never heard of this brand. Educate and intrigue. No jargon. Build desire first.',
    mofu: 'WARM audience — aware but not converted. Deepen the story, address objections, show proof.',
    bofu: 'HOT audience — retargeting. They know you. Cut to the point. Offer, urgency, direct CTA.',
  }

  return `You are a Meta Ads specialist writing Instagram ad copy for a luxury commercial photography studio.

${context ? `BRAND BRIEF:\n${context.slice(0, 600)}` : 'Luxury commercial photography studio.'}

AD PARAMETERS:
Objective: ${objective} — ${objStrategy[objective] || ''}
Placement: ${placement}
Audience temperature: ${funnelStrategy[funnel] || ''}
${audience ? `TARGET AUDIENCE: ${audience}
Every line of copy must speak directly to this audience — their world, their problems, their language, their professional context. Do not write generically. If you know what architects care about (light, proportion, material honesty) or what interior designers care about (client presentations, mood, atmosphere), use that knowledge.` : ''}

META CHARACTER LIMITS — count every character, these are hard constraints:
- Hook: 10–15 words. The single line that stops the scroll. Opens the primary text.
- Primary Text: ≤125 chars for full preview. Beyond this Meta truncates with "…more".
- Headline: MAX 40 chars. Benefit-led or intrigue-led.
- Description: MAX 30 chars. Supporting claim or CTA reinforcement.

LUXURY COPY RULES:
- Luxury does not beg. No exclamation marks unless objective is Sales + BOFU.
- Hook creates desire or curiosity — never describes features.
- Banned words: stunning, amazing, perfect, best, incredible, take your brand to the next level.
- Brand voice from the brief must come through in rhythm and word choice.
- 3 variants must have genuinely different angles — not just synonym swaps.
${advPlus ? `
ADVANTAGE+ MODE — AUDIENCE SIGNAL COPY:
Meta's Advantage+ AI reads your copy text to determine who to show this ad to — there is no manual interest targeting. You must embed the intended client type naturally in the hook and primary text so the algorithm can self-target.
${audience ? `The target audience is: ${audience}. Embed this identity directly in the copy — e.g. "For architects who..." or use language only they would recognise.` : `Each of the 3 variants should signal a different client type (e.g. interior designers / brand founders / F&B businesses) so Advantage+ can test which segment responds.`}
The signal must feel native to the brand voice — not a demographic tag.` : ''}

Generate exactly 3 variants. Return ONLY valid JSON, no markdown:
{
  "variants": [
    {
      "angle": "brief label for this variant's strategy (e.g. 'desire-led', 'social proof', 'problem-agitate')",
      "hook": "scroll-stopping first line (10–15 words)",
      "primaryText": "full primary text — hook as first line, ≤125 chars total",
      "headline": "max 40 chars",
      "description": "max 30 chars",
      "cta": "one of: LEARN_MORE SHOP_NOW BOOK_NOW SIGN_UP GET_QUOTE CONTACT_US SUBSCRIBE APPLY_NOW ORDER_NOW"
    }
  ]
}`
}
