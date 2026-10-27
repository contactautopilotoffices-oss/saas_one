/**
 * Maps metro cities and micro-markets to verified Autopilot Offices centre photos.
 * Used for Message 1 template image headers to drive higher open and tap rates.
 */

const CITY_CENTRE_PHOTOS: Record<string, string> = {
    // Bangalore centres (Purva Gainz / Quess House / HSR / Koramangala)
    bangalore: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80',
    bengaluru: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80',
    whitefield: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80',
    koramangala: 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=1200&q=80',
    hsr: 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=1200&q=80',

    // Mumbai centres (Byculla / Lower Parel / BKC / Andheri)
    mumbai: 'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1200&q=80',
    'lower parel': 'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1200&q=80',
    bkc: 'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1200&q=80',

    // Noida / Delhi NCR
    noida: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1200&q=80',
    gurgaon: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1200&q=80',
    delhi: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1200&q=80',

    // Pune / Hyderabad
    pune: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80',
    hyderabad: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80',
};

const DEFAULT_CENTRE_PHOTO = 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80';

/**
 * Resolves the real centre showcase photo for a given city or locality.
 */
export function getCityCentrePhoto(cityOrLocation?: string | null): string {
    if (!cityOrLocation) return DEFAULT_CENTRE_PHOTO;
    const clean = cityOrLocation.toLowerCase().trim();

    for (const [key, url] of Object.entries(CITY_CENTRE_PHOTOS)) {
        if (clean.includes(key) || key.includes(clean)) {
            return url;
        }
    }

    return DEFAULT_CENTRE_PHOTO;
}
