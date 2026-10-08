// The brief coach: ready-made answers so nobody faces a blank box. Everything here works
// offline and updates as the user types; Claude adds sharper, client-specific ideas on top.

// ---- Goals --------------------------------------------------------------------------------

export const GOAL_GROUPS = [
  { group: 'Engagement', items: ['Grow followers', 'More saves and shares', 'Spark comments and conversation', 'Build a loyal community', 'Get known in a new city'] },
  { group: 'Sales', items: ['Drive online sales', 'Get more DMs and enquiries', 'Fill bookings and appointments', 'Collect leads (calls, WhatsApp, forms)', 'Launch something new', 'Bring people to the store or event', 'Build trust and reviews'] },
]
export const GOAL_PRESETS = GOAL_GROUPS.flatMap((g) => g.items)

// Calls to action that serve each goal.
const GOAL_CTA = {
  'Grow followers': ['Follow for more like this'],
  'More saves and shares': ['Save this for later', 'Send this to someone who needs it'],
  'Spark comments and conversation': ['Tell us in the comments', 'Which one would you pick: 1 or 2?'],
  'Build a loyal community': ['Tag us to be featured'],
  'Get known in a new city': ['Follow to see what we do next'],
  'Drive online sales': ['Shop via the link in bio', 'Tap the tag to buy'],
  'Get more DMs and enquiries': ['DM us "PRICE" for details', 'Send us a DM to check availability'],
  'Fill bookings and appointments': ['Book via the link in bio', 'DM to block your date'],
  'Collect leads (calls, WhatsApp, forms)': ['WhatsApp us, link in bio', 'Comment "INFO" and we’ll DM you'],
  'Launch something new': ['Turn on post notifications', 'Join the waitlist, link in bio'],
  'Bring people to the store or event': ['Visit us this weekend, directions in bio'],
  'Build trust and reviews': ['Read client stories in our highlights'],
}

// ---- Categories ----------------------------------------------------------------------------

