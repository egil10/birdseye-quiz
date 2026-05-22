// Maps every country in scripts/cities.mjs to its lowercase ISO 3166-1 alpha-2
// code (the format flagcdn.com uses). Centralised here so app.js and
// explore.js share one source of truth.

export const COUNTRY_ISO = {
  // Europe
  "United Kingdom": "gb",
  "France": "fr",
  "Italy": "it",
  "Germany": "de",
  "Spain": "es",
  "Netherlands": "nl",
  "Austria": "at",
  "Czechia": "cz",
  "Greece": "gr",
  "Portugal": "pt",
  "Ireland": "ie",
  "Sweden": "se",
  "Denmark": "dk",
  "Finland": "fi",
  "Norway": "no",
  "Poland": "pl",
  "Hungary": "hu",
  "Russia": "ru",
  "Turkey": "tr",
  "Belgium": "be",
  "Switzerland": "ch",
  "Romania": "ro",
  "Bulgaria": "bg",
  "Serbia": "rs",
  "Croatia": "hr",
  "Slovenia": "si",
  "Bosnia and Herzegovina": "ba",
  "North Macedonia": "mk",
  "Albania": "al",
  "Estonia": "ee",
  "Latvia": "lv",
  "Lithuania": "lt",
  "Belarus": "by",
  "Ukraine": "ua",
  "Slovakia": "sk",
  "Luxembourg": "lu",
  "Monaco": "mc",
  "Malta": "mt",
  "Cyprus": "cy",
  "Iceland": "is",

  // Asia
  "Japan": "jp",
  "China": "cn",
  "Taiwan": "tw",
  "South Korea": "kr",
  "North Korea": "kp",
  "Singapore": "sg",
  "Malaysia": "my",
  "Thailand": "th",
  "Indonesia": "id",
  "Philippines": "ph",
  "Vietnam": "vn",
  "Cambodia": "kh",
  "Laos": "la",
  "Myanmar": "mm",
  "India": "in",
  "Pakistan": "pk",
  "Bangladesh": "bd",
  "Sri Lanka": "lk",
  "Nepal": "np",
  "Bhutan": "bt",
  "Iran": "ir",
  "Iraq": "iq",
  "Saudi Arabia": "sa",
  "United Arab Emirates": "ae",
  "Qatar": "qa",
  "Kuwait": "kw",
  "Oman": "om",
  "Bahrain": "bh",
  "Lebanon": "lb",
  "Syria": "sy",
  "Jordan": "jo",
  "Israel": "il",
  "Mongolia": "mn",
  "Kazakhstan": "kz",
  "Uzbekistan": "uz",
  "Azerbaijan": "az",
  "Armenia": "am",
  "Georgia": "ge",
  "Kyrgyzstan": "kg",
  "Tajikistan": "tj",
  "Turkmenistan": "tm",

  // Americas
  "United States": "us",
  "Canada": "ca",
  "Mexico": "mx",
  "Brazil": "br",
  "Argentina": "ar",
  "Chile": "cl",
  "Peru": "pe",
  "Bolivia": "bo",
  "Ecuador": "ec",
  "Colombia": "co",
  "Venezuela": "ve",
  "Uruguay": "uy",
  "Paraguay": "py",
  "Panama": "pa",
  "Costa Rica": "cr",
  "Cuba": "cu",
  "Dominican Republic": "do",
  "Jamaica": "jm",
  "Puerto Rico": "pr",
  "Bahamas": "bs",

  // Africa
  "Egypt": "eg",
  "Nigeria": "ng",
  "DR Congo": "cd",
  "South Africa": "za",
  "Kenya": "ke",
  "Ethiopia": "et",
  "Algeria": "dz",
  "Morocco": "ma",
  "Tunisia": "tn",
  "Libya": "ly",
  "Sudan": "sd",
  "Senegal": "sn",
  "Ivory Coast": "ci",
  "Ghana": "gh",
  "Zambia": "zm",
  "Zimbabwe": "zw",
  "Mozambique": "mz",
  "Angola": "ao",
  "Tanzania": "tz",
  "Uganda": "ug",
  "Rwanda": "rw",
  "Madagascar": "mg",
  "Namibia": "na",
  "Botswana": "bw",
  "Burkina Faso": "bf",
  "Cameroon": "cm",
  "Republic of the Congo": "cg",
  "Gabon": "ga",
  "Mali": "ml",
  "Niger": "ne",
  "Togo": "tg",
  "Benin": "bj",
  "Guinea": "gn",
  "Sierra Leone": "sl",

  // Oceania
  "Australia": "au",
  "New Zealand": "nz",
  "Fiji": "fj",
  "Papua New Guinea": "pg",
  "Solomon Islands": "sb",
  "Samoa": "ws",
  "New Caledonia": "nc",
  "American Samoa": "as",
  "French Polynesia": "pf",
};

export function iso(country) {
  return COUNTRY_ISO[country] || "";
}

/** Build an <img> string for the flag of `country`. Empty string if no mapping. */
export function flagHtml(country, { alt = country, cls = "flag" } = {}) {
  const code = iso(country);
  if (!code) return "";
  return `<img class="${cls}" src="https://flagcdn.com/32x24/${code}.png"`
    + ` srcset="https://flagcdn.com/48x36/${code}.png 1.5x, https://flagcdn.com/64x48/${code}.png 2x"`
    + ` alt="${alt}" width="16" height="12" loading="lazy" decoding="async" />`;
}

/** Build a flag <img> DOM element for `country`. Null if no mapping. */
export function flagEl(country) {
  const code = iso(country);
  if (!code) return null;
  const img = document.createElement("img");
  img.className = "flag";
  img.src = `https://flagcdn.com/32x24/${code}.png`;
  img.srcset = `https://flagcdn.com/48x36/${code}.png 1.5x, https://flagcdn.com/64x48/${code}.png 2x`;
  img.width = 16;
  img.height = 12;
  img.alt = country;
  img.loading = "lazy";
  img.decoding = "async";
  return img;
}