// Keyword-matched against the client, offer and audience text. Order matters only for ties.
export const CATEGORIES = [
  {
    id: 'photography', label: 'Photography or film', keywords: ['photo', 'studio', 'shoot', 'film', 'cinemat', 'videograph'],
    offer: 'Photography for brands, hotels and families',
    target: 'Brand owners and marketing heads who need images that sell',
    voice: ['Observant', 'Cinematic', 'Assured', 'Crafted'],
    dos: ['Show the setup behind one hero frame', 'Credit the client and the team', 'Pair a final image with its raw frame'],
    donts: ['No watermarks across the image', 'No over-retouched skin'],
    cta: ['DM to check your date', 'Enquire via the link in bio'],
    tags: ['photographer', 'brandphotography', 'commercialphotography'],
  },
  {
    id: 'fashion', label: 'Fashion and apparel', keywords: ['fashion', 'apparel', 'cloth', 'wear', 'saree', 'sari', 'kurta', 'lehenga', 'couture', 'label$', 'ethnic', 'tshirt', 'denim'],
    offer: 'Handcrafted occasion wear for women',
    target: 'Women 25–40 who shop for weddings and festive season',
    voice: ['Confident', 'Playful', 'Elegant', 'Of the moment'],
    dos: ['Show the fit on real bodies', 'Close-ups of fabric and finish', 'Style one piece three ways'],
    donts: ['No flat lays without context', 'No “sale sale sale” captions'],
    cta: ['Shop the look via the link in bio', 'DM for size and fit help'],
    tags: ['indianfashion', 'ethnicwear', 'ootdindia'],
  },
  {
    id: 'jewellery', label: 'Jewellery', keywords: ['jewel', 'gold', 'diamond', 'silver', 'rings?$', 'kundan', 'polki', 'bridal set'],
    offer: 'Fine jewellery for brides and gifting',
    target: 'Brides-to-be and their families, plus self-gifting women 28–45',
    voice: ['Timeless', 'Intimate', 'Refined'],
    dos: ['Show scale on the hand or neck', 'Tell the story behind each design', 'Shoot in warm natural light'],
    donts: ['No harsh flash reflections', 'No cluttered backgrounds'],
    cta: ['Book a private viewing', 'DM for the price list'],
    tags: ['finejewellery', 'bridaljewellery', 'jewelleryindia'],
  },
  {
    id: 'food', label: 'Food, café or restaurant', keywords: ['food', 'cafe', 'café', 'restaurant', 'bakery', 'kitchen', 'chef', 'coffee', 'sweets', 'mithai', 'bar$', 'bars$', 'dining', 'cake', 'f&b', 'cocktail', 'drinks', 'brewery', 'pub$', 'lounge', 'bistro', 'menu'],
    offer: 'A neighbourhood café with all-day breakfast',
    target: 'Young professionals and families nearby who eat out on weekends',
    voice: ['Warm', 'Witty', 'Generous', 'Local'],
    dos: ['Show food being made, not just plated', 'Feature the people behind the counter', 'Post the dish of the day before noon'],
    donts: ['No cold, over-styled plates', 'No blurry night shots'],
    cta: ['Reserve via the link in bio', 'Order on Swiggy or Zomato', 'See you this weekend'],
    tags: ['foodie', 'cafesofindia', 'indianfood'],
  },
  {
    id: 'beauty', label: 'Beauty, skincare or salon', keywords: ['beauty', 'skin', 'salon', 'makeup', 'cosmetic', 'hair', 'spa$', 'nail', 'derma'],
    offer: 'Clean skincare made for Indian weather',
    target: 'Women 22–40 who research ingredients before they buy',
    voice: ['Honest', 'Caring', 'Expert', 'Calm'],
    dos: ['Show real skin, with texture', 'Explain one ingredient per post', 'Share customer before and afters with consent'],
    donts: ['No fake results or heavy filters', 'No fear-based claims'],
    cta: ['Shop via the link in bio', 'DM us your skin type for a routine'],
    tags: ['skincareindia', 'indianbeauty', 'salonlife'],
  },
  {
    id: 'fitness', label: 'Fitness or wellness', keywords: ['fitness', 'gym', 'yoga', 'wellness', 'pilates', 'nutrition', 'diet', 'coach', 'workout', 'health'],
    offer: 'Small-batch strength classes and online coaching',
    target: 'Busy professionals 25–45 who want to get fit without a crash diet',
    voice: ['Encouraging', 'No-nonsense', 'Energetic'],
    dos: ['Show real members and real progress', 'Teach one move per post', 'Share quick wins people can try today'],
    donts: ['No shirtless shock transformations', 'No shaming language'],
    cta: ['Book a free trial class', 'Comment "PLAN" for the workout'],
    tags: ['fitnessindia', 'yogaindia', 'homeworkout'],
  },
  {
    id: 'realestate', label: 'Real estate', keywords: ['real estate', 'property', 'apartment', 'flats?$', 'builder', 'realty', 'plot', 'villa', 'bhk', 'homes'],
    offer: 'Premium 3 and 4 BHK homes in a gated community',
    target: 'Families and NRIs 32–55 looking to upgrade or invest',
    voice: ['Trustworthy', 'Aspirational', 'Clear'],
    dos: ['Show the view, light and neighbourhood', 'Walkthrough reels of real units', 'Put the price range up front'],
    donts: ['No render-only feeds', 'No vague “luxury living” lines'],
    cta: ['Book a site visit', 'WhatsApp us for the brochure'],
    tags: ['realestateindia', 'luxuryhomes', 'newlaunch'],
  },
  {
    id: 'hospitality', label: 'Hotel, stay or travel', keywords: ['hotel', 'resort', 'stay', 'homestay', 'travel', 'tours?$', 'retreat', 'boutique hotel', 'trip'],
    offer: 'A boutique hill-station retreat with twelve rooms',
    target: 'Couples and small families from metros planning long weekends',
    voice: ['Unhurried', 'Evocative', 'Gracious'],
    dos: ['Show the moment, not just the room', 'Post guest stories and morning rituals', 'Mention the drive time from the nearest city'],
    donts: ['No empty wide-angle rooms', 'No overused “paradise” captions'],
    cta: ['Book direct via the link in bio', 'DM for long-weekend dates'],
    tags: ['incredibleindia', 'boutiquehotel', 'weekendgetaway'],
  },
  {
    id: 'education', label: 'Education or coaching', keywords: ['course', 'coaching', 'class', 'academy', 'school', 'tutor', 'learn', 'workshop', 'mentor', 'training'],
    offer: 'Live online courses for working professionals',
    target: 'Graduates and professionals 21–35 who want to switch or grow careers',
    voice: ['Clear', 'Motivating', 'Credible'],
    dos: ['Teach something useful in every post', 'Share student outcomes with names', 'Use carousels for step-by-step'],
    donts: ['No guaranteed-job promises', 'No jargon without explaining it'],
    cta: ['Join the free masterclass', 'Comment "GUIDE" for the notes'],
    tags: ['upskill', 'careertips', 'learnoninstagram'],
  },
  {
    id: 'interiors', label: 'Home and interiors', keywords: ['interior', 'decor', 'furniture', 'architect', 'home decor', 'furnishing', 'design studio', 'lighting'],
    offer: 'Turnkey interiors for apartments and villas',
    target: 'Homeowners 30–50 who just bought or are renovating',
    voice: ['Considered', 'Warm', 'Detail-led'],
    dos: ['Show before and after', 'Explain the why behind one design choice', 'Feature materials up close'],
    donts: ['No renders passed off as real', 'No cluttered styling'],
    cta: ['Book a design consultation', 'DM us your floor plan'],
    tags: ['interiordesignindia', 'homedecor', 'indianhomes'],
  },
  {
    id: 'events', label: 'Weddings and events', keywords: ['wedding', 'event', 'venue', 'celebration', 'planner', 'decorator', 'mehendi', 'sangeet', 'banquet'],
    offer: 'End-to-end wedding planning and décor',
    target: 'Couples 25–34 and their parents planning a wedding in the next year',
    voice: ['Joyful', 'Reassuring', 'Elegant'],
    dos: ['Show the couple’s story, not just décor', 'Behind-the-scenes of the setup', 'Feature real testimonials'],
    donts: ['No reused stock décor', 'No overcrowded collages'],
    cta: ['DM to check your dates', 'Book a planning call'],
    tags: ['indianwedding', 'weddingplanner', 'weddingdecor'],
  },
  {
    id: 'handmade', label: 'Handmade or D2C products', keywords: ['handmade', 'artisan', 'candle', 'craft', 'gift', 'pottery', 'organic', 'd2c', 'small batch'],
    offer: 'Small-batch handmade products for gifting',
    target: 'Urban women 25–40 who buy thoughtful gifts online',
    voice: ['Personal', 'Warm', 'Thoughtful'],
    dos: ['Show the hands that make it', 'Show packing and unboxing', 'Repost customer photos'],
    donts: ['No discount-led feeds', 'No stock lifestyle images'],
    cta: ['Shop via the link in bio', 'DM for bulk and corporate gifting'],
    tags: ['handmadeinindia', 'smallbusinessindia', 'giftideas'],
  },
  {
    id: 'tech', label: 'App, software or startup', keywords: ['app$', 'apps$', 'software', 'saas', 'startup', 'platform', 'tech', 'ai$', 'fintech'],
    offer: 'An app that helps small businesses track payments',
    target: 'Founders and small-business owners who live on their phone',
    voice: ['Smart', 'Friendly', 'Straightforward'],
    dos: ['Show the product solving one real problem', 'Use short screen-recording reels', 'Feature customers by name'],
    donts: ['No feature lists without a benefit', 'No buzzwords'],
    cta: ['Download via the link in bio', 'Comment "DEMO" for a walkthrough'],
    tags: ['startupindia', 'smallbusiness', 'productivity'],
  },
]

const GENERIC = {
  voice: ['Warm', 'Confident', 'Honest', 'Playful', 'Premium', 'Expert', 'Down to earth', 'Bold'],
  dos: ['Show real customers and real results', 'Lead with the benefit in the first line', 'Show the process behind the product', 'Reply to every comment within a day'],
  donts: ['No stock photos', 'No more than five hashtags', 'No walls of text on images', 'No engagement bait like “like if you agree”'],
  cta: ['DM us to know more', 'Link in bio'],
}

// Keywords match at a word start ("photo" finds "photographer"); a trailing $ means the
// whole word only, so "app" doesn't match "apparel".
const keywordRe = (k) => (k.endsWith('$') ? new RegExp(`\\b(?:${k.slice(0, -1)})\\b`) : new RegExp(`\\b${k}`))

export function categoryFor(brief = {}) {
  if (brief.category) {
    const picked = CATEGORIES.find((c) => c.id === brief.category)
    if (picked) return picked
  }
  const text = [brief.client, brief.offer, brief.target].join(' ').toLowerCase()
  if (!text.trim()) return null
  let best = null
  let bestScore = 0
  for (const c of CATEGORIES) {
    const score = c.keywords.reduce((s, k) => s + (keywordRe(k).test(text) ? k.length : 0), 0)
    if (score > bestScore) { best = c; bestScore = score }
  }
  return best
}

const uniq = (list) => {
  const seen = new Set()
  return list.filter((x) => {
    const k = String(x || '').trim().toLowerCase()
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// Instant suggestions for each field. Claude's ideas (when present) come first.
export function offlineIdeas(brief = {}, ai = null) {
  const cat = categoryFor(brief)
  const goals = brief.goals || []
  const goalCta = goals.flatMap((g) => GOAL_CTA[g] || [])
  return {
    category: cat,
    goals: uniq([...(ai?.goals || [])]),
    voice: uniq([...(ai?.voice || []), ...(cat?.voice || []), ...GENERIC.voice]).slice(0, 10),
    dos: uniq([...(ai?.dos || []), ...(cat?.dos || []), ...GENERIC.dos]).slice(0, 8),
    donts: uniq([...(ai?.donts || []), ...(cat?.donts || []), ...GENERIC.donts]).slice(0, 8),
    cta: uniq([...(ai?.cta || []), ...goalCta, ...(cat?.cta || []), ...GENERIC.cta]).slice(0, 8),
    target: uniq([...(ai?.target || []), cat?.target]).slice(0, 3),
    tags: cat?.tags || [],
  }
}

// ---- Turning picks into stored text ----------------------------------------------------------

// Each text field has its own separator so a user's own commas inside a sentence survive.
export const SEPARATORS = { voice: ', ', cta: ' · ', dos: '\n', donts: '\n' }
const SPLIT = { voice: /,/, cta: /·|\n/, dos: /\n/, donts: /\n/ }

export function listOf(field, value) {
  return String(value || '').split(SPLIT[field] || /\n/).map((s) => s.replace(/^[-•\s]+/, '').trim()).filter(Boolean)
}

export function hasItem(field, value, item) {
  const k = item.trim().toLowerCase()
  return listOf(field, value).some((x) => x.toLowerCase() === k)
}

export function toggleItem(field, value, item) {
  const sep = SEPARATORS[field] || '\n'
  if (hasItem(field, value, item)) {
    const k = item.trim().toLowerCase()
    return listOf(field, value).filter((x) => x.toLowerCase() !== k).join(sep)
  }
  const v = String(value || '').trimEnd()
  return v ? `${v}${sep}${item}` : item
}

// ---- Voice by "this or that" ----------------------------------------------------------------

export const VOICE_PAIRS = [
  ['Playful', 'Serious'],
  ['Warm', 'Cool and composed'],
  ['Bold', 'Understated'],
  ['Expert', 'Friendly'],
  ['Premium', 'Accessible'],
  ['Traditional', 'Modern'],
]

export const AGE_BANDS = [[18, 24], [25, 34], [35, 44], [45, 54], [55, 65]]

// Competitor handles split from free text: "@a, @b c" -> ['@a', '@b', '@c']
export function handlesOf(text) {
  return String(text || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
}

export const BRIEF_IDEAS_SYSTEM = `You help Indian small businesses and studios set up an Instagram content brief. The client wants to boost engagement and drive sales.
Given what is known so far, suggest short, specific options the client can tap to accept. Write for India. Plain words, no emojis, no hashtags.
Return ONLY JSON:
{"goals":["3-4 specific 90-day Instagram goals, max 8 words each"],
 "voice":["5 single words or two-word phrases describing how the brand should sound"],
 "dos":["4 concrete content rules starting with a verb, max 9 words"],
 "donts":["4 things to avoid, each starting with No, max 9 words"],
 "cta":["4 calls to action suited to Instagram and the goal, max 8 words"],
 "target":["2 one-sentence descriptions of the most likely buyer"]}`

export const COMPETITOR_SYSTEM = `You research Instagram competitors and inspiration for an Indian brand. Use web search to find REAL, currently active Instagram accounts and useful articles. Never invent a handle; if unsure, leave it out.
Return ONLY JSON:
{"handles":[{"handle":"@exact_handle","name":"Brand name","why":"one line: what to learn from them"}],
 "articles":[{"title":"Article title","url":"https://...","why":"one line: why it helps this brand's Instagram"}]}
Give up to 6 handles (mix of direct competitors in India and aspirational brands) and up to 4 articles.`
